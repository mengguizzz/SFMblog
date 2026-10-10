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
- **🔒 服务器端鉴权**：没有公开的登录入口，点击页脚头像进入隐藏的 `login.html`；密码只在服务端比对 SHA-256，登录时会先向服务器校验再放行。
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
├── blogs/
│   ├── default.md      # 【核心】单文件数据库
│   └── counter.txt     # 访问量计数
├── src/
│   ├── webpic-head.png # 头像 / Favicon
│   ├── webpic-foot.jpg # 页脚头像（也是后台暗门）
│   └── images/         # 图床保存目录（自动创建）
├── css/style.css       # 全局样式（设计系统）
└── js/blog.js          # 前端逻辑（解析 / 渲染 / 交互）
```

## 🚀 部署指南

### 1. 生成密码哈希

```bash
echo -n 'YourPasswordHere' | sha256sum
```

> ⚠️ `-n` 不能省，否则会把换行符也算进去，导致永远登录不上。

### 2. 配置密钥

把 `config.example.php` 复制成 **`config.php`**，填入上一步生成的 64 位哈希：

```php
<?php
$EXPECTED_HASH = 'c3f425cd905806aa89d15f7f38e58ec5ec2e606b04ff20c36da52eb647bccc01';
```

`config.php` 已在 `.gitignore` 里，不会被提交到仓库。
**没有配置它的话，登录页会明确提示「服务端还没配置密钥指纹」，不会静默放行。**

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

## 🔧 这一版改了什么

**修掉的 bug**

- 编辑 / 删除文章的索引与前端列表索引现在完全一致（原实现遇到空块会改错文章）。
- 摘要不再把 ` ```cpp ` 这种代码围栏当成正文展示。
- 文章页与关于页原先写死的浅色配色改为变量，黑夜模式不再失效。
- 关于页多出来的一个 `>` 字符已删除。
- 登录页原先不校验密码、输入什么都放行，现在改为先向服务器验证。
- 图片上传增加了真实图片类型校验与体积上限。
- 外链图片失效时给出占位说明，不再显示破图标。

**视觉与体验**

- 新增动态极光背景层，让玻璃拟态真正有东西可以「透」。
- 统一了排版尺度、间距、圆角与阴影层级。
- 导航栏改为自适应胶囊样式，小屏自动折叠为菜单。
- 主题切换图标由 emoji 换成 SVG，跟随系统主题且刷新不闪白。
- 文章页新增阅读进度条、目录、代码复制、上下篇导航。
- 控制台新增工具栏、字数统计、草稿自动保存与文章列表抽屉。

---
*Talk is cheap. Show me the code.*
