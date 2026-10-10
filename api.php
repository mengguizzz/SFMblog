<?php
/**
 * SFMblog · 后端接口
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
header('X-Frame-Options: DENY');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

const SEPARATOR  = '---POST---';
const DELETED_RE = '/<!--\s*DELETED:\s*(.*?)\s*-->/';

$BLOG_DIR = __DIR__ . '/blogs';
$MD_FILE  = $BLOG_DIR . '/default.md';
$COUNTER  = $BLOG_DIR . '/counter.txt';
$IMG_DIR  = __DIR__ . '/src/images';
// 备份和会话都放在点目录里：nginx 的 `location ~ /\.` 规则天然挡掉，
// 就算以后换掉 nginx 配置，也不会把 default.md.bak 直接暴露成可下载文件。
$BACKUP_DIR  = $BLOG_DIR . '/.backup';
$SESSION_DIR = $BLOG_DIR . '/.sessions';
$SESSION_TTL = 12 * 3600;
$LOGIN_MAX_FAILS = 8;          // 15 分钟内允许几次失败
$LOGIN_WINDOW    = 900;

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

/**
 * 每次动 default.md 之前留一份上一版，手滑之后还能捞回来。
 * 注意放在 blogs/.backup/ 里 —— 如果备份和正文同目录，
 * 别人直接 GET /blogs/default.md.bak 就能把它整份下载走。
 */
function snapshot(string $file, string $backupDir): void
{
    if (!is_file($file)) {
        return;
    }
    if (!is_dir($backupDir)) {
        @mkdir($backupDir, 0700, true);
    }
    @copy($file, $backupDir . '/' . basename($file) . '.bak');
}

/* ------------------------------------------------------------ 会话与登录限速 */

function session_file(string $dir, string $sid): string
{
    return $dir . '/' . preg_replace('/[^a-f0-9]/', '', $sid) . '.json';
}

/** 登录成功 -> 换一个随机 sid；浏览器只保存 sid，不再保存明文密码 */
function new_session(string $dir, int $ttl): array
{
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $sid = bin2hex(random_bytes(32));
    $exp = time() + $ttl;
    $file = session_file($dir, $sid);
    file_put_contents($file, json_encode(['exp' => $exp]), LOCK_EX);
    @chmod($file, 0600);
    return ['sid' => $sid, 'expires' => $exp];
}

function session_valid(string $dir, string $sid): bool
{
    if ($sid === '' || preg_match('/^[a-f0-9]{64}$/', $sid) !== 1) {
        return false;
    }
    $file = session_file($dir, $sid);
    if (!is_file($file)) {
        return false;
    }
    $data = json_decode((string)file_get_contents($file), true);
    if (!is_array($data) || (int)($data['exp'] ?? 0) < time()) {
        @unlink($file);
        return false;
    }
    return true;
}

function destroy_session(string $dir, string $sid): void
{
    if (preg_match('/^[a-f0-9]{64}$/', $sid) === 1) {
        @unlink(session_file($dir, $sid));
    }
}

function attempts_file(string $dir): string
{
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return $dir . '/attempts_' . substr(hash('sha256', $ip), 0, 16) . '.json';
}

/** 返回剩余锁定秒数，0 表示没被锁 */
function login_lock_seconds(string $dir, int $max, int $window): int
{
    $file = attempts_file($dir);
    if (!is_file($file)) {
        return 0;
    }
    $data = json_decode((string)file_get_contents($file), true);
    if (!is_array($data) || !is_array($data['hits'] ?? null)) {
        return 0;
    }
    $hits = array_values(array_filter($data['hits'], function ($t) use ($window) {
        return (int)$t > time() - $window;
    }));
    if (count($hits) < $max) {
        return 0;
    }
    return max(0, ((int)min($hits) + $window) - time());
}

function record_failure(string $dir, int $window): void
{
    $file = attempts_file($dir);
    $data = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    $hits = (is_array($data) && is_array($data['hits'] ?? null)) ? $data['hits'] : [];
    $hits = array_values(array_filter($hits, function ($t) use ($window) {
        return (int)$t > time() - $window;
    }));
    $hits[] = time();
    file_put_contents($file, json_encode(['hits' => $hits]), LOCK_EX);
    @chmod($file, 0600);
}

