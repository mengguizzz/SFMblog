<?php
/**
 * 梦归の小站 · 后端接口
 * ---------------------------------------------------------------------------
 * 单文件 Markdown 数据库（blogs/default.md）的读写、图片上传与访问统计。
 *
 * 数据模型
 *   文章块由 `---POST---` 分隔。
 *   **文章 id = 它在文件里的原始块下标**，而不是"第几篇可见文章"。
 *   这一点很关键：删除采用「原地打标记」的方式，块还留在原处，
 *   所以删掉第 3 篇不会让第 4 篇之后的文章集体改号 —— 已经分享出去的
 *   post.html?id=N 链接不会失效。
 *
 *   删除：在该块的 DATE 注释下面插一行 `<!-- DELETED: 时间 -->`
 *   恢复：把那行删掉
 *   彻底删除：才真正把块从文件里移除（这一步会让后面的文章改号）
 *
 * 该编号规则必须与 js/blog.js 的 parsePosts() 保持一致。
 */

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

const SEPARATOR  = '---POST---';
const DELETED_RE = '/<!--\s*DELETED:\s*(.*?)\s*-->/';

$BLOG_DIR = __DIR__ . '/blogs';
$MD_FILE  = $BLOG_DIR . '/default.md';
$COUNTER  = $BLOG_DIR . '/counter.txt';
$IMG_DIR  = __DIR__ . '/src/images';

/** 统一输出并结束 */
function respond(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * 原子写入：先写同目录下的临时文件，再 rename 覆盖。
 *
 * 直接 file_put_contents 到目标文件是「先截断再写」——万一 PHP 中途被杀掉或
 * 磁盘写满，整个博客库就只剩半个文件。rename 在同一文件系统内是原子操作，
 * 要么是旧的完整内容，要么是新的完整内容，不会有第三种状态。
 */
function atomic_write(string $file, string $content): bool
{
    $dir = dirname($file);
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
        return false;
    }

    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $content, LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0644);

    if (!rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/** 每次动 default.md 之前留一份上一版，手滑之后还能捞回来 */
function snapshot(string $file): void
{
    if (is_file($file)) {
        @copy($file, $file . '.bak');
    }
}

/* ------------------------------------------------------------------ 读取解析 */

function raw_blocks(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    return explode(SEPARATOR, (string)file_get_contents($file));
}

function is_blank(string $block): bool
{
    return trim($block) === '';
}

/** 返回删除时间，没被删过就返回 null —— 这就是"deleted 标签" */
function deleted_at(string $block): ?string
{
    return preg_match(DELETED_RE, $block, $m) === 1 ? trim($m[1]) : null;
}

function is_valid_post(array $raw, int $id): bool
{
    return $id >= 0 && $id < count($raw) && !is_blank($raw[$id]);
}

function mark_deleted(string $block, string $when): string
{
    $tag = '<!-- DELETED: ' . $when . ' -->';
    $out = preg_replace('/^(<!--\s*DATE:.*?-->)/m', '$1' . "\n" . $tag, $block, 1, $n);
    return $n > 0 ? $out : $tag . "\n" . $block;
}

function clear_deleted(string $block): string
{
    return (string)preg_replace('/^[ \t]*<!--\s*DELETED:.*?-->[ \t]*\r?\n?/m', '', $block, 1);
}

function title_of(string $block): string
{
    return preg_match('/^#\s+(.+)$/m', $block, $m) === 1 ? trim($m[1]) : '无标题文章';
}

function date_of(string $block): string
{
    return preg_match('/<!--\s*DATE:\s*(.*?)\s*\|/', $block, $m) === 1 ? trim($m[1]) : '';
}

/**
 * 规范形式写回。空块会被保留下来占位，这样"原始下标"不会被压缩，
 * 删除 / 恢复 / 新增都不会改变其它文章的 id。
 *
 * 顺带把 CRLF 统一成 LF：Windows 上编辑过的文件混着 CRLF 时，
 * 标记的插入 / 摘除会吃掉一个 \r，导致「删除再恢复」无法还原成原样。
 */
function write_raw(string $file, array $raw): void
{
    snapshot($file);
    $parts = [];
    foreach ($raw as $block) {
        $parts[] = trim(str_replace(["\r\n", "\r"], "\n", $block));
    }
    $body = $parts ? implode("\n\n" . SEPARATOR . "\n\n", $parts) . "\n" : '';
    atomic_write($file, $body);
}

/* --------------------------------------------------------------------- 配置 */

$EXPECTED_HASH = '';
$CONFIG = __DIR__ . '/config.php';
if (is_file($CONFIG)) {
    require $CONFIG;                       // 可在该文件里定义 $EXPECTED_HASH
}

$PLACEHOLDERS = ['', 'abcdefg1234567', 'REPLACE_ME'];
$CONFIGURED = is_string($EXPECTED_HASH) && !in_array($EXPECTED_HASH, $PLACEHOLDERS, true);

$action = (string)($_REQUEST['action'] ?? '');

/* ----------------------------------------------------------------- 访问统计 */

if ($action === 'peek' || $action === 'counter') {
    $count = 0;
    $fp = @fopen($COUNTER, 'c+');
    if ($fp) {
        flock($fp, LOCK_EX);
        $count = (int)stream_get_contents($fp);
        if ($action === 'counter') {
            $count++;
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, (string)$count);
            fflush($fp);
        }
        flock($fp, LOCK_UN);
        fclose($fp);
    }
    respond(['success' => true, 'count' => $count]);
}

