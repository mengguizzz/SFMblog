#!/usr/bin/env bash
#
# SFMblog 一键安装
# ---------------------------------------------------------------------------
#   bash install.sh                     # 交互式：问目录、问密码，然后装
#   bash install.sh --dir=/var/www/blog # 指定目录（不问）
#   bash install.sh --password='xxx'    # 指定密码（不问）
#   bash install.sh --nginx             # 顺手写一份 nginx 配置并 reload
#   bash install.sh --serve             # 装完直接用 php -S 起个本地预览
#   bash install.sh --dir=... -y        # 全默认、不问任何问题
#
# 它做四件事：检查环境 → 问装到哪、密码是什么 → 放文件写配置 → 设好权限。
# 不碰数据库（本来就没有），不装任何依赖，也不改系统里别的东西。
#
set -euo pipefail

REPO="${SFMBLOG_REPO:-mengguizzz/SFMblog}"
BRANCH="${SFMBLOG_BRANCH:-main}"
PREFIX_DEFAULT="./sfmblog"

DIR=""
PASSWORD=""
PORT="8080"
USE_NGINX=0
DOMAIN=""
DO_SERVE=0
FORCE=0
ASSUME_YES=0

# ------------------------------------------------------------------ 输出小工具
if [ -t 1 ]; then
    B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else
    B=""; DIM=""; G=""; Y=""; R=""; N=""
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$N"; }

for arg in "$@"; do
    case "$arg" in
        --dir=*)      DIR="${arg#*=}" ;;
        --password=*) PASSWORD="${arg#*=}" ;;
        --port=*)     PORT="${arg#*=}" ;;
        --domain=*)   DOMAIN="${arg#*=}" ;;
        --nginx)      USE_NGINX=1 ;;
        --serve)      DO_SERVE=1 ;;
        --force)      FORCE=1 ;;
        -y|--yes)     ASSUME_YES=1 ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) die "不认识的参数：$arg（用 --help 看用法）" ;;
    esac
done

say ""
say "${B}SFMblog 一键安装${N}  ${DIM}零数据库的单文件 Markdown 博客${N}"
say "${DIM}————————————————————————————————${N}"

# ------------------------------------------------------------------ 1. 环境检查
step "1/4 检查环境"

command -v php >/dev/null 2>&1 || die "没找到 php。先装一个：apt install php-fpm php-mbstring"
PHP_VER="$(php -r 'echo PHP_VERSION;')"
php -r 'exit(version_compare(PHP_VERSION, "8.0.0", ">=") ? 0 : 1);' \
    || die "PHP 版本太低（$PHP_VER），需要 8.0 以上"
ok "PHP $PHP_VER"

MISSING=""
for ext in mbstring json; do
    php -m | grep -qi "^$ext$" || MISSING="$MISSING $ext"
done
[ -z "$MISSING" ] || die "缺少 PHP 扩展：$MISSING（apt install php-${MISSING# }）"
php -m | grep -qi '^fileinfo$' || warn "没有 fileinfo 扩展：图床上传会用不了，其它功能正常"
ok "扩展齐全（mbstring / json）"

INTERACTIVE=0
[ -t 0 ] && INTERACTIVE=1

# ------------------------------------------------------------------ 2. 选目录
step "2/4 选择安装位置"

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
IS_CHECKOUT=0
[ -f "$SRC_DIR/api.php" ] && [ -f "$SRC_DIR/tools/make-password.php" ] && IS_CHECKOUT=1

if [ -z "$DIR" ]; then
    if [ "$INTERACTIVE" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ]; then
        printf '  装到哪个目录？直接回车用 %s\n  > ' "$PREFIX_DEFAULT"
        read -r ANSWER || true
        DIR="${ANSWER:-$PREFIX_DEFAULT}"
    else
        DIR="$PREFIX_DEFAULT"
    fi
fi
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
ok "安装目录：$DIR"

if [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && [ "$FORCE" -ne 1 ]; then
    die "$DIR 不是空目录。要么换个目录，要么加 --force（会覆盖同名文件）"
fi

# ------------------------------------------------------------------ 3. 设密码
step "3/4 设置后台密码"

GENERATED=0
if [ -z "$PASSWORD" ] && [ "$INTERACTIVE" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ]; then
    printf '  后台密码（直接回车 = 随机生成一个，稍后会打出来）\n'
    printf '  > '
    read -rs PASSWORD || true
    say ""
fi
if [ -z "$PASSWORD" ]; then
    PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)"
    GENERATED=1
    ok "已随机生成一个密码（装完会显示，先记下来）"
else
    [ ${#PASSWORD} -ge 8 ] || warn "密码不到 8 位，建议长一点"
    ok "密码已设置（不会写进代码，只存 bcrypt 哈希）"
fi

if [ "$INTERACTIVE" -eq 1 ] && [ "$ASSUME_YES" -ne 1 ]; then
    printf '\n  确认：装到 %s%s，继续？[Y/n] ' "$DIR" "$([ "$USE_NGINX" -eq 1 ] && echo "，并写一份 nginx 配置")"
    read -r GO || true
    case "${GO:-y}" in
        [yY]*) ;;
        *) say "  算了，什么都没做。"; exit 0 ;;
    esac
fi

# ------------------------------------------------------------------ 4. 放文件
step "4/4 放文件、写配置、设权限"