function clear_failures(string $dir): void
{
    @unlink(attempts_file($dir));
}

/**
 * 同时支持两种存储：新的 bcrypt/argon2（以 $ 开头）和旧的裸 sha256。
 * 裸 sha256 对短密码基本等于明文，强烈建议换掉（见 tools/make-password.php）。
 */
function check_password(string $stored, string $input): bool
{
    if ($stored === '' || $input === '') {
        return false;
    }
    if ($stored[0] === '$') {
        return password_verify($input, $stored);
    }
    return hash_equals($stored, hash('sha256', $input));
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

function tags_of(string $block): array
{
    $tags = [];
    if (preg_match('/<!--\s*DATE:\s*(.*?)\s*\|\s*TAG:\s*(.*?)\s*-->/', $block, $m) === 1) {
        foreach (preg_split('/[,，;；]/u', $m[2]) as $t) {
            $t = trim($t);
            if ($t !== '') {
                $tags[] = $t;
            }
        }
    }
    return $tags !== [] ? $tags : ['Blog'];
}

/** 去掉标题行和所有 HTML 注释，得到纯正文 */
function body_of(string $block): string
{
    $b = (string)preg_replace('/^#\s+(.+)$/m', '', $block, 1);
    $b = (string)preg_replace('/<!--[\s\S]*?-->/', '', $b);
    return trim($b);
}

/** 把 Markdown 压成一行纯文本，用于列表页摘要（和前端原来的行为一致） */
function plain_text(string $md): string
{
    $s = (string)preg_replace('/```[\s\S]*?```/', ' ', $md);
    $s = (string)preg_replace('/~~~[\s\S]*?~~~/', ' ', $s);
    $s = (string)preg_replace('/<!--[\s\S]*?-->/', ' ', $s);
    $s = (string)preg_replace('/!\[[^\]]*\]\([^)]*\)/', ' ', $s);
    $s = (string)preg_replace('/\[([^\]]*)\]\([^)]*\)/', '$1', $s);
    $s = (string)preg_replace('/^\s{0,3}#{1,6}\s+.*$/m', ' ', $s);
    $s = (string)preg_replace('/^\s{0,3}>+\s?/m', ' ', $s);
    $s = (string)preg_replace('/^\s*([-*+]|\d+\.)\s+/m', ' ', $s);
    $s = (string)preg_replace('/^\s*\|.*\|\s*$/m', ' ', $s);
    $s = (string)preg_replace('/`([^`]*)`/', '$1', $s);
    $s = str_replace(['*', '_', '~'], '', $s);
    $s = (string)preg_replace('/\s+/u', ' ', $s);
    return trim($s);
}

function read_minutes(string $body): int
{
    $cjk = preg_match_all('/[\x{4e00}-\x{9fa5}]/u', $body);
    $rest = (string)preg_replace('/[\x{4e00}-\x{9fa5}]/u', ' ', $body);
    $words = preg_match_all('/[A-Za-z0-9_]+/', $rest);
    return max(1, (int)round($cjk / 400 + $words / 200));
}

/**
 * 一篇文章的元信息（不含正文）。
 * 这是"把解析从前端搬到服务端"的核心：浏览器不再需要下载整份 default.md。
 */
function post_meta(string $block, int $id): array
{
    $body  = body_of($block);
    $text  = plain_text($body);
    $date  = date_of($block);
    $when  = deleted_at($block);

    return [
        'id'        => $id,
        'title'     => title_of($block),
        'date'      => $date,
        'dateISO'   => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1 ? $date : '',
        'tags'      => tags_of($block),
        'summary'   => mb_strlen($text, 'UTF-8') > 110
            ? mb_substr($text, 0, 110, 'UTF-8') . '…'
            : $text,
        'minutes'   => read_minutes($body),
        'deleted'   => $when !== null,
        'deletedAt' => $when ?? '',
    ];
}

/** 按日期倒序（同日按 id 倒序），和原来前端的排序一致 */
function sort_posts(array &$items): void
{
    usort($items, function (array $a, array $b): int {
        $da = $a['dateISO'] !== '' ? $a['dateISO'] : $a['date'];
        $db = $b['dateISO'] !== '' ? $b['dateISO'] : $b['date'];
        return $da === $db ? ($b['id'] <=> $a['id']) : strcmp($db, $da);
    });
}

/**
 * 规范形式写回。空块会被保留下来占位，这样"原始下标"不会被压缩，
 * 删除 / 恢复 / 新增都不会改变其它文章的 id。
 *
 * 顺带把 CRLF 统一成 LF：Windows 上编辑过的文件混着 CRLF 时，
 * 标记的插入 / 摘除会吃掉一个 \r，导致「删除再恢复」无法还原成原样。
 */
function write_raw(string $file, array $raw, string $backupDir): void
{
    snapshot($file, $backupDir);
    $parts = [];
    foreach ($raw as $block) {
        $parts[] = trim(str_replace(["\r\n", "\r"], "\n", $block));
    }
    $body = $parts ? implode("\n\n" . SEPARATOR . "\n\n", $parts) . "\n" : '';
    atomic_write($file, $body);
}

/* --------------------------------------------------------------------- 配置 */

/* ----------------------------------------------------------------------- 评论 */
/*
 * 自己实现的评论：**存文件，不引数据库**，跟 blogs/default.md 是同一个路子。
 *
 *   每篇文章一个文件：comments/<文章 id>.json
 *   { "items": [ { id, parent, name, site, text, ts, status, ip } ] }
 *
 *   status 三种：
 *     approved —— 正常显示
 *     pending  —— 等站长在控制台里点通过
 *     spam     —— 蜜罐被填了 / 提交得比打字还快；**不显示，但保留着**，
 *                 既不给机器人任何反馈（照常返回成功），站长又能在控制台里看到
 *
 *   `ip` 存的是 sha1(客户端 IP) 的前 8 位 —— 只用来限流，
 *   **任何接口都不会把它返回出去**，也不落原始 IP。
 *
 * 并发：读-改-写全部在 comments/<id>.json.lock 的排它锁里做，
 * 两个人同时提交不会互相覆盖（先拿锁，再读一次，再写）。
 */

$COMMENT_DIR      = __DIR__ . '/comments';
$COMMENT_BACKUP   = $COMMENT_DIR . '/.backup';
$COMMENT_MAX_LEN  = 3000;      // 正文上限（字符数，中文一个字算一个）
$COMMENT_NAME_LEN = 40;
$COMMENT_MIN_GAP  = 20;        // 同一来源两条评论的最小间隔（秒）
$COMMENT_RATE_MAX = 8;         // 限流窗口内最多几条
$COMMENT_RATE_WIN = 600;       // 限流窗口（秒）
$COMMENT_MIN_ELAPSE = 3;       // 打开页面到点提交至少 3 秒（防脚本秒发）

function client_ip_hash(): string
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    return substr(sha1($ip . '|sfmblog'), 0, 8);
}

