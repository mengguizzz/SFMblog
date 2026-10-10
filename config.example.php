<?php
/**
 * 复制这个文件为 config.php，然后填入你自己的密码哈希。
 * config.php 不会被提交到 Git（见 .gitignore），这样哈希就不会泄露到仓库里。
 *
 * 生成哈希（终端执行，注意 -n 不能省）：
 *     echo -n '你的密码' | sha256sum
 * Windows PowerShell：
 *     [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash(
 *       [Text.Encoding]::UTF8.GetBytes('你的密码'))).Replace('-','').ToLower()
 *
 * 填好后把 $EXPECTED_HASH 换成那串 64 位十六进制。
 */

$EXPECTED_HASH = '在这里粘贴 64 位 SHA-256 哈希';
