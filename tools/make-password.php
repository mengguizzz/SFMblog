<?php
/**
 * 生成 config.php 用的密码哈希。
 *
 *     php tools/make-password.php '你的新密码'
 *
 * 输出的是 password_hash() 的结果（bcrypt，自带随机盐、故意算得慢），
 * 复制到 config.php 的 EXPECTED_HASH 里即可。
 *
 * 为什么不用裸 sha256：它太快了。本机实测每秒能算约 130 万次，
 * 6 位纯数字密码 0.24 秒就撞出来了。bcrypt 把单次成本抬高几个数量级，
 * 在线爆破和离线爆破都会变得不划算。
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("只能在命令行运行\n");
}

$password = $argv[1] ?? '';
if ($password === '') {
    fwrite(STDERR, "用法: php tools/make-password.php '你的新密码'\n");
    exit(1);
}
if (strlen($password) < 8) {
    fwrite(STDERR, "注意: 密码短于 8 位，建议再长一点。\n");
}

$hash = password_hash($password, PASSWORD_DEFAULT);

echo "\n复制下面这一行到 config.php：\n\n";
echo '<?php' . "\n";
echo '$EXPECTED_HASH = ' . var_export($hash, true) . ';' . "\n\n";
echo '算法: ' . (password_get_info($hash)['algoName'] ?? '?') . "\n";
echo '自检: ' . (password_verify($password, $hash) ? '通过' : '失败') . "\n";
