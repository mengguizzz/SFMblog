#!/usr/bin/env bash
#
# 部署后体检：一条命令看清"权限对不对、该挡的有没有挡住"。
#
#   bash tools/doctor.sh                 # 默认查 /var/www/sfmblog
#   bash tools/doctor.sh /你的/站点目录
#   DOMAIN=ztyou.cn bash tools/doctor.sh /var/www/sfmblog   # 顺便从公网验一遍
#
# 只读，不改任何东西（唯一副作用是访问量 +1，用来验证 PHP 能不能写文件）。
#
set -uo pipefail

SITE="${1:-/var/www/sfmblog}"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-80}"

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
step() { printf '\n%s%s%s\n' "$B" "$*" "$N"; }

echo
echo "${B}SFMblog 体检${N}   站点：$SITE"
echo "————————————————————————————————————————"

# ---------------------------------------------------------------- 文件在不在
step "1. 文件"
[ -d "$SITE" ] || { bad "目录不存在：$SITE"; exit 1; }
for f in index.html api.php blogs/default.md tools/make-password.php; do
    [ -e "$SITE/$f" ] && ok "$f" || bad "缺少 $f"
done
if [ -f "$SITE/config.php" ]; then
    ok "config.php 在（$(stat -c '%U:%G %a' "$SITE/config.php" 2>/dev/null)）"
    if [ -r "$SITE/config.php" ]; then
        ok "当前用户能读它"
    else
        bad "连当前用户都读不了它 —— PHP 进程多半也读不了，登录页会报错"
    fi
else
    warn "没有 config.php —— 登录页会提示「服务端还没配置密钥指纹」"
fi

# ---------------------------------------------------------------- PHP 是谁
step "2. PHP 跑在哪个用户下"
PHPUSER=""
if command -v ps >/dev/null 2>&1; then
    PHPUSER="$(ps -eo user,comm 2>/dev/null | awk '/php-fpm|php-fpm8|php8/ && !/awk/ {print $1}' | sort -u | tr '\n' ' ')"
fi
[ -n "$PHPUSER" ] && ok "php-fpm 用户：$PHPUSER" || warn "没找到 php-fpm 进程（面板/容器环境可能看不到）"
ok "Web 服务器：$(command -v nginx >/dev/null 2>&1 && echo nginx || echo '?')"

# ---------------------------------------------------------------- 目录权限
step "3. 目录属主与权限"
for d in blogs comments src/images; do
    if [ -e "$SITE/$d" ]; then
        printf '  %-14s %s %s\n' "$d/" "$(stat -c '%U:%G' "$SITE/$d" 2>/dev/null)" "$(stat -c '%a' "$SITE/$d" 2>/dev/null)"
    else
        warn "$d/ 不存在（第一次写入时会自动建）"
    fi
done

# ---------------------------------------------------------------- 能不能写
step "4. PHP 能不能写文件（关键）"
BASE=""
for url in "http://127.0.0.1:$PORT" "http://localhost:$PORT"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url/api.php?action=peek" 2>/dev/null)"
    if [ "$code" = "200" ]; then BASE="$url"; break; fi
    LASTCODE="$code"
done
if [ -z "$BASE" ]; then
    case "${LASTCODE:-}" in
        503)
            bad "api.php 返回 503，它自己说了原因："
            curl -s -m 5 "$url/api.php?action=peek" | sed 's/^/       /'
            echo
            ;;
        500)
            bad "api.php 返回 500 —— PHP 报错了"
            echo "     → 最常见的原因：config.php 的属主/权限不对，PHP 进程读不了它"
            echo "       sudo chown www-data:www-data $SITE/config.php && sudo chmod 640 $SITE/config.php"
            echo "     具体报错看 PHP 错误日志："
            echo "       tail -20 /var/log/php*-fpm.log 2>/dev/null || journalctl -u 'php*fpm*' -n 20 --no-pager"
            ;;
        404|403)
            warn "api.php 返回 $LASTCODE —— 地址不对，或者被 Web 服务器挡住了"
            ;;
        "")
            warn "本机连不上 Web 服务，跳过（用 DOMAIN=你的域名 再跑一次也行）"
            ;;
        *)
            warn "api.php 返回 $LASTCODE，跳过写入检查"
            ;;
    esac
else
    C1="$(curl -fsS -m 5 "$BASE/api.php?action=peek" | sed 's/[^0-9]//g')"
    curl -fsS -m 5 "$BASE/api.php?action=counter" >/dev/null 2>&1
    C2="$(curl -fsS -m 5 "$BASE/api.php?action=peek" | sed 's/[^0-9]//g')"
    C3="$(curl -fsS -m 5 "$BASE/api.php?action=peek" | sed 's/[^0-9]//g')"
    if [ "$C3" != "$C1" ] || [ "$C2" != "$C1" ]; then
        ok "能写：访问量从 $C1 涨到了 $C2"
    else
        bad "写不进去！访问量一直是 $C1"
        echo "     → 会话文件也写不了，所以「登录成功但一点编辑就说未授权」"
        echo "     修法（把 <PHP用户> 换成上面第 2 步显示的那个，通常是 www-data）："
        echo "       sudo chown -R <PHP用户>:<PHP用户> $SITE/blogs $SITE/comments $SITE/src/images"
        echo "       sudo chmod 750 $SITE/blogs $SITE/comments"
    fi
fi

# ---------------------------------------------------------------- nginx 规则
step "5. 该挡的挡住了没有（最关键）"
CHK="$BASE"
[ -n "$DOMAIN" ] && CHK="https://$DOMAIN"
if [ -z "$CHK" ]; then
    warn "没有可用的地址，跳过"
else
    EXPOSED=0
    for p in /blogs/default.md /blogs/counter.txt /blogs/.backup/default.md.bak /comments/1.json /config.php; do
        code="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$CHK$p")"
        case "$code" in
            403|404) ok "$p -> $code" ;;
            *)       bad "$p -> $code   ← 不该能访问！"; EXPOSED=1 ;;
        esac
    done
    if [ "$EXPOSED" -eq 1 ]; then
        echo
        echo "     在站点的 nginx 配置里补上这几条（server {} 里面），然后 nginx -t && systemctl reload nginx："
        echo
        sed 's/^/       /' <<'NGINX'
location ^~ /.well-known/ { allow all; }
location ^~ /blogs/    { deny all; }
location ^~ /comments/ { deny all; }
location = /config.php { deny all; }
location ~ /\.         { deny all; }
location ~* \.(bak|tmp)$ { deny all; }
NGINX
        echo
        echo "     注意：/.well-known/ 那条要放最前面，否则签发/续期 HTTPS 证书会失败。"
    fi
fi

# ---------------------------------------------------------------- 收尾
step "6. 环境"
if command -v php >/dev/null 2>&1; then
    ok "PHP $(php -r 'echo PHP_VERSION;')"
    for ext in mbstring json; do
        php -m | grep -qi "^$ext$" && ok "扩展 $ext" || bad "缺少扩展 $ext"
    done
    php -m | grep -qi '^fileinfo$' && ok "扩展 fileinfo（图床上传要用）" || warn "没有 fileinfo：图床上传不可用"
else
    warn "命令行里没有 php，跳过"
fi

echo
echo "————————————————————————————————————————"
echo "体检完。上面标 ✗ 的就是要修的地方。"
echo