/* --------------------------------------------------------------------- 鉴权 */

$token = (string)($_POST['token'] ?? '');

if (!$CONFIGURED) {
    respond(['error' => 'Server not configured'], 503);
}
if ($token === '') {
    respond(['error' => 'Empty token'], 400);
}
if (!hash_equals($EXPECTED_HASH, hash('sha256', $token))) {
    usleep(300000);                        // 稍微抬高暴力破解成本
    respond(['error' => 'Access denied.'], 403);
}

if ($action === 'verify') {
    respond(['success' => true]);
}

/* ----------------------------------------------------------------- 图片上传 */

if ($action === 'upload') {
    if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
        respond(['error' => 'No image received.'], 400);
    }

    $file = $_FILES['image'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        respond(['error' => 'Upload error (code ' . $file['error'] . ').'], 400);
    }
    if ($file['size'] > 10 * 1024 * 1024) {
        respond(['error' => 'Image too large (max 10 MB).'], 413);
    }

    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    $ext = strtolower((string)pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) {
        respond(['error' => 'Only jpg / png / gif / webp are allowed.'], 400);
    }

    // 真·图片校验：确认它确实是一张图，而不是改了后缀的脚本
    $info = @getimagesize($file['tmp_name']);
    if ($info === false || strpos((string)$info['mime'], 'image/') !== 0) {
        respond(['error' => 'The uploaded file is not a valid image.'], 400);
    }

    if (!is_dir($IMG_DIR) && !mkdir($IMG_DIR, 0755, true)) {
        respond(['error' => 'Cannot create image directory.'], 500);
    }

    $name = 'img_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $IMG_DIR . '/' . $name)) {
        respond(['error' => 'Failed to save image.'], 500);
    }

    respond(['success' => true, 'url' => './src/images/' . $name]);
}

/* ---------------------------------------------------------- 文章：增 / 改 / 删 / 恢复 */

$content = (string)($_POST['content'] ?? '');
$id      = isset($_POST['id']) ? (int)$_POST['id'] : -1;
$raw     = raw_blocks($MD_FILE);

if ($action === 'add') {
    if (trim($content) === '') {
        respond(['error' => 'Content is empty.'], 400);
    }
    $raw[] = trim($content);
    write_raw($MD_FILE, $raw);
    respond(['success' => true, 'message' => 'Post created.', 'id' => count($raw) - 1]);
}

if ($action === 'edit') {
    if (!is_valid_post($raw, $id)) {
        respond(['error' => 'Post not found.'], 404);
    }
    if (deleted_at($raw[$id]) !== null) {
        respond(['error' => 'Post is in the trash. Restore it first.'], 409);
    }
    if (trim($content) === '') {
        respond(['error' => 'Content is empty.'], 400);
    }

    // 覆盖正文时保留原有的删除标记位（这里正常情况本来就没有）
    $raw[$id] = trim($content);
    write_raw($MD_FILE, $raw);
    respond(['success' => true, 'message' => 'Post updated.', 'id' => $id]);
}

if ($action === 'delete') {
    if (!is_valid_post($raw, $id)) {
        respond(['error' => 'Post not found.'], 404);
    }
    if (deleted_at($raw[$id]) !== null) {
        respond(['error' => 'Already in trash.'], 409);
    }

    // 软删除：块留在原处，只插一行标记。下标不变 => 其它文章的链接不受影响。
    $raw[$id] = mark_deleted($raw[$id], date('Y-m-d H:i:s'));
    write_raw($MD_FILE, $raw);
    respond(['success' => true, 'message' => 'Moved to trash.', 'id' => $id]);
}

if ($action === 'restore') {
    if (!is_valid_post($raw, $id) || deleted_at($raw[$id]) === null) {
        respond(['error' => 'Trash item not found.'], 404);
    }
    $raw[$id] = clear_deleted($raw[$id]);
    write_raw($MD_FILE, $raw);
    respond(['success' => true, 'message' => 'Post restored.', 'id' => $id]);
}

if ($action === 'trash') {
    $items = [];
    foreach ($raw as $i => $block) {
        $when = is_blank($block) ? null : deleted_at($block);
        if ($when === null) {
            continue;
        }
        $items[] = [
            'id'        => $i,
            'title'     => title_of($block),
            'date'      => date_of($block),
            'deletedAt' => $when,
        ];
    }
    respond(['success' => true, 'items' => $items]);
}

if ($action === 'trash-purge') {
    if ($id >= 0) {
        // 彻底删掉一块——注意：这一步会让后面的文章下标前移，链接会变
        if (!is_valid_post($raw, $id) || deleted_at($raw[$id]) === null) {
            respond(['error' => 'Trash item not found.'], 404);
        }
        $title = title_of($raw[$id]);
        array_splice($raw, $id, 1);
        write_raw($MD_FILE, $raw);
        respond(['success' => true, 'message' => 'Permanently deleted.', 'title' => $title]);
    }

    $kept = [];
    foreach ($raw as $block) {
        if (is_blank($block) || deleted_at($block) === null) {
            $kept[] = $block;
        }
    }
    write_raw($MD_FILE, $kept);
    respond(['success' => true, 'message' => 'Trash emptied.']);
}

respond(['error' => 'Unknown action.'], 400);
