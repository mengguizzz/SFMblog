<?php
/**
 * 梦归の小站 · 后端接口
 * ---------------------------------------------------------------------------
 * 单文件 Markdown 数据库（blogs/default.md）的读写、图片上传与访问统计。
 * 文章块由 `---POST---` 分隔，空块不计入编号；
 * 该编号规则必须与 js/blog.js 中的 parsePosts() 保持一致。
 */

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

const SEPARATOR = '---POST---';

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

/** 把 default.md 切成 [raw => 原始块, map => 非空块的原始下标] */
function read_blocks(string $file): array
{
    if (!is_file($file)) {
        return ['raw' => [], 'map' => []];
    }
    $raw = explode(SEPARATOR, (string)file_get_contents($file));
    $map = [];
    foreach ($raw as $i => $block) {
        if (trim($block) !== '') {
            $map[] = $i;
        }
    }
    return ['raw' => $raw, 'map' => $map];
}

function write_blocks(string $file, array $raw): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    file_put_contents($file, implode(SEPARATOR, $raw), LOCK_EX);
}

// --------------------------------------------------------------------- 配置
$EXPECTED_HASH = '';           // 留空表示未配置（下方会自动尝试 config.php）
$CONFIG = __DIR__ . '/config.php';
if (is_file($CONFIG)) {
    require $CONFIG;           // 可在此文件里定义 $EXPECTED_HASH
}

// 占位串：如果还是这个值，说明用户还没配置
$PLACEHOLDERS = ['', 'abcdefg1234567', 'REPLACE_ME'];
$CONFIGURED = is_string($EXPECTED_HASH) && !in_array($EXPECTED_HASH, $PLACEHOLDERS, true);

$action = (string)($_REQUEST['action'] ?? '');

// ------------------------------------------------------------------ 访问统计
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

// -------------------------------------------------------------------- 鉴权
$token = (string)($_POST['token'] ?? '');

if (!$CONFIGURED) {
    respond(['error' => 'Server not configured'], 503);
}

if ($token === '') {
    respond(['error' => 'Empty token'], 400);
}

if (!hash_equals($EXPECTED_HASH, hash('sha256', $token))) {
    usleep(300000); // 轻微延时，抬高暴力破解成本
    respond(['error' => 'Access denied.'], 403);
}

if ($action === 'verify') {
    respond(['success' => true]);
}

// ------------------------------------------------------------------ 图片上传
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

// --------------------------------------------------------------- 文章增 / 改 / 删
$content = (string)($_POST['content'] ?? '');
$id = isset($_POST['id']) ? (int)$_POST['id'] : -1;

$data  = read_blocks($MD_FILE);
$raw   = $data['raw'];
$map   = $data['map'];
$count = count($map);

if ($action === 'add') {
    if (trim($content) === '') {
        respond(['error' => 'Content is empty.'], 400);
    }

    $clean = "\n\n" . trim($content) . "\n\n";
    if ($count === 0 || trim(implode('', $raw)) === '') {
        write_blocks($MD_FILE, [trim($content) . "\n"]);
    } else {
        if (!is_dir($BLOG_DIR)) {
            mkdir($BLOG_DIR, 0755, true);
        }
        file_put_contents($MD_FILE, "\n\n" . SEPARATOR . "\n\n" . $clean, FILE_APPEND | LOCK_EX);
    }
    respond(['success' => true, 'message' => 'Post created.', 'id' => $count]);
}

if ($action === 'edit') {
    if ($id < 0 || $id >= $count) {
        respond(['error' => 'Post not found.'], 404);
    }
    if (trim($content) === '') {
        respond(['error' => 'Content is empty.'], 400);
    }
    $raw[$map[$id]] = "\n\n" . trim($content) . "\n\n";
    write_blocks($MD_FILE, $raw);
    respond(['success' => true, 'message' => 'Post updated.', 'id' => $id]);
}

if ($action === 'delete') {
    if ($id < 0 || $id >= $count) {
        respond(['error' => 'Post not found.'], 404);
    }
    unset($raw[$map[$id]]);
    write_blocks($MD_FILE, array_values($raw));
    respond(['success' => true, 'message' => 'Post deleted.', 'id' => $id]);
}

respond(['error' => 'Unknown action.'], 400);