/**
 * 取一个"必须是纯数字"的文章 id。
 *
 * 不能直接 `(int)$_POST['id']` —— PHP 会把 'abc'、'../../config.php' 这类
 * 通通转成 **0**，于是"打错一个字"就变成往第 0 篇文章发评论，
 * 而路径穿越那类载荷看起来也会"成功"。宁可明确拒掉。
 */
function req_post_id(string $key = 'id'): ?int
{
    $v = $_POST[$key] ?? $_REQUEST[$key] ?? null;
    if ($v === null || !is_scalar($v)) {
        return null;
    }
    $s = trim((string)$v);
    return preg_match('/^\d{1,9}$/', $s) === 1 ? (int)$s : null;
}

function comment_file(string $dir, int $pid): string
{
    return $dir . '/' . $pid . '.json';
}

/** 拿排它锁；拿不到就返回 null（调用方照旧往下走，最坏只是并发时可能丢一条） */
function comments_lock(string $file)
{
    $fp = @fopen($file . '.lock', 'c');
    if (!$fp) {
        return null;
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        return null;
    }
    return $fp;
}

function comments_unlock($fp): void
{
    if ($fp) {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function read_comments(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['items']) || !is_array($data['items'])) {
        return [];
    }
    return array_values(array_filter($data['items'], 'is_array'));
}

