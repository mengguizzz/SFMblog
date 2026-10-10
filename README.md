# 🌌 Single-File-MD-Blog (极简单文件 Markdown 博客)

## 写在最前

最初的想法来自 [Docsify](https://docsify.js.org/#/)，第一版由 Gemini 生成。
现在这一版是在保留「零数据库 / 单文件 Markdown」这个核心思路的前提下，
重做了视觉设计与交互，并修掉了一批会真正踩到的问题。

我的博客：[梦归の小站](https://ztyou.cn)

一个写给折腾家和极客的极轻量级、**零数据库**个人博客系统。
抛弃了臃肿的 MySQL 和繁杂的框架，回归纯文本的本质 —— 所有文章都存在一个 `.md` 文件里。

## ✨ 核心特性

- **📄 零数据库**：`blogs/default.md` 就是数据库，用 `---POST---` 分隔文章，备份博客只需复制一个文件夹。
- **💻 极客控制台**：沉浸式深色双栏 Markdown 编辑器，实时预览、代码高亮、快捷键、字数统计、草稿自动保存。
- **🖼️ 原生剪贴板图床**：编辑器里 `Ctrl+V` 粘贴截图，自动上传并转成 Markdown 图片语法，**服务端会校验真实图片类型**。
- **🔒 服务器端鉴权**：没有公开的登录入口，点击页脚头像进入隐藏的 `login.html`。
  密码用 **bcrypt** 存储、只在登录那一次请求里发送，服务器换回一个随机会话 id；
  浏览器里存的是会话 id 而不是明文密码，退出登录即刻失效，连续失败会被锁定。
- **🧩 服务端渲染**：文章列表 / 正文由 `api.php` 按需返回，
  **`blogs/default.md` 不允许被直接下载**，所以回收站里的文章、草稿不会外泄。
- **🎨 液态玻璃 UI**：动态极光背景 + 高斯模糊玻璃卡片，☀️ 白天 / 🌙 黑夜模式丝滑切换，且跟随系统主题。
- **📖 阅读体验**：文章页带阅读进度条、右侧目录（滚动高亮）、代码块复制、上下篇导航、标题锚点。
- **📈 访问统计**：基于 `blogs/counter.txt` 的极简全站访问计数。

## 🛠️ 技术栈

- **前端**：HTML5、CSS3（原生自定义属性 / Grid / backdrop-filter）、Vanilla JS、Marked.js、Highlight.js
- **后端**：PHP 8.x
- **环境**：任何支持 PHP 的 Web 服务器（Nginx + PHP-FPM / OpenResty，1Panel 等面板环境均可）
- **无构建步骤**：改完文件直接上传即可

## 📂 目录结构

```text
├── index.html          # 首页：Hero + 最新文章
├── archive.html        # 归档：统计卡片 + 年份时间轴
├── post.html           # 文章阅读页
├── login.html          # 隐藏的登录入口（终端风格）
├── console.html        # Markdown 后台控制台
├── api.php             # 后端接口（鉴权 / 文件读写 / 图床上传 / 访问统计）
├── config.example.php  # 配置模板（复制为 config.php 并填哈希）
├── tools/
│   └── make-password.php  # 生成 bcrypt 密码哈希
├── blogs/
│   ├── default.md      # 【核心】单文件数据库
│   ├── counter.txt     # 访问量计数
│   ├── .backup/        # 每次写入前的上一版（Web 不可访问）
│   └── .sessions/      # 登录会话与失败计数（Web 不可访问）
├── src/
│   ├── webpic-head.png # 头像 / Favicon
│   ├── webpic-foot.jpg # 页脚头像（也是后台暗门）
│   └── images/         # 图床保存目录（自动创建）
├── css/style.css       # 全局样式（设计系统）
└── js/blog.js          # 前端逻辑（解析 / 渲染 / 交互）
```

> `blogs/` 整个目录在 nginx 里是 `deny all`。页面数据一律走下面的接口。

## 🔌 接口一览

| 接口 | 是否需要登录 | 说明 |
| --- | --- | --- |
| `GET api.php?action=list` | 否 | 文章列表：id / 标题 / 日期 / 标签 / 摘要 / 阅读时长。**不含正文，不含已删除文章** |
| `GET api.php?action=post&id=N` | 否 | 单篇文章（含正文）。已删除的返回 404 + `deleted:true` |
| `GET api.php?action=counter` / `peek` | 否 | 访问量 +1 / 只读取 |
| `POST action=login` | – | 用密码换 `sid`（失败会累计，超过 8 次锁 15 分钟） |
| `POST action=logout` | 是 | 注销当前会话 |
| `POST action=all` | 是 | 控制台用：全部文章（含回收站）和正文 |
| `POST action=add / edit / delete / restore` | 是 | 增 / 改 / 软删除 / 恢复 |
| `POST action=trash / trash-purge` | 是 | 列出回收站 / 彻底删除 |
| `POST action=upload` | 是 | 图床上传（校验真实图片类型，上限 10MB） |

所有需要登录的接口校验的是 `sid`，**不再接受"把密码当 token 发"**。

## 🚀 部署指南

### 1. 生成密码哈希

```bash
echo -n 'YourPasswordHere' | sha256sum
```

> ⚠️ `-n` 不能省，否则会把换行符也算进去，导致永远登录不上。

### 2. 配置密钥

先生成一个 bcrypt 哈希（**不要再用裸 sha256**，它快到可以暴力破解）：

```bash
php tools/make-password.php '你的新密码'
```

把输出复制成 **`config.php`**：

```php
<?php
$EXPECTED_HASH = '$2y$12$...';   // tools/make-password.php 的输出
```

`config.php` 已在 `.gitignore` 里，不会被提交到仓库。
**没有配置它的话，登录页会明确提示「服务端还没配置密钥指纹」，不会静默放行。**

> 兼容旧配置：如果 `$EXPECTED_HASH` 还是 64 位十六进制，程序仍然接受（按 sha256 比对），
> 但登录时会返回 `legacy: true` 提醒你尽快换掉。

### 3. 上传并授权

把整个目录上传到 PHP 站点根目录，然后确保 `blogs/` 和 `src/images/` 可写：

```bash
chown -R www-data:www-data blogs src/images
# 或者
chmod -R 755 blogs src/images
```

### 4. Nginx 参考配置

```nginx
server {
    listen 80;
    server_name your.domain.com;

    root /var/www/sfmblog;
    index index.html;
    charset utf-8;
    client_max_body_size 12m;          # 图床上传上限

    location = /config.php { deny all; }   # 密钥文件永远不对外
    location ~ /\.          { deny all; }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.5-fpm.sock;   # 按实际版本改
        fastcgi_read_timeout 120s;
    }

    location ~* \.(jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

改完执行 `nginx -t && systemctl reload nginx`。

## 🎮 使用方法

1. 访问首页 `index.html`。
2. 点击页面右下角页脚的**头像**，进入隐藏登录页。
3. 输入密码，校验通过后进入控制台。
4. 顶部工具栏可以插入标题 / 加粗 / 列表 / 代码块 / 表格等；`Ctrl+V` 直接粘图上床。
5. 点「发布」写回 `default.md`；点「文章」抽屉可以载入历史文章继续编辑或删除。
6. 登录状态下，文章页会出现「✏️ 编辑此文」按钮。

常用快捷键：`Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+K` 链接、`Ctrl+S` 保存发布。

## 🧾 文章格式

每篇文章就是这个样子，`---POST---` 之间即为一篇：

```markdown
# 文章标题
<!-- DATE: 2025-08-13 | TAG: Linux, 教程 -->

正文内容……

---POST---

# 第二篇
<!-- DATE: 2025-08-01 | TAG: 折腾 -->

……
```

- `TAG` 支持用逗号分隔多个标签；
- 空块不计入编号，所以手动多敲几个换行不会让文章的 `id` 错位；
- 首页摘要会自动剥掉代码块、图片、标题和链接，只保留正文第一段。

### 删除 = 打标记，不是删掉

删除一篇文章时，PHP **不会**把它从 `default.md` 里移除，只是在 `DATE` 注释下面插一行：

```markdown
# 某篇文章
<!-- DATE: 2025-08-13 | TAG: Linux -->
<!-- DELETED: 2026-10-10 10:14:35 -->

正文还完整地留在这里……
```

前台渲染时会跳过带这个标记的块，所以在控制台的「回收站」里点恢复，只要把那一行删掉即可。

这么做有两个好处：

1. **原文永远还在**。就算哪天 PHP 挂了、程序写错了，正文仍然明明白白躺在 `default.md` 里，
   用记事本就能救回来。
2. **链接不会失效**。文章 `id` 是它在文件里的**原始块下标**，删除不会让块移动，
   所以删掉第 3 篇不会导致第 4 篇之后的 `post.html?id=N` 集体改号。

控制台回收站里的「彻底删除」才会真正把块从文件中移除 ——
这一步会让后面的文章下标前移，界面上会专门提醒。

## 🔧 这一版改了什么

**修掉的 bug**

- 编辑 / 删除文章的索引与前端列表索引现在完全一致（原实现遇到空块会改错文章）。
- 摘要不再把 ` ```cpp ` 这种代码围栏当成正文展示。
- 文章页与关于页原先写死的浅色配色改为变量，黑夜模式不再失效。
- 关于页多出来的一个 `>` 字符已删除。
- 登录页原先不校验密码、输入什么都放行，现在改为先向服务器验证。
- 图片上传增加了真实图片类型校验与体积上限。
- 外链图片失效时给出占位说明，不再显示破图标。
- 写入改为「原子写 + 规范化」：先写临时文件再 rename，避免写到一半把整库写坏；
  反复增删不再让文件堆积空行。
- CRLF / LF 混用会让删除标记的增删吃掉一个 `\r`，写入时统一成 LF。

**视觉与体验**

- 新增动态极光背景层，让玻璃拟态真正有东西可以「透」。
- 统一了排版尺度、间距、圆角与阴影层级。
- 导航栏改为自适应胶囊样式，小屏自动折叠为菜单。
- 主题切换图标由 emoji 换成 SVG，跟随系统主题且刷新不闪白。
- 文章页新增阅读进度条、目录、代码复制、上下篇导航。
- 控制台新增工具栏、字数统计、草稿自动保存与文章列表抽屉。
- 控制台新增「回收站」：删除的文章可以查看、恢复，或选择彻底删除。

---
*Talk is cheap. Show me the code.*

---

## 🔐 关于安全的一点说明

这一版做过一轮实际的渗透测试，下面是明确的结论和仍然存在的限制。

**已经修掉的**

| 问题 | 现状 |
| --- | --- |
| 密码用裸 sha256 存，6 位数字 0.24 秒被爆破 | 改用 `password_hash()`（bcrypt，自带盐、故意慢） |
| 浏览器保存明文密码，每次请求都发一次 | 改成登录换 `sid`，浏览器只存随机会话 id，可随时注销，12 小时过期 |
| 没有任何登录限速 | 同一 IP 15 分钟内失败 8 次锁 15 分钟 |
| markdown 里的原始 HTML 会执行（持久化 XSS） | 加了白名单清洗；实测注入的 `<img onerror>` 不再执行 |
| 整份 `default.md` 可被下载，删除的文章也在里面 | `blogs/` 整个目录 deny，改由接口按需返回 |
| `default.md.bak` 可被下载，能看到删掉的内容 | 备份移到 `blogs/.backup/`（Web 不可访问） |
| 写入是"先截断再写"，中断会毁掉整个库 | 改成写临时文件 + `rename` 原子替换 |
| 没有安全响应头 | 补上 CSP / X-Frame-Options / nosniff / Referrer-Policy |

**仍然存在的限制（需要你自己权衡）**

1. **站点是纯 HTTP。** 密码虽然在传输中只有登录那一次，但仍然是明文发出去的，
   同一局域网里的人可以抓包看到。**要真正安全就得配 HTTPS**（哪怕是自签证书）。
   公网暴露的话，这个是第一优先级。
2. **整个数据库仍然是"公开内容"。** 接口只返回该看的字段，但文章正文本来就面向所有人，
   所以**不要把密码、密钥、私人信息写进正文**。
3. **`sid` 存在 `sessionStorage` 里。** 一旦站内出现 XSS，会话仍可能被偷走
   （但攻击者拿到的是可撤销的会话，不是你的密码本身）。清洗已挡住已知路径，
   真正的兜底是 CSP——目前为了内联脚本保留了 `'unsafe-inline'`，可以再收紧。
4. **没有备份策略。** `blogs/.backup/` 只保留上一版。真正重要的内容请自己定期
   把 `blogs/` 打包走。