if [ "$IS_CHECKOUT" -eq 1 ] && [ "$SRC_DIR" != "$DIR" ]; then
    # 从克隆下来的仓库里装：直接复制，不走网络
    for item in "$SRC_DIR"/* "$SRC_DIR"/.gitignore; do
        [ -e "$item" ] || continue
        cp -R "$item" "$DIR"/ 2>/dev/null || true
    done
    ok "从本地目录复制到 $DIR"
else
    # 单独下载这个脚本跑的：拉一份最新的代码
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$URL" -o "$TMP/src.tgz" || die "下载失败：$URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$TMP/src.tgz" "$URL" || die "下载失败：$URL"
    else
        die "既没有 curl 也没有 wget，下载不了。可以先 git clone 再跑 $0"
    fi
    tar -xzf "$TMP/src.tgz" -C "$TMP" || die "解压失败"
    INNER="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
    cp -R "$INNER"/. "$DIR"/
    ok "已下载 $REPO@$BRANCH 到 $DIR"
fi

for f in index.html api.php tools/make-password.php blogs/default.md; do
    [ -f "$DIR/$f" ] || die "文件不全：缺 $f"
done
ok "文件齐全"

# ------------------------------------------------------------------ 写配置
HASH="$(php "$DIR/tools/make-password.php" --raw "$PASSWORD")" || die "生成哈希失败"
cat > "$DIR/config.php" <<EOF
<?php
// 由 install.sh 生成 —— 这个文件不要提交到 Git（已在 .gitignore 里）
\$EXPECTED_HASH = '$HASH';

// 评论要不要先审核再显示（默认 true）
// \$COMMENT_MODERATE = true;
EOF
chmod 600 "$DIR/config.php"
ok "config.php 已生成（bcrypt 哈希，权限 600）"

mkdir -p "$DIR/comments" "$DIR/src/images" "$DIR/blogs/.backup"
chmod 750 "$DIR/blogs" "$DIR/comments" 2>/dev/null || true
chmod 755 "$DIR/src" "$DIR/src/images" 2>/dev/null || true
ok "blogs/ 与 comments/ 设成 750（同机器的其它用户读不到）"

if [ "$(id -u)" -eq 0 ]; then
    OWNER="$(stat -c '%U' "$DIR" 2>/dev/null || echo root)"
    if id www-data >/dev/null 2>&1; then OWNER=www-data; fi
    chown -R "$OWNER":"$OWNER" "$DIR/blogs" "$DIR/comments" "$DIR/src/images" "$DIR/config.php" 2>/dev/null || true
    ok "属主设为 $OWNER"
else
    warn "当前不是 root，跳过 chown —— 记得让 Web 服务器用户能写 blogs/ 和 comments/"
fi

# ------------------------------------------------------------------ 可选的 nginx
if [ "$USE_NGINX" -eq 1 ]; then
    step "附加：写一份 nginx 配置"
    if [ -z "$DOMAIN" ]; then
        printf '  域名或 IP（回车 = _ 表示默认站）：'
        read -r DOMAIN || true
    fi
    [ -n "$DOMAIN" ] || DOMAIN="_"
    CONF="/etc/nginx/sites-available/sfmblog.conf"
    if [ ! -d /etc/nginx/sites-available ]; then
        warn "没找到 /etc/nginx，跳过。手动配的话照 README 里那段即可"
    elif [ "$(id -u)" -ne 0 ]; then
        warn "不是 root，写不进 /etc/nginx，跳过"
    else
        cat > "$CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    root $DIR;
    index index.html;
    charset utf-8;
    client_max_body_size 12m;

    location ^~ /blogs/    { deny all; }
    location ^~ /comments/ { deny all; }
    location = /config.php { deny all; }
    location ~ /\.         { deny all; }
    location ~* \.(bak|tmp)$ { deny all; }

    location / { try_files \$uri \$uri/ =404; }
    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.5-fpm.sock;
        fastcgi_read_timeout 120s;
    }
    location ~* \.(jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
EOF
        ok "写好了 $CONF"
        warn "里面的 php-fpm 版本（php8.5-fpm.sock）按你的实际版本改一下"
        if [ -d /etc/nginx/sites-enabled ]; then
            ln -sf "$CONF" /etc/nginx/sites-enabled/sfmblog.conf
        fi
        if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
            systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
            ok "nginx 已 reload"
        else
            warn "nginx -t 没过，先别 reload：检查上面的 php-fpm 路径"
        fi
    fi
fi

# ------------------------------------------------------------------ 收尾
say ""
say "${G}${B}装好了。${N}"
say ""
say "  目录     ${DIM}$DIR${N}"
if [ "$GENERATED" -eq 1 ]; then
    say "  后台密码 ${B}$PASSWORD${N}   ${Y}（这是随机生成的，先记下来）${N}"
else
    say "  后台密码 就是你刚才输入的那个"
fi
if [ "$USE_NGINX" -eq 1 ]; then
    say "  访问     http://${DOMAIN:-\_}/"
else
    say "  起步     ${B}cd $DIR && php -S 127.0.0.1:$PORT${N}"
    say "           然后打开 http://127.0.0.1:$PORT/"
fi
say ""
say "  ${DIM}进后台：点页面底部那个小头像（入口不在导航里）${N}"
say "  ${DIM}改密码：php tools/make-password.php '新密码'，把输出填进 config.php${N}"
if [ "$USE_NGINX" -ne 1 ]; then
    say ""
    say "  ${Y}注意：php -S 只是本地预览，它不会挡 blogs/ 和 comments/，别拿它对外提供服务。${N}"
fi
say ""

if [ "$DO_SERVE" -eq 1 ]; then
    say "${DIM}正在起本地预览（Ctrl+C 结束）…${N}"
    cd "$DIR" && exec php -S "127.0.0.1:$PORT"
fi