function write_comments(string $file, array $items, string $backupDir): bool
{
    if (!is_dir($backupDir)) {
        @mkdir($backupDir, 0700, true);
    }
    if (is_file($file)) {
        @copy($file, $backupDir . '/' . basename($file) . '.bak');
    }
    $json = json_encode(
        ['items' => array_values($items)],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
    );
    return atomic_write($file, ($json === false ? '{"items":[]}' : $json) . "\n");
}

/** 对外的字段（**不带 ip**） */
function comment_public(array $c): array
{
    return [
        'id'     => (string)($c['id'] ?? ''),
        'parent' => isset($c['parent']) && $c['parent'] !== null ? (string)$c['parent'] : null,
        'name'   => (string)($c['name'] ?? ''),
        'site'   => (string)($c['site'] ?? ''),
        'text'   => (string)($c['text'] ?? ''),
        'ts'     => (int)($c['ts'] ?? 0),
    ];
}

/**
 * 限流闸门。返回 0 = 放行；> 0 = 还要等多少秒。
 * 顺手把过期记录清掉，所以 comments/.rate.json 不会越滚越大。
 */
function rate_gate(string $dir, string $iphash, int $gap, int $max, int $win): int
{
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        return 0;                       // 目录都建不了，就别拦着人了
    }
    $file = $dir . '/.rate.json';
    $fp = @fopen($file, 'c+');
    if (!$fp) {
        return 0;
    }
    flock($fp, LOCK_EX);

    $data = json_decode((string)stream_get_contents($fp), true);
    if (!is_array($data)) {
        $data = [];
    }
    $now = time();
    foreach ($data as $k => $list) {
        $keep = [];
        foreach ((array)$list as $t) {
            if (is_int($t) && $now - $t < $win) {
                $keep[] = $t;
            }
        }
        if ($keep) {
            $data[$k] = $keep;
        } else {
            unset($data[$k]);
        }
    }

    $mine  = isset($data[$iphash]) && is_array($data[$iphash]) ? $data[$iphash] : [];
    $retry = 0;
    if ($mine) {
        $last = end($mine);
        if ($now - $last < $gap) {
            $retry = $gap - ($now - $last);
        }
    }
    if ($retry === 0 && count($mine) >= $max) {
        $retry = $win - ($now - $mine[0]);
    }
    if ($retry === 0) {
        $mine[] = $now;
        $data[$iphash] = $mine;
    }

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string)json_encode($data));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    return max(0, (int)$retry);
}

$EXPECTED_HASH = '';
// 新评论要不要先审核：true = 进待审核列表，站长在控制台点通过才显示。
// 想让它发出来就直接可见，把这个改成 false（也可以在 config.php 里覆盖）。
$COMMENT_MODERATE = true;
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

/* ------------------------------------------------- 公开内容接口（不需要登录） */
/*
 * 重要：浏览器不再直接下载 blogs/default.md。
 * 以前前端是 fetch 整个 md 再自己切割，等于把整份数据库（含已删除的文章）
 * 公开给任何人。现在只按需返回"该看到的那些字段"。
 */

$raw = raw_blocks($MD_FILE);

if ($action === 'list') {
    $items = [];
    foreach ($raw as $i => $block) {
        if (is_blank($block) || deleted_at($block) !== null) {
            continue;                     // 回收站里的文章不出现在公开列表
        }
        $items[] = post_meta($block, $i);
    }
    sort_posts($items);
    respond(['success' => true, 'items' => $items]);
}

if ($action === 'post') {
    $pid = (int)($_REQUEST['id'] ?? -1);
    if (!is_valid_post($raw, $pid)) {
        respond(['error' => 'Post not found.'], 404);
    }
    if (deleted_at($raw[$pid]) !== null) {
        respond(['error' => 'This post has been deleted.', 'deleted' => true], 404);
    }
    $post = post_meta($raw[$pid], $pid);
    $post['body'] = body_of($raw[$pid]);
    respond(['success' => true, 'post' => $post]);
}

