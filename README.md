# 🌌 Single-File-MD-Blog (极简单文件 Markdown 博客)

## 写在最前

**本项目使用Gemini生成，甚至这个readme也是的😂，使用它把我的想法变成了现实，其实原来的想法是从[Docsify](https://docsify.js.org/#/)找到的灵感，以后会加入更多功能**

我的博客：[梦归の小站](https://ztyou.cn)

一个写给折腾家和极客的极轻量级、**零数据库**个人博客系统。抛弃了臃肿的 MySQL 和繁杂的框架，回归纯文本的本质。

整个博客的所有文章，仅仅存储在一个 `.md` 文件中。

## ✨ 核心特性 (Features)

- **📄 零数据库 (Single-File DB)**：利用 `default.md` 作为单文件数据库，通过 `---POST---` 自定义分隔符进行数据切割与增改，备份博客只需复制一个文件夹。
- **💻 极客控制台 (Hacker Console)**：内置沉浸式深色双栏 Markdown 编辑器（支持实时预览、代码高亮）。
- **🖼️ 原生剪贴板图床 (Native Image Host)**：无需配置第三方图床！在编辑器直接 `Ctrl+V` 粘贴截图，自动上传至本地服务器并转为 Markdown 图片语法。
- **🔒 硬核安全防护 (Hardcore Security)**：
  - **暗门入口**：没有公开的登录按钮，点击页脚头像触发隐藏的终端风格 `login.html`。
  - **哈希鉴权**：服务器端（PHP）不保存任何明文密码，仅依靠纯底层的 `SHA-256` 散列指纹进行比对拦截。
- **🎨 液态玻璃美学 (Liquid Glass UI)**：全站采用高斯模糊与液态玻璃拟物化设计，原生支持 ☀️白天 / 🌙黑夜模式 丝滑切换。
- **📈 微型访问统计 (Visitor Counter)**：基于纯文本 `counter.txt` 的极简全站访问量记录器。

## 🛠️ 技术栈 (Tech Stack)

- **前端**：HTML5, CSS3, Vanilla JavaScript, Marked.js, Highlight.js
- **后端**：PHP 8.x (仅一个极简 `api.php` 脚本文件)
- **环境要求**：任何支持 PHP 的 Web 服务器（如 Nginx + PHP-FPM / OpenResty，完美适配 1Panel 等面板容器环境）。

## 📂 目录结构 (Directory Structure)

```text
├── index.html       # 首页 (最新文章展示)
├── archive.html     # 归档页 (时间轴展示)
├── post.html        # 文章阅读页
├── login.html       # 终端风格管理员登录页 (暗门)
├── console.html     # Markdown 后台编辑控制台
├── api.php          # 核心后端逻辑 (哈希校验/文件读写/图床上传/访问统计)
├── blogs/
│   ├── default.md   # 【核心】你的单文件数据库
│   └── counter.txt  # 访问量计数文件
├── src/
│   ├── webpic.png   # 网站头像/Favicon
│   └── images/      # 原生图床的图片保存目录
└── css/
    └── style.css    # 全局样式表 (液态玻璃 UI)
```

## 🚀 部署指南 (Deployment)

1. **生成你的专属密码指纹**
   在终端执行以下命令，获取你密码的 SHA-256 哈希值：
   ```bash
   echo -n 'YourPasswordHere' | sha256sum
   ```
2. **配置后端**
   打开 `api.php`，找到 `$expected_hash` 变量，将上一步生成的 64 位乱码粘贴进去。
3. **上传至服务器**
   将整个项目文件夹上传至你的 PHP Web 根目录。
4. **赋予权限 (极其重要)**
   在 Linux 服务器或 1Panel 中，将 `blogs/` 和 `src/images/` 文件夹的所有者修改为 `www-data` (或 `1000`)，或者直接赋予 `755`/`777` 读写权限，否则 PHP 将无法保存文章和图片。

## 🎮 使用方法 (How to use)

1. 正常访问首页 `index.html`。
2. 点击页面最底部右下角的**头像**，进入隐藏的登录界面。
3. 输入你的明文密码，进入 `Console`。
4. 愉快地使用 Markdown 和 `Ctrl+V` 粘贴图片进行创作，点击发布即可自动合并到 `default.md` 中。
5. 在文章阅读页，管理员状态下会自动显示「✏️ 编辑此文」按钮，支持随时修改。

---
*Talk is cheap. Show me the code.*
