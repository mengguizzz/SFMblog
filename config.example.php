<?php
/**
 * 把这个文件复制成 config.php，填上你自己的密码哈希，就好了。
 *
 * config.php 在 .gitignore 里，不会被提交到 Git —— 哈希不会泄露到仓库。
 *
 * 怎么生成哈希：
 *
 *     php tools/make-password.php '你的新密码'
 *
 * 把输出的那串（形如 $2y$12$...）粘到下面。
 *
 * ⚠️ 不要再用 `echo -n '密码' | sha256sum` 那种裸 sha256：
 *    它快到可以拿显卡暴力破解。程序为了兼容旧配置仍然认 64 位十六进制，
 *    但会返回 legacy: true 提醒你尽快换掉。
 */

$EXPECTED_HASH = '$2y$12$在这里粘贴 tools/make-password.php 的输出';

/**
 * 评论是否先审后发。
 *
 *   true （默认）—— 新评论进「待审核」，你在控制台点「通过」才显示；
 *   false        —— 发出来立刻可见（蜜罐、提交耗时、IP 限流照样生效）。
 *
 * 不写这一行就用默认值 true。
 */
// $COMMENT_MODERATE = true;