/* --------------------------------------------------------------------- 评论 */
/* 这两个是**公开**接口：不登录也能看评论、发评论。 */

/** 取某篇文章的评论（只给 approved 的） */
if ($action === 'comments') {
    $pid = req_post_id();
    if ($pid === null || !is_valid_post($raw, $pid) || deleted_at($raw[$pid]) !== null) {
        respond(['error' => 'Post not found.'], 404);
    }
    $items = read_comments(comment_file($COMMENT_DIR, $pid));
    $out   = [];
    foreach ($items as $c) {
        if (($c['status'] ?? '') === 'approved') {
            $out[] = comment_public($c);
        }
    }
    respond([
        'success'  => true,
        'items'    => $out,
        'total'    => count($out),
        'moderate' => (bool)$COMMENT_MODERATE,
    ]);
}

/** 发一条评论 */
if ($action === 'comment') {
    $pid = req_post_id();
    if ($pid === null || !is_valid_post($raw, $pid) || deleted_at($raw[$pid]) !== null) {
        respond(['error' => 'Post not found.'], 404);
    }

    $name   = trim((string)($_POST['name'] ?? ''));
    $text   = (string)($_POST['text'] ?? '');
    $site   = trim((string)($_POST['site'] ?? ''));
    $parent = trim((string)($_POST['parent'] ?? ''));
    $honey  = (string)($_POST['hp'] ?? '');
    $elapse = (int)($_POST['elapsed'] ?? -1);

    // 统一换行 + 去掉控制字符（里面有 \x00 之类的会把 JSON 写坏）
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $text = (string)preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
    $text = (string)preg_replace('/\n{4,}/', "\n\n\n", $text);
    $text = trim($text);
    $name = trim((string)preg_replace('/[\x00-\x1F\x7F]/u', '', $name));
    $site = (string)preg_replace('/[\x00-\x1F\x7F]/u', '', $site);

    if ($name === '') {
        $name = '游客';
    }
    if (mb_strlen($name, 'UTF-8') > $COMMENT_NAME_LEN) {
        respond(['error' => '昵称太长了（最多 ' . $COMMENT_NAME_LEN . ' 个字）。'], 400);
    }
    if ($text === '') {
        respond(['error' => '内容不能是空的。'], 400);
    }
    if (mb_strlen($text, 'UTF-8') > $COMMENT_MAX_LEN) {
        respond(['error' => '内容太长了（最多 ' . $COMMENT_MAX_LEN . ' 个字）。'], 400);
    }
    if ($site !== '' && (mb_strlen($site, 'UTF-8') > 200 || preg_match('#^https?://#i', $site) !== 1)) {
        respond(['error' => '网址要以 http:// 或 https:// 开头。'], 400);
    }

    $iphash = client_ip_hash();
    $retry  = rate_gate($COMMENT_DIR, $iphash, $COMMENT_MIN_GAP, $COMMENT_RATE_MAX, $COMMENT_RATE_WIN);
    if ($retry > 0) {
        respond(['error' => '发得太快了，' . $retry . ' 秒后再试试。', 'retry_after' => $retry], 429);
    }

    // 蜜罐被填 / 提交得比打字还快 -> 按机器人处理：
    // **照常回成功**（不给对方任何线索），但状态记成 spam，不显示、只有站长看得到。
    $bot    = ($honey !== '') || ($elapse >= 0 && $elapse < $COMMENT_MIN_ELAPSE * 1000);
    $status = $bot ? 'spam' : ($COMMENT_MODERATE ? 'pending' : 'approved');

    $file = comment_file($COMMENT_DIR, $pid);
    $fp   = comments_lock($file);
    $items = read_comments($file);        // 拿到锁之后再读，避免并发时互相覆盖
    $ids   = array_map(function ($c) { return (string)($c['id'] ?? ''); }, $items);
    if ($parent !== '' && !in_array($parent, $ids, true)) {
        $parent = '';                      // 回复的目标不存在就当普通评论
    }

    $item = [
        'id'     => 'c' . bin2hex(random_bytes(5)),
        'parent' => $parent === '' ? null : $parent,
        'name'   => $name,
        'site'   => $site,
        'text'   => $text,
        'ts'     => time(),
        'status' => $status,
        'ip'     => $iphash,
    ];
    $items[] = $item;
    write_comments($file, $items, $COMMENT_BACKUP);
    comments_unlock($fp);

    respond([
        'success' => true,                              // 被当成垃圾也照样"成功"
        'status'  => $status,
        'pending' => $status !== 'approved',
        'comment' => $status === 'approved' ? comment_public($item) : null,
    ]);
}

/* --------------------------------------------------------------------- 鉴权 */

if (!$CONFIGURED) {
    respond(['error' => 'Server not configured'], 503);
}

$legacyHash = is_string($EXPECTED_HASH) && $EXPECTED_HASH !== '' && $EXPECTED_HASH[0] !== '$';

// 登录：客户端只在这一个请求里发一次明文密码，换回一个随机 sid。
if ($action === 'login') {
    $lock = login_lock_seconds($SESSION_DIR, $LOGIN_MAX_FAILS, $LOGIN_WINDOW);
    if ($lock > 0) {
        respond(['error' => 'Too many failed attempts. Try again later.', 'retry_after' => $lock], 429);
    }

    $password = (string)($_POST['password'] ?? '');
    if (!check_password((string)$EXPECTED_HASH, $password)) {
        record_failure($SESSION_DIR, $LOGIN_WINDOW);
        usleep(400000);                    // 再加一点延时
        respond(['error' => 'Access denied.'], 403);
    }

    clear_failures($SESSION_DIR);
    $session = new_session($SESSION_DIR, $SESSION_TTL);
    respond([
        'success' => true,
        'sid'     => $session['sid'],
        'expires' => $session['expires'],
        'legacy'  => $legacyHash,          // 提醒前端该换密码哈希了
    ]);
}

if ($action === 'logout') {
    destroy_session($SESSION_DIR, (string)($_POST['sid'] ?? ''));
    respond(['success' => true]);
}

// 其余接口一律校验会话，不再接受"密码当 token"。
$sid = (string)($_POST['sid'] ?? '');
if (!session_valid($SESSION_DIR, $sid)) {
    respond(['error' => 'Access denied. Please sign in again.'], 403);
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
    // 同 req_post_id 的理由：别让 'abc' 这种被 (int) 悄悄变成第 0 篇。
    // 这里保留"没传 id = -1"的老语义（清空回收站要用到）。
    $id      = req_post_id() ?? -1;

/** 控制台用：一次拿到全部文章（含回收站）和正文 */
if ($action === 'all') {
    $items = [];
    foreach ($raw as $i => $block) {
        if (is_blank($block)) {
            continue;
        }
        $meta = post_meta($block, $i);
        $meta['body'] = body_of($block);
        $items[] = $meta;
    }
    sort_posts($items);
    respond(['success' => true, 'items' => $items]);
}

if ($action === 'add') {
    if (trim($content) === '') {
        respond(['error' => 'Content is empty.'], 400);
    }
    $raw[] = trim($content);
    write_raw($MD_FILE, $raw, $BACKUP_DIR);
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
    write_raw($MD_FILE, $raw, $BACKUP_DIR);
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
    write_raw($MD_FILE, $raw, $BACKUP_DIR);
    respond(['success' => true, 'message' => 'Moved to trash.', 'id' => $id]);
}

if ($action === 'restore') {
    if (!is_valid_post($raw, $id) || deleted_at($raw[$id]) === null) {
        respond(['error' => 'Trash item not found.'], 404);
    }
    $raw[$id] = clear_deleted($raw[$id]);
    write_raw($MD_FILE, $raw, $BACKUP_DIR);
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
        write_raw($MD_FILE, $raw, $BACKUP_DIR);
        // 文章都彻底删了，它的评论也一起清掉（软删除阶段是留着的，撤销删除评论还在）
        $cf = comment_file($COMMENT_DIR, $id);
        if (is_file($cf)) {
            @unlink($cf);
            @unlink($cf . '.lock');
        }
        respond(['success' => true, 'message' => 'Permanently deleted.', 'title' => $title]);
    }

    $kept = [];
    foreach ($raw as $block) {
        if (is_blank($block) || deleted_at($block) === null) {
            $kept[] = $block;
        }
    }
    write_raw($MD_FILE, $kept, $BACKUP_DIR);
    respond(['success' => true, 'message' => 'Trash emptied.']);
}

/* --------------------------------------------------------------- 评论（管理） */
/* 下面这几个都要登录。前端把用户输入一律用 textContent 渲染，所以这里原样返回原文。 */

/** 所有评论（含待审核 / 垃圾），按时间倒序 */
if ($action === 'comments-admin') {
    $items = [];
    foreach ((glob($COMMENT_DIR . '/*.json') ?: []) as $f) {
        $base = basename($f, '.json');
        if (preg_match('/^\d+$/', $base) !== 1) {
            continue;                       // .rate.json / .backup 之类跳过
        }
        $pid   = (int)$base;
        $title = is_valid_post($raw, $pid) ? title_of($raw[$pid]) : '（文章已不存在）';
        foreach (read_comments($f) as $c) {
            $items[] = [
                'id'        => (string)($c['id'] ?? ''),
                'parent'    => isset($c['parent']) && $c['parent'] !== null ? (string)$c['parent'] : '',
                'name'      => (string)($c['name'] ?? ''),
                'site'      => (string)($c['site'] ?? ''),
                'text'      => (string)($c['text'] ?? ''),
                'ts'        => (int)($c['ts'] ?? 0),
                'status'    => (string)($c['status'] ?? 'approved'),
                'post'      => $pid,
                'postTitle' => $title,
            ];
        }
    }
    usort($items, function (array $a, array $b): int {
        return $b['ts'] <=> $a['ts'];
    });
    $pending = 0;
    foreach ($items as $c) {
        if ($c['status'] === 'pending') {
            $pending++;
        }
    }
    respond(['success' => true, 'items' => $items, 'pending' => $pending]);
}

/** 改状态：通过 / 退回待审 / 标记垃圾 */
if ($action === 'comment-status') {
    $pid  = req_post_id('post');
    $cid  = (string)($_POST['id'] ?? '');
    $next = (string)($_POST['status'] ?? '');
    if ($pid === null) {
        respond(['error' => 'Post not found.'], 404);
    }
    if (!in_array($next, ['approved', 'pending', 'spam'], true)) {
        respond(['error' => 'Bad status.'], 400);
    }

    $file  = comment_file($COMMENT_DIR, $pid);
    $fp    = comments_lock($file);
    $items = read_comments($file);
    $hit   = false;
    foreach ($items as $k => $c) {
        if ((string)($c['id'] ?? '') === $cid) {
            $items[$k]['status'] = $next;
            $hit = true;
        }
    }
    if ($hit) {
        write_comments($file, $items, $COMMENT_BACKUP);
    }
    comments_unlock($fp);
    if (!$hit) {
        respond(['error' => 'Comment not found.'], 404);
    }
    respond(['success' => true, 'status' => $next]);
}

/** 删一条评论（连它的回复一起删；回复只有一层） */
if ($action === 'comment-delete') {
    $pid = req_post_id('post');
    $cid = (string)($_POST['id'] ?? '');
    if ($pid === null) {
        respond(['error' => 'Post not found.'], 404);
    }

    $file  = comment_file($COMMENT_DIR, $pid);
    $fp    = comments_lock($file);
    $items = read_comments($file);
    $kept  = [];
    $gone  = 0;
    foreach ($items as $c) {
        $id = (string)($c['id'] ?? '');
        $p  = isset($c['parent']) && $c['parent'] !== null ? (string)$c['parent'] : '';
        if ($id === $cid || $p === $cid) {
            $gone++;
            continue;
        }
        $kept[] = $c;
    }
    if ($gone > 0) {
        write_comments($file, $kept, $COMMENT_BACKUP);
    }
    comments_unlock($fp);
    respond(['success' => true, 'removed' => $gone]);
}

respond(['error' => 'Unknown action.'], 400);
