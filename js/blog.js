/* ============================================================================
   梦归の小站 · 前端逻辑
   单文件 Markdown 数据库 (blogs/default.md) 的读取、渲染与交互。
   文章块以 `---POST---` 分隔；块的序号（跳过空块后）即为文章 id，
   与 api.php 中的编辑 / 删除索引保持一致。
============================================================================ */
(function () {
    'use strict';

    var API = './api.php';
    var SESSION_KEY = 'sfmb_sid';          // 浏览器里只存会话 id，不存明文密码

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    /* ------------------------------------------------------------------ utils */
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ---------------------------------------------------- Markdown 安全渲染 */

    // 允许保留的标签。markdown 里写原始 HTML 时，只放行这些。
    var OK_TAGS = {
        A: 1, P: 1, BR: 1, HR: 1, SPAN: 1, DIV: 1,
        H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
        STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, DEL: 1, MARK: 1, SMALL: 1, SUB: 1, SUP: 1,
        UL: 1, OL: 1, LI: 1, DL: 1, DT: 1, DD: 1,
        BLOCKQUOTE: 1, PRE: 1, CODE: 1, KBD: 1, SAMP: 1,
        TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1,
        IMG: 1, FIGURE: 1, FIGCAPTION: 1, DETAILS: 1, SUMMARY: 1, INPUT: 1,
    };

    // 这些标签连同内容一起丢掉，不是拆掉标签保留文字
    var KILL_TAGS = {
        SCRIPT: 1, STYLE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1,
        APPLET: 1, FORM: 1, INPUT_TYPE_FILE: 0, LINK: 1, META: 1, BASE: 1,
        SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1, HEAD: 1,
    };

    var OK_ATTR = {
        href: 1, src: 1, alt: 1, title: 1, class: 1, id: 1, colspan: 1, rowspan: 1,
        start: 1, datetime: 1, loading: 1, decoding: 1, target: 1, rel: 1,
        type: 1, checked: 1, disabled: 1, align: 1, width: 1, height: 1,
    };

    function isSafeUrl(value) {
        var s = String(value == null ? '' : value).trim()
            .replace(/[\u0000-\u001f\u007f\s]/g, '').toLowerCase();
        if (!s) return false;
        if (/^(javascript|vbscript|data|blob|file):/.test(s)) return false;
        if (/^(https?:|mailto:|\/\/)/.test(s)) return true;
        if (/^[/#?.]/.test(s)) return true;
        return s.indexOf(':') === -1;              // 纯相对路径
    }

    /**
     * 白名单清洗 marked 的输出。
     *
     * marked 默认会把 markdown 里的原始 HTML 原样吐出来，而前端是 innerHTML 渲染的，
     * 所以一篇 `<img src=x onerror=...>` 就能变成持久化 XSS——配合"token 就是密码"
     * 的设计，可以反过来把管理员的密码读走。这里把危险标签、on* 事件和内联协议全部剥掉。
     */
    function sanitizeHtml(html) {
        var doc = new DOMParser().parseFromString(String(html), 'text/html');

        (function clean(node) {
            var kids = Array.prototype.slice.call(node.childNodes);
            for (var i = 0; i < kids.length; i++) {
                var el = kids[i];
                if (el.nodeType === 8) { el.remove(); continue; }   // 注释
                if (el.nodeType !== 1) continue;

                if (KILL_TAGS[el.tagName]) { el.remove(); continue; }

                if (!OK_TAGS[el.tagName]) {
                    // 不在白名单：拆掉标签本身，把里面的内容提上来
                    var parent = el.parentNode;
                    while (el.firstChild) parent.insertBefore(el.firstChild, el);
                    parent.removeChild(el);
                    clean(parent);          // 提到外面的内容还得再扫一遍
                    continue;
                }

                Array.prototype.slice.call(el.attributes).forEach(function (attr) {
                    var name = attr.name.toLowerCase();
                    var isUrl = (name === 'href' || name === 'src');
                    if (name.indexOf('on') === 0 || !OK_ATTR[name] || (isUrl && !isSafeUrl(attr.value))) {
                        el.removeAttribute(attr.name);
                    }
                });

                if (el.tagName === 'A') {
                    el.setAttribute('rel', 'noopener noreferrer');
                    if (el.getAttribute('target') === '_blank') el.setAttribute('target', '_blank');
                }
                clean(el);
            }
        })(doc.body);

        return doc.body.innerHTML;
    }

    /** 全站唯一的 Markdown 入口：解析 + 清洗 */
    function renderMarkdown(src) {
        if (!window.marked) return '<pre>' + esc(src) + '</pre>';
        return sanitizeHtml(marked.parse(String(src == null ? '' : src), { gfm: true, breaks: true }));
    }

    window.renderMarkdown = renderMarkdown;
    window.sfmbSessionKey = SESSION_KEY;
    window.sfmbIsAdmin = function () {
        try { return !!sessionStorage.getItem(SESSION_KEY); } catch (e) { return false; }
    };

    /* ----------------------------------------------------------------- parser */
    /*
     * 解析全部在服务端完成（api.php?action=list / post / all）。
     * 以前是浏览器 fetch 整份 blogs/default.md 再自己切割 ——
     * 那等于把整个数据库公开下载：已删除的文章、还没发布的草稿，
     * 任何人打开开发者工具都能拉走。现在只按需返回该看到的字段。
     */
    var _visible = null;

    function normalizePost(p) {
        var tags = (p.tags && p.tags.length) ? p.tags : ['Blog'];
        return {
            id: p.id,
            title: p.title || '无标题文章',
            date: p.date || '',
            dateISO: p.dateISO || '',
            tag: tags[0],
            tags: tags,
            summary: p.summary || '',
            minutes: p.minutes || 1,
            deleted: !!p.deleted,
            deletedAt: p.deletedAt || '',
            body: p.body || ''
        };
    }

    /** 公开列表：只有元信息，没有正文 */
    async function getAllPosts(force) {
        if (_visible && !force) return _visible;
        try {
            var res = await fetch(API + '?action=list', { cache: 'no-cache' });
            var data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
            _visible = (data.items || []).map(normalizePost);
        } catch (err) {
            console.error('[SFMblog] 读取文章列表失败：', err);
            _visible = _visible || [];
        }
        return _visible;
    }

    /** 单篇文章（含正文）。被删或不存在时返回 { error, deleted } */
    async function getPost(id) {
        try {
            var res = await fetch(API + '?action=post&id=' + encodeURIComponent(id), { cache: 'no-cache' });
            var data = await res.json().catch(function () { return {}; });
            if (res.ok && data.success) return { post: normalizePost(data.post) };
            return { error: data.error || ('HTTP ' + res.status), deleted: !!data.deleted };
        } catch (err) {
            return { error: '网络错误' };
        }
    }

    /** 控制台专用：带登录态，能拿到回收站里的文章和正文 */
    async function getAdminPosts() {
        var fd = new FormData();
        fd.append('action', 'all');
        fd.append('sid', sessionStorage.getItem(SESSION_KEY) || '');
        var res = await fetch(API, { method: 'POST', body: fd });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
        return (data.items || []).map(normalizePost);
    }

    window.getAllPosts = getAllPosts;
    window.getPost = getPost;
    window.getAdminPosts = getAdminPosts;

    /* ------------------------------------------------------------------ theme */
    function currentTheme() {
        return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    }

    function applyTheme(theme, persist) {
        document.documentElement.dataset.theme = theme;
        $$('meta[name="theme-color"]').forEach(function (m) {
            m.setAttribute('content', theme === 'dark' ? '#070810' : '#fdf1f7');
        });
        if (persist) { try { localStorage.setItem('theme', theme); } catch (e) { } }
        syncGiscusTheme();
    }

    function initTheme() {
        var btn = $('#theme-toggle');
        applyTheme(currentTheme(), false);
        if (!btn) return;
        btn.addEventListener('click', function () { switchTheme(btn); });
    }

    /**
     * 主题切换。
     * 有 View Transitions 的浏览器：
     *   白天 → 黑夜：新画面从按钮扩散铺满整屏；
     *   黑夜 → 白天：旧画面往按钮里缩回去，像被吸进去，露出下面的新画面。
     * 没有的（或用户开了减少动态效果）：直接切，交给 CSS 的过渡去平滑。
     */
    function switchTheme(btn) {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        var canWipe = typeof document.startViewTransition === 'function' && !prefersLess();

        if (!canWipe) {
            applyTheme(next, true);
            return;
        }
        if (switchTheme.busy) return;      // 连点两下时别叠一次切换
        switchTheme.busy = true;

        var box = btn ? btn.getBoundingClientRect() : null;
        var x = box ? box.left + box.width / 2 : window.innerWidth - 44;
        var y = box ? box.top + box.height / 2 : 40;

        // 半径取到"离按钮最远的那个角"，保证圆一定能盖满整屏
        var radius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
        );

        var root = document.documentElement;
        root.style.setProperty('--wipe-x', x.toFixed(1) + 'px');
        root.style.setProperty('--wipe-y', y.toFixed(1) + 'px');
        root.style.setProperty('--wipe-r', Math.ceil(radius) + 'px');

        // 去程扩散、回程收缩
        var dirClass = next === 'dark' ? 'theme-wipe-in' : 'theme-wipe-out';
        root.classList.add(dirClass);
        // 关键：截"新画面"之前先把所有 CSS 过渡关掉，
        // 否则截到的是过渡中的旧颜色，动画结束时真画面才补上 -> 闪一下
        root.classList.add('theme-switching');

        var transition = document.startViewTransition(function () { applyTheme(next, true); });
        transition.finished.finally(function () {
            /*
             * 等两帧再清理。
             *
             * finished 触发时伪元素树可能还没销毁；这时候如果先把 theme-wipe-* 摘掉，
             * 基础规则里的 animation:none 就会生效 —— 旧快照失去 clip-path，
             * 于是以整屏原样画出一帧。旧快照是旧主题的颜色，看上去就是"闪一下"。
             * （实测录屏抓到了这一帧。）
             */
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    root.classList.remove('theme-wipe-in', 'theme-wipe-out');
                    root.classList.remove('theme-switching');
                    root.style.removeProperty('--wipe-x');
                    root.style.removeProperty('--wipe-y');
                    root.style.removeProperty('--wipe-r');
                    switchTheme.busy = false;
                });
            });
        });
    }

    /* ------------------------------------------------------------------- nav */
    function initNav() {
        var wrap = $('#nav-wrap');
        var burger = $('#nav-burger');
        var links = $('#nav-links');

        if (burger && links) {
            burger.addEventListener('click', function () {
                var open = links.classList.toggle('is-open');
                burger.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            document.addEventListener('click', function (e) {
                if (!links.contains(e.target) && !burger.contains(e.target)) {
                    links.classList.remove('is-open');
                    burger.setAttribute('aria-expanded', 'false');
                }
            });
        }

        if (wrap) {
            var onScroll = function () {
                wrap.classList.toggle('is-stuck', window.scrollY > 8);
            };
            onScroll();
            window.addEventListener('scroll', onScroll, { passive: true });
        }
    }

    /* --------------------------------------------------------------- to-top */
    function initToTop() {
        var btn = $('#to-top');
        if (!btn) return;
        var onScroll = function () {
            btn.classList.toggle('is-on', window.scrollY > 600);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    /* --------------------------------------------------------------- visits */
    async function initCounter() {
        var isAdmin = document.body.classList.contains('console-body') ||
            document.body.classList.contains('auth-body');
        var badge = $('#visit-num');
        var stat = $('#stat-visits');
        if (!badge && !stat) return;

        var show = function (n) {
            if (badge) badge.textContent = String(n).padStart(4, '0');
            if (stat) stat.textContent = n >= 10000
                ? (n / 10000).toFixed(1) + 'w'
                : String(n);
        };

        if (isAdmin) {
            try {
                var r0 = await fetch(API + '?action=peek');
                var d0 = await r0.json();
                if (d0 && d0.success) show(d0.count);
            } catch (e) { }
            return;
        }

        try {
            var res = await fetch(API + '?action=counter');
            var data = await res.json();
            if (data && data.success) show(data.count);
            else throw new Error('bad payload');
        } catch (err) {
            if (badge) badge.textContent = '——';
            if (stat) stat.textContent = '——';
        }
    }

    /* ------------------------------------------------------- index: cards */
    function postCard(post, i) {
        var tags = post.tags.map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
        }).join('');

        var summary = post.summary
            ? '<p class="post-card-summary">' + esc(post.summary) + '</p>'
            : '';

        return '<article class="post-card glass sheen" data-reveal style="--d:' + (i || 0) + '">' +
            '<a class="post-card-link" href="post.html?id=' + post.id + '">' +
            '<div class="post-card-top"><span class="tag-row">' + tags + '</span>' +
            '<time class="post-date" datetime="' + esc(post.dateISO) + '">' + esc(post.date || '未标注日期') + '</time>' +
            '</div>' +
            '<h3 class="post-card-title">' + esc(post.title) + '</h3>' +
            summary +
            '<div class="post-card-foot">' +
            '<span class="post-read">约 ' + post.minutes + ' 分钟</span>' +
            '<span class="read-more link-arrow">阅读全文' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
            '</span>' +
            '</div></a></article>';
    }

    async function renderIndex() {
        var box = $('#latest-posts-container');
        if (!box) return;

        var posts = await getAllPosts();

        if (!posts.length) {
            box.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' +
                '<strong>还没有文章</strong>去控制台写下第一篇吧。</div>';
            return;
        }

        box.innerHTML = posts.slice(0, 6).map(function (p, i) { return postCard(p, i); }).join('');

        var statPosts = $('#stat-posts');
        if (statPosts) statPosts.textContent = posts.length;

        var statTags = $('#stat-tags');
        if (statTags) {
            var set = {};
            posts.forEach(function (p) { p.tags.forEach(function (t) { set[t.toLowerCase()] = 1; }); });
            statTags.textContent = Object.keys(set).length;
        }
    }

    /* --------------------------------------------------------- archive */
    async function renderArchive() {
        var box = $('#archive-list-container');
        if (!box) return;

        var posts = await getAllPosts();

        if (!posts.length) {
            box.innerHTML = '<div class="empty-state"><strong>归档是空的</strong>还没有可展示的文章。</div>';
            return;
        }

        // 顶部统计
        var statsBox = $('#archive-stats');
        if (statsBox) {
            var years = {};
            var tagSet = {};
            posts.forEach(function (p) {
                var y = (p.dateISO || p.date || '').slice(0, 4) || '未知';
                years[y] = (years[y] || 0) + 1;
                p.tags.forEach(function (t) { tagSet[t.toLowerCase()] = (tagSet[t.toLowerCase()] || 0) + 1; });
            });
            var yearCount = Object.keys(years).length;
            var topTag = Object.keys(tagSet).sort(function (a, b) { return tagSet[b] - tagSet[a]; })[0] || '—';
            statsBox.innerHTML =
                '<div class="stat-card glass sheen" data-reveal style="--d:0"><strong>' + posts.length + '</strong><span>篇文章</span></div>' +
                '<div class="stat-card glass sheen" data-reveal style="--d:1"><strong>' + yearCount + '</strong><span>个年份</span></div>' +
                '<div class="stat-card glass sheen" data-reveal style="--d:2"><strong>' + Object.keys(tagSet).length + '</strong><span>个标签</span></div>' +
                '<div class="stat-card glass sheen" data-reveal style="--d:3"><strong class="stat-word">' + esc(topTag) + '</strong><span>最常出现的标签</span></div>';
        }

        // 按年份分组
        var groups = [];
        var index = {};
        posts.forEach(function (p) {
            var y = (p.dateISO || p.date || '').slice(0, 4) || '未知';
            if (!(y in index)) { index[y] = groups.length; groups.push({ year: y, items: [] }); }
            groups[index[y]].items.push(p);
        });

        box.innerHTML = groups.map(function (g) {
            var items = g.items.map(function (p, n) {
                var tags = p.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
                var short = (p.dateISO || p.date).slice(5) || '--';
                return '<a class="timeline-item" data-reveal style="--d:' + Math.min(n, 6) + '" href="post.html?id=' + p.id + '">' +
                    '<span class="timeline-date">' + esc(short || '--') + '</span>' +
                    '<span class="timeline-title">' + esc(p.title) + '</span>' +
                    '<span class="tag-row">' + tags + '</span>' +
                    '</a>';
            });

            return '<section class="year-group" data-reveal>' +
                '<h2 class="year-label">' + esc(g.year) + '<em>' + g.items.length + ' 篇</em></h2>' +
                items.join('') + '</section>';
        }).join('');
    }

    /* ------------------------------------------------------------ article */
    function slug(text, used) {
        var base = String(text).trim().toLowerCase()
            .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'section';
        var id = base, i = 2;
        while (used[id]) { id = base + '-' + i++; }
        used[id] = 1;
        return 'h-' + id;
    }

    function decorateContent(root, usedIds) {
        // 标题锚点
        $$('h2, h3', root).forEach(function (h) {
            if (!h.id) h.id = slug(h.textContent, usedIds);
            var a = document.createElement('a');
            a.className = 'h-anchor';
            a.href = '#' + h.id;
            a.setAttribute('aria-label', '复制该标题的链接');
            a.textContent = '#';
            h.appendChild(a);
        });

        // 代码块：语言标签 + 复制按钮
        $$('pre', root).forEach(function (pre) {
            var code = pre.querySelector('code');
            if (!code) return;

            var m = (code.className || '').match(/language-([\w+-]+)/);
            if (m) {
                var lang = document.createElement('span');
                lang.className = 'code-lang';
                lang.textContent = m[1];
                pre.appendChild(lang);
            }

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'copy-btn';
            btn.textContent = '复制';
            btn.addEventListener('click', function () {
                var text = code.innerText;
                var done = function () {
                    btn.textContent = '已复制';
                    btn.classList.add('is-done');
                    setTimeout(function () {
                        btn.textContent = '复制';
                        btn.classList.remove('is-done');
                    }, 1800);
                };
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text).then(done, function () { });
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); done(); } catch (e) { }
                    ta.remove();
                }
            });
            pre.appendChild(btn);
        });

        // 图片懒加载 + 失效兜底
        $$('img', root).forEach(function (img) {
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', function () {
                var alt = img.getAttribute('alt') || '图片';
                var box = document.createElement('div');
                box.className = 'media-fallback';
                box.innerHTML = '<b>「' + esc(alt) + '」暂时无法加载</b>' +
                    '<span>图片地址可能已失效，或源站禁止了外链引用。</span>';
                img.replaceWith(box);
            });
        });
    }

    function buildToc(root) {
        var toc = $('#toc');
        if (!toc) return;
        var heads = $$('h2, h3', root);
        if (heads.length < 2) return;

        toc.hidden = false;
        toc.innerHTML = '<div class="toc-title">目录</div>' +
            heads.map(function (h) {
                return '<a href="#' + h.id + '" class="' + (h.tagName === 'H3' ? 'lv3' : '') + '">' +
                    esc(h.textContent.replace(/#$/, '')) + '</a>';
            }).join('');

        var links = $$('a', toc);
        if (!('IntersectionObserver' in window)) return;

        var byId = {};
        links.forEach(function (a) { byId[decodeURIComponent(a.hash.slice(1))] = a; });

        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                links.forEach(function (a) { a.classList.remove('is-active'); });
                var active = byId[en.target.id];
                if (active) active.classList.add('is-active');
            });
        }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 });

        heads.forEach(function (h) { io.observe(h); });
    }

    function initReadingBar(article) {
        var bar = $('#reading-bar');
        if (!bar || !article) return;
        var tick = function () {
            var rect = article.getBoundingClientRect();
            var total = rect.height - window.innerHeight;
            var done = total <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / total));
            bar.style.transform = 'scaleX(' + done + ')';
        };
        tick();
        window.addEventListener('scroll', tick, { passive: true });
        window.addEventListener('resize', tick);
    }

    function renderPostNav(posts, current) {
        var box = $('#post-nav');
        if (!box) return;
        var i = posts.map(function (p) { return p.id; }).indexOf(current.id);
        var newer = i > 0 ? posts[i - 1] : null;
        var older = i >= 0 && i < posts.length - 1 ? posts[i + 1] : null;
        if (!newer && !older) return;

        var html = '';
        if (newer) {
            html += '<a class="glass sheen" href="post.html?id=' + newer.id + '">' +
                '<span class="lbl">← 上一篇</span><span class="ttl">' + esc(newer.title) + '</span></a>';
        }
        if (older) {
            html += '<a class="glass sheen next" href="post.html?id=' + older.id + '">' +
                '<span class="lbl">下一篇 →</span><span class="ttl">' + esc(older.title) + '</span></a>';
        }
        box.innerHTML = html;
    }

    async function renderPost() {
        var titleEl = $('#post-title');
        var content = $('#post-content');
        // 控制台页面也有 #post-title（只是输入框），必须同时存在正文容器才算文章页
        if (!titleEl || !content) return;

        var id = new URLSearchParams(location.search).get('id');

        if (id === null) {
            titleEl.textContent = '没有指定文章';
            content.innerHTML = '<p>请从 <a href="index.html">首页</a> 或 <a href="archive.html">归档</a> 点进一篇文章。</p>';
            $('#post-meta').innerHTML = '';
            return;
        }

        var fetched = await getPost(id);

        if (!fetched.post) {
            if (fetched.deleted) {
                titleEl.textContent = '这篇文章已被删除';
                content.innerHTML = '<p>它已经被放进回收站，暂时不对外显示。</p>' +
                    (window.sfmbIsAdmin()
                        ? '<p>你当前是登录状态，可以到 <a href="console.html">控制台</a> 的「回收站」里把它恢复回来。</p>'
                        : '');
            } else {
                titleEl.textContent = '文章不存在';
                content.innerHTML = '<p>链接里的 id 可能已经失效，请从 ' +
                    '<a href="index.html">首页</a> 或 <a href="archive.html">归档</a> 重新进入。</p>';
            }
            $('#post-meta').innerHTML = '';
            return;
        }

        var post = fetched.post;
        var posts = await getAllPosts();

        document.title = post.title + ' · 梦归の小站';
        var desc = document.querySelector('meta[name="description"]');
        if (desc && post.summary) desc.setAttribute('content', post.summary);

        titleEl.textContent = post.title;

        var meta = $('#post-meta');
        var parts = [];
        if (post.date) parts.push('<time datetime="' + esc(post.dateISO) + '">' + esc(post.date) + '</time>');
        parts.push('<span>约 ' + post.minutes + ' 分钟</span>');
        meta.innerHTML = parts.join('<span class="dot"></span>') +
            '<span class="dot"></span>' + post.tags.map(function (t) {
                return '<span class="tag">' + esc(t) + '</span>';
            }).join('');

        // 管理员：编辑入口
        if (window.sfmbIsAdmin()) {
            var chip = document.createElement('a');
            chip.className = 'edit-chip';
            chip.href = 'console.html?edit_id=' + post.id;
            chip.textContent = '✏️ 编辑此文';
            meta.appendChild(chip);
        }

        content.innerHTML = renderMarkdown(post.body);

        var used = {};
        decorateContent(content, used);

        if (window.hljs) {
            $$('pre code', content).forEach(function (b) {
                try { hljs.highlightElement(b); } catch (e) { }
            });
        }

        buildToc(content);
        renderPostNav(posts, post);
        initReadingBar($('.article'));
    }

    /* ------------------------------------------------------------------ boot */
    /* --------------------------------------------- 环境效果：浮现 / 雨 / 光 */

    function prefersLess() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * 滚动浮现。
     * "隐藏"的初始状态挂在 html.has-reveal 上，而这个类由 JS 添加 ——
     * JS 挂了的话元素就是正常可见，不会整页空白。
     */
    function initReveal() {
        var els = $$('[data-reveal]');
        if (!els.length) return;

        document.documentElement.classList.add('has-reveal');

        if (prefersLess() || !('IntersectionObserver' in window)) {
            els.forEach(function (el) { el.classList.add('is-in'); });
            // 后面动态插入的元素也直接标记成已显示，别再挂观察器
            window.sfmbObserveReveal = function () {
                $$('[data-reveal]:not(.is-in)').forEach(function (el) { el.classList.add('is-in'); });
            };
            return;
        }

        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                en.target.classList.add('is-in');
                io.unobserve(en.target);
            });
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

        els.forEach(function (el) { io.observe(el); });

        // 动态插入的元素（文章卡、时间轴条目）渲染完再注册
        window.sfmbObserveReveal = function () {
            $$('[data-reveal]:not(.is-in)').forEach(function (el) { io.observe(el); });
        };

        // 兜底：万一观察器没触发，3 秒后全部显示
        setTimeout(function () {
            $$('[data-reveal]:not(.is-in)').forEach(function (el) { el.classList.add('is-in'); });
        }, 3000);
    }

    /**
     * 终端雨：把代码字形当成雨点铺在极光之上、内容之下，
     * 这样玻璃卡片会把它模糊掉 —— 正好给"液态玻璃"提供要折射的东西。
     * 帧率故意压到 18fps 当背景纹理用，标签页切走就停。
     */
    function initRain() {
        if (prefersLess()) {
            document.documentElement.dataset.rain = 'off';
            return;
        }

        var canvas = document.createElement('canvas');
        canvas.className = 'rain';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);

        var ctx = canvas.getContext('2d');
        var GLYPHS = '01<>[]{}/\\$#*+=;:ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
        var SIZE = 15;
        var FRAME = 1000 / 18;
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        var cols = 0, drops = [], speeds = [], last = 0;
        var raf = 0;

        function resize() {
            var w = window.innerWidth, h = window.innerHeight;
            canvas.width = Math.max(1, Math.floor(w * dpr));
            canvas.height = Math.max(1, Math.floor(h * dpr));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            cols = Math.ceil(w / SIZE);
            drops = [];
            speeds = [];
            for (var i = 0; i < cols; i++) {
                drops[i] = Math.random() * -(h / SIZE);
                speeds[i] = 0.5 + Math.random() * 0.95;
            }
        }

        function tint() {
            return document.documentElement.dataset.theme === 'dark'
                ? '150,226,255'   // 深色模式用冷色，像终端荧光
                : '124,58,237';   // 浅色模式用紫色，压得住又不脏
        }

        function frame(now) {
            raf = requestAnimationFrame(frame);
            if (document.hidden) { last = now; return; }
            if (now - last < FRAME) return;

            var dt = Math.min(3, (now - last) / FRAME);
            last = now;

            var w = window.innerWidth, h = window.innerHeight;

            // 用 destination-out 一点点擦掉上一帧，形成拖尾
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,0.16)';
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';

            ctx.font = SIZE + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
            ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(' + tint() + ',0.9)';

            for (var i = 0; i < cols; i++) {
                drops[i] += speeds[i] * dt;
                var y = drops[i] * SIZE;
                if (y > h) {
                    drops[i] = Math.random() * -24;
                    y = drops[i] * SIZE;
                }
                ctx.fillText(GLYPHS.charAt((Math.random() * GLYPHS.length) | 0), i * SIZE + 2, y);
            }
        }

        function start() {
            if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
        }
        function stop() {
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
        }

        resize();
        window.addEventListener('resize', resize);

        /*
         * 默认关闭。
         *
         * 雨点每重绘一帧，玻璃背后的画面就变一次，页面上所有 backdrop-filter
         * 都得跟着重算。实测（关掉极光漂移之后）：
         *     雨开启  14.0% GPU
         *     雨关闭   6.2%
         *     雨调淡   7.3%   <- 调透明度几乎没用，开销在于"重绘"本身
         * 所以默认不开，当成彩蛋：在页面上敲 rain 打开。
         */
        if (!document.documentElement.dataset.rain) {
            document.documentElement.dataset.rain = 'off';
        }
        if (document.documentElement.dataset.rain !== 'off') { start(); }

        window.sfmbToggleRain = function () {
            var cur = document.documentElement.dataset.rain || 'off';
            var next = cur === 'off' ? 'low' : (cur === 'low' ? 'high' : 'off');
            document.documentElement.dataset.rain = next;
            if (next === 'off') { stop(); } else { start(); }
            return next;
        };
    }

    /** 指针柔光 + 玻璃卡上的高光（只在真有鼠标的设备上启用） */
    function initAmbientPointer() {
        if (prefersLess()) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

        document.documentElement.dataset.pointer = 'on';

        var spot = document.createElement('div');
        spot.className = 'spotlight';
        spot.setAttribute('aria-hidden', 'true');
        document.body.appendChild(spot);

        var tx = window.innerWidth * 0.5, ty = window.innerHeight * 0.28;
        var x = tx, y = ty;

        window.addEventListener('pointermove', function (e) {
            tx = e.clientX;
            ty = e.clientY;

            var card = e.target && e.target.closest ? e.target.closest('.glass') : null;
            if (!card) return;
            var r = card.getBoundingClientRect();
            card.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
            card.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
        }, { passive: true });

        (function loop() {
            requestAnimationFrame(loop);
            if (document.hidden) return;
            x += (tx - x) * 0.1;
            y += (ty - y) * 0.1;
            spot.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        })();
    }

    /** 把 [data-type] 里的文字一个字一个字打出来（光标用 CSS 画） */
    /**
     * 生成"透镜位移图"。
     *
     * 这是一张法线图：R 通道 = 水平位移方向，G 通道 = 垂直位移方向，
     * 128 表示"不动"。靠近边缘的地方把采样点往**外侧**推，
     * 于是玻璃边缘会像厚玻璃一样把外面的画面"吸"进来 —— 就是折射。
     * 中间是平坦区（值为 128，完全不位移），所以正中看过去是清楚的。
     */
    function buildLensMap(size, bevel, power) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var ctx = c.getContext('2d');
        var img = ctx.createImageData(size, size);
        var d = img.data;

        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var u = (x + 0.5) / size;
                var v = (y + 0.5) / size;

                // 到最近的左/右边和上/下边的归一化距离
                var ex = Math.min(u, 1 - u);
                var ey = Math.min(v, 1 - v);

                // 越靠近边缘越强，中间一段为 0；开方让过渡更像真实玻璃的斜边
                var tx = Math.max(0, 1 - ex / bevel);
                var ty = Math.max(0, 1 - ey / bevel);
                tx = Math.pow(tx, power);
                ty = Math.pow(ty, power);

                var dx = (u < 0.5 ? -1 : 1) * tx;
                var dy = (v < 0.5 ? -1 : 1) * ty;

                var i = (y * size + x) * 4;
                d[i] = Math.round((0.5 + dx * 0.5) * 255);
                d[i + 1] = Math.round((0.5 + dy * 0.5) * 255);
                d[i + 2] = 128;
                d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return c.toDataURL('image/png');
    }

    /**
     * 玻璃滤镜。
     *
     * 之前我以为 Chrome 不支持在 backdrop-filter 里用 url(#filter)，
     * 其实是实验写错了：滤镜区域用百分比、而外层 <svg> 是 0x0，
     * 区域直接塌成空的。改用默认区域（或以像素为单位）之后是生效的 —— 实测
     * 相对不挂滤镜有 69% 的像素差异。
     *
     * 于是这里就能直接折射**真实背板**（终端雨、极光、网格全都会跟着弯），
     * 不用再搞一份背景副本。
     */
    function initGlassFilter() {
        if (document.getElementById('sfm-lens')) return;

        var mapUrl = buildLensMap(256, 0.18, 2.4);
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'sfm-defs');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML =
            /*
             * primitiveUnits 必须是 objectBoundingBox：
             * 默认的 userSpaceOnUse 下，feImage 的 width="100%" 是按**视口**解析的，
             * 那张透镜图会被拉满整个视口，元素只能取到中间一小块 —— 结果就成了
             * "整体平移"而不是"边缘折射"。改成相对元素自身比例之后，
             * 图的 0..1 正好贴着元素边框，边缘才会真的把外面的画面吸进来。
             */
            '<filter id="sfm-lens" filterUnits="objectBoundingBox" ' +
            'primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">' +
                '<feImage href="' + mapUrl + '" preserveAspectRatio="none" ' +
                    'x="0" y="0" width="1" height="1" result="lens"/>' +
                // 位移：边缘把外圈画面吸进来
                '<feDisplacementMap in="SourceGraphic" in2="lens" scale="0.085" ' +
                    'xChannelSelector="R" yChannelSelector="G" result="bent"/>' +
                // 极轻的模糊，去掉位移带来的锯齿（不是磨砂）
                '<feGaussianBlur in="bent" stdDeviation="0.0012" result="soft"/>' +
                // 提饱和 + 微提亮，让透过来的颜色"更活"
                '<feColorMatrix in="soft" type="saturate" values="1.75" result="sat"/>' +
                '<feComponentTransfer in="sat">' +
                    '<feFuncR type="linear" slope="1.05"/>' +
                    '<feFuncG type="linear" slope="1.05"/>' +
                    '<feFuncB type="linear" slope="1.05"/>' +
                '</feComponentTransfer>' +
            '</filter>';
        document.body.appendChild(svg);
    }

    /** 把 [data-type] 里的文字一个字一个字打出来（光标用 CSS 画） */
    /**
     * 诊断面板：地址后面加 ?debug 就会显示。
     * 手机上的显示问题没法在模拟器里复现，只能让页面自己把真实环境报出来。
     */
    function initDebugPanel() {
        if (!/[?&]debug/.test(location.search)) return;

        function collect() {
            var cs = getComputedStyle(document.documentElement);
            return [
            ['主题 (data-theme)', document.documentElement.dataset.theme],
            ['系统深色偏好', window.matchMedia('(prefers-color-scheme: dark)').matches ? '深色' : '浅色'],
            ['color-scheme', cs.colorScheme],
            ['--bg-0', cs.getPropertyValue('--bg-0').trim()],
            ['html 背景', getComputedStyle(document.documentElement).backgroundColor],
            ['body 背景', getComputedStyle(document.body).backgroundColor],
            ['--ink-1', cs.getPropertyValue('--ink-1').trim()],
            ['视口 / DPR', window.innerWidth + '×' + window.innerHeight + '  @' + window.devicePixelRatio + 'x'],
            ['-- 看板娘 --', ''],
            ['鼠标环境合格', window.matchMedia('(hover: hover) and (pointer: fine)').matches ? '是' : '否'],
            ['视口足够宽(≥1024)', window.innerWidth >= 1024 ? '是' : '否'],
            ['减少动态效果', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '是' : '否'],
            ['存储里的开关', (function () { try { return localStorage.getItem('sfmb_pet') || '(未设置 → 默认关闭)'; } catch (e) { return '读取失败'; } })()],
            ['组件脚本是否加载', window.initWidget ? '已加载' : '未加载'],
            ['看板娘容器', document.getElementById('waifu') ? '存在' : '不存在'],
            ['模型 canvas', (function () {
                var c = document.querySelector('#waifu canvas');
                return c ? c.width + '×' + c.height : '不存在';
            })()],
            ['唤出按钮', document.getElementById('sfm-pet-btn') ? '存在' : '不存在'],
            ['UA', navigator.userAgent.slice(0, 110)],
            ];
        }

        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;max-width:min(94vw,540px);' +
            'padding:14px 16px;border-radius:14px;background:rgba(10,12,26,.92);color:#e8ecff;' +
            'font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.45)';

        function render() {
            box.innerHTML = '<b style="color:#f472b6">· 诊断信息（?debug，每秒刷新）·</b>\n\n' +
                collect().map(function (r) {
                    return '<span style="color:#8b93b5">' + r[0] + '：</span>' + esc(r[1]);
                }).join('\n');
        }
        render();
        setInterval(render, 1000);

        var close = document.createElement('button');
        close.textContent = '关闭';
        close.style.cssText = 'position:absolute;right:10px;top:8px;background:none;border:0;' +
            'color:#8b93b5;font:12px ui-monospace,monospace;cursor:pointer';
        close.addEventListener('click', function () { box.remove(); });

        box.appendChild(close);
        document.body.appendChild(box);
    }

    /** 把 [data-type] 里的文字一个字一个字打出来（光标用 CSS 画） */
    /**
     * 看板娘（Live2D）。
     *
     * 几个刻意的设计：
     *   - 只在桌面端加载：要求有真实鼠标指针 + 视口 ≥1024px。
     *     手机完全不加载 —— 不光是不显示，连那 1MB 的脚本都不去取。
     *   - 懒加载：等页面空闲再取脚本，不占首屏。
     *   - 系统开了"减少动态效果"就不加载。
     *   - 可收起，且记住选择：收起后只留一个小按钮，点了能召唤回来。
     *
     * 库选的是 live2d-widgets（MIT，stevenjoezhang/live2d-widget 的维护版）：
     * 它用的是 Cubism 2 的核心，**不需要 CSP 放开 unsafe-eval**。
     * 这点是实测出来的 —— 另一个更流行的 oh-my-live2d 内部用 PixiJS，
     * 在严格 CSP 下会直接报 "does not allow unsafe-eval" 并且渲染不出来。
     */
    function initLive2D() {
        var hasMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (!hasMouse || window.innerWidth < 1024 || prefersLess()) return;
        if (document.getElementById('sfm-pet-btn')) return;

        // 组件和模型都在自己的服务器上（src/live2d/），不依赖任何第三方 CDN
        var PATH = './src/live2d/widget/';
        var PET_KEY = 'sfmb_pet';
        var loading = false;

        /*
         * ↓↓↓ 想换模型改这两个值 ↓↓↓
         *
         * MODEL_CDN：模型仓库目录，里面要有 model_list.json 和 model/ 子目录。
         *            默认是站点自带的 './src/live2d/'。
         * MODEL_ID：用仓库里的第几个模型（从 0 开始）。
         *
         * 换成自己的模型：把模型放到 src/live2d/model/ 下，
         * 然后改 src/live2d/model_list.json 里的 models 数组。
         *
         * 现在仓库里只有 0 = 伊蕾娜（MNDIA 配布）。
         * 想换成别的模型，就往 model/ 里加一个，再改 model_list.json。
         */
        var MODEL_CDN = './src/live2d/';
        var MODEL_ID = 0;

        // 默认关闭：只有你点过"开启"才自动加载，免得占地方 / 吃 GPU
        var wantOn = false;
        try { wantOn = localStorage.getItem(PET_KEY) === 'on'; } catch (e) { }

        function makeButton() {
            var b = document.getElementById('sfm-pet-btn');
            if (b) return b;
            b = document.createElement('button');
            b.id = 'sfm-pet-btn';
            b.type = 'button';
            b.className = 'pet-btn glass';
            b.title = '唤出看板娘';
            b.setAttribute('aria-label', '唤出看板娘');
            b.innerHTML = '<span aria-hidden="true">🐾</span>';
            b.addEventListener('click', function () {
                try { localStorage.setItem(PET_KEY, 'on'); } catch (e) { }
                var toggle = document.getElementById('waifu-toggle');
                if (toggle) {
                    toggle.click();                 // 让组件自己滑回来
                    // 只有确认它真的出来了，才收掉这个按钮；
                    // 否则会出现"按钮没了、看板娘也没出来"的死局
                    setTimeout(function () {
                        var w = document.getElementById('waifu');
                        var visible = w && getComputedStyle(w).display !== 'none';
                        if (visible) { hideBtn(); } else { mount(); }
                    }, 900);
                } else {
                    mount();
                    hideBtn();
                }
            });
            document.body.appendChild(b);
            return b;
        }
        function showBtn() {
            var b = makeButton();
            requestAnimationFrame(function () { b.classList.add('is-on'); });
        }
        function hideBtn() {
            var b = document.getElementById('sfm-pet-btn');
            if (b) b.classList.remove('is-on');
        }

        /*
         * 一言（hitokoto）。
         *
         * 组件自带的那个按钮内部就是一句 `fetch("https://v1.hitokoto.cn")`，
         * **没有 try/catch** —— 断网、接口抽风、或者被墙的时候，
         * 结果是一条未捕获的报错 + 气泡什么都不显示，按钮点了像没反应。
         *
         * 所以这里在调组件之前把 fetch 包一层：**只有一言那个地址**失败时才自己兜一句，
         * 其余请求原样透传。用经典诗词当兜底，不会引错出处。
         */
        var LOCAL_QUOTES = [
            ['路漫漫其修远兮，吾将上下而求索。', '屈原《离骚》'],
            ['长风破浪会有时，直挂云帆济沧海。', '李白《行路难》'],
            ['山重水复疑无路，柳暗花明又一村。', '陆游《游山西村》'],
            ['行到水穷处，坐看云起时。', '王维《终南别业》'],
            ['海内存知己，天涯若比邻。', '王勃《送杜少府之任蜀州》'],
            ['纸上得来终觉浅，绝知此事要躬行。', '陆游《冬夜读书示子聿》'],
            ['不积跬步，无以至千里。', '《荀子·劝学》'],
            ['千淘万漉虽辛苦，吹尽狂沙始到金。', '刘禹锡《浪淘沙》'],
        ];

        function hitokotoFallback() {
            var q = LOCAL_QUOTES[Math.floor(Math.random() * LOCAL_QUOTES.length)];
            return new Response(JSON.stringify({ hitokoto: q[0], from: q[1], creator: '' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        function installHitokotoFallback() {
            if (window.__sfmHitokotoWrapped || typeof window.fetch !== 'function') return;
            window.__sfmHitokotoWrapped = true;
            var orig = window.fetch;
            window.fetch = function (input, init) {
                var url = typeof input === 'string' ? input : (input && input.url) || '';
                var p = orig.call(this, input, init);
                if (url.indexOf('hitokoto.cn') === -1) return p;
                return p.catch(hitokotoFallback);
            };
        }

        function start() {
            loading = false;
            hideBtn();
            installHitokotoFallback();
            window.initWidget({
                waifuPath: PATH + 'waifu-tips.json',
                cubism2Path: PATH + 'live2d.min.js',
                // 官方示例模型 Hiyori 是 Cubism 5 格式（.moc3），核心也自托管了
                cubism5Path: PATH + 'live2dcubismcore.min.js',
                cdnPath: MODEL_CDN,
                modelId: MODEL_ID,
                // 只有一个模型，切换和换装都没意义，就留"一言 / 关于 / 关闭"
                tools: ['hitokoto', 'info', 'quit'],
                logLevel: 'warn',
                drag: true,
            });

            // 关掉之后留一个召唤按钮（widget 自带的 toggle 在左下角，样式跟站点不搭，自己做一个）
            document.addEventListener('click', function (e) {
                var t = e.target;
                if (t && t.closest && t.closest('#waifu-tool-quit, .waifu-tool-quit')) {
                    try { localStorage.setItem(PET_KEY, 'off'); } catch (err) { }
                    setTimeout(showBtn, 500);
                }
            }, true);

            /*
             * 一言那个按钮有时候"点了没反应"。
             *
             * 组件内部用 sessionStorage 里的 waifu-message-priority 挡消息：
             * 新消息的优先级不高于当前正在显示的那条，就直接被丢弃。
             * 而刚进页面时的欢迎语优先级更高 —— 于是这时候点"一言"，
             * 请求发了、句子也拿到了，气泡里却还是欢迎语。
             *
             * 这里在捕获阶段先把那个优先级清掉（早点于组件自己的 click），
             * 让"用户主动点的一言"永远能显示出来。
             */
            document.addEventListener('click', function (e) {
                var t = e.target;
                if (t && t.closest && t.closest('#waifu-tool-hitokoto')) {
                    try { sessionStorage.removeItem('waifu-message-priority'); } catch (err) { }
                }
            }, true);
        }

        function loadCss(href) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            document.head.appendChild(l);
            return Promise.resolve();
        }
        function loadModule(src) {
            return new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.type = 'module';
                s.src = src;
                s.onload = resolve;
                s.onerror = function () { reject(new Error(src)); };
                document.head.appendChild(s);
            });
        }

        function mount() {
            if (loading || document.getElementById('waifu')) return;
            loading = true;
            Promise.all([
                loadCss(PATH + 'waifu.css'),
                loadModule(PATH + 'waifu-tips.js'),
            ]).then(start).catch(function (e) {
                loading = false;
                console.warn('[SFMblog] 看板娘加载失败：', e && e.message);
            });
        }

        if (!wantOn) {
            showBtn();                          // 默认关闭：只留按钮，一个字节都不下
        } else if ('requestIdleCallback' in window) {
            requestIdleCallback(mount, { timeout: 4000 });
        } else {
            setTimeout(mount, 1600);
        }
    }

    /** 把 [data-type] 里的文字一个字一个字打出来（光标用 CSS 画） */
    function initTypewriter() {
        var el = $('[data-type]');
        if (!el || prefersLess()) return;

        var full = el.getAttribute('data-type') || el.textContent || '';
        var i = 0;
        el.textContent = '';

        (function step() {
            i++;
            el.textContent = full.slice(0, i);
            if (i < full.length) {
                setTimeout(step, 42 + Math.random() * 58);
            } else {
                el.classList.add('type-caret');
            }
        })();
    }

    /* 公共页面的小提示（控制台里那份是页面自带的） */
    function toastMsg(text, kind) {
        var stack = $('.toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'toast-stack';
            document.body.appendChild(stack);
        }
        var el = document.createElement('div');
        el.className = 'toast ' + (kind || '');
        el.innerHTML = '<span class="bar"></span><span></span>';
        el.lastChild.textContent = text;
        stack.appendChild(el);
        setTimeout(function () {
            el.classList.add('is-out');
            setTimeout(function () { el.remove(); }, 320);
        }, 2400);
    }

    /* ------------------------------------------------------------- 留言（giscus） */
    /*
     * 留言存在 **GitHub 仓库的 Discussions** 里：
     * 不占服务器、不用数据库，跟这个站"零数据库"的路子是同一套思路。
     *
     * 用的是 giscus（utterances 的升级版）：它比 utterances 多两件事 ——
     *   1. 支持 postMessage 实时换主题，能跟着本站的白天/黑夜一起切；
     *   2. 评论区支持 GitHub 的 reaction，还能按"最新/最热"排。
     *
     * ⚠️ 只有这三个值需要你自己填，见 README 的「留言板」一节：
     *    1. 仓库 Settings 里把 Discussions 打开
     *    2. 给仓库装上 giscus App（https://github.com/apps/giscus）
     *    3. 去 https://giscus.app 选好仓库和分类，把它给的 `data-category-id` 抄到下面
     *    （repo / repoId 我已经填好了）
     *
     * 想临时换成别的仓库（比如测试用），在页面里覆盖 window.SFM_GISCUS_CONFIG 即可。
     */
    var GISCUS = {
        repo: 'mengguizzz/SFMblog',
        repoId: 'R_kgDOT6x8kg',
        category: 'Announcements',
        categoryId: '',            // ← 填上 giscus.app 给的那串 DIC_xxx 就会自动启用
    };

    function giscusTheme() {
        return currentTheme() === 'dark' ? 'dark' : 'light';
    }

    /** 主题切换时把新主题推给已经挂上去的评论区 */
    function syncGiscusTheme() {
        var t = giscusTheme();
        $$('iframe.giscus-frame').forEach(function (f) {
            try {
                f.contentWindow.postMessage({ giscus: { setConfig: { theme: t } } }, 'https://giscus.app');
            } catch (e) { }
        });
    }

    /**
     * 每篇文章对应哪个"讨论"。
     *
     * 用文章 id 当 term：本站的 id 就是原始块下标，**删掉前面的文章也不会变**，
     * 所以在哪一篇下面聊，就永远挂在哪一篇上（用 URL 当 term 反而会因为改域名/参数而丢）。
     */
    function giscusTerm() {
        var m = /[?&]id=(\d+)/.exec(location.search);
        return m ? 'post-' + m[1] : '';
    }

    function initComments() {
        var host = document.getElementById('sfm-comments');
        if (!host) return;

        var cfg = Object.assign({}, GISCUS, window.SFM_GISCUS_CONFIG || {});
        // cfg.term 可以直接指定某条 Discussion（默认按文章算）
        var term = cfg.term || giscusTerm();

        // 没有文章 id（比如直接把 post.html 打开）就没必要摆一个评论区
        if (!term) {
            var sec = host.closest ? host.closest('section') : null;
            if (sec) sec.hidden = true;
            return;
        }

        // 还没配好：给一句人话，别留一个空白框
        if (!cfg.repoId || !cfg.categoryId) {
            host.innerHTML =
                '<div class="comments-setup">' +
                '<b>评论还没接上</b>' +
                '<p>评论是存在 GitHub 仓库的 Discussions 里的，需要在仓库里做三步：' +
                '打开 Discussions → 装上 giscus App → 把 giscus.app 生成的 ' +
                '<code>data-category-id</code> 填进 <code>js/blog.js</code>。</p>' +
                '<p class="dim">详细步骤写在 README 的「文章评论」一节。配好之后这里就是评论区，不用再改代码。</p>' +
                '</div>';
            return;
        }

        var s = document.createElement('script');
        s.src = 'https://giscus.app/client.js';
        s.async = true;
        s.crossOrigin = 'anonymous';
        var attrs = {
            'data-repo': cfg.repo,
            'data-repo-id': cfg.repoId,
            'data-category': cfg.category,
            'data-category-id': cfg.categoryId,
            'data-mapping': 'specific',
            'data-term': term,
            'data-strict': '0',
            'data-reactions-enabled': '1',
            'data-emit-metadata': '0',
            'data-input-position': 'top',   // 输入框放上面，长评论区里不用先滚到底
            'data-theme': giscusTheme(),
            'data-lang': 'zh-CN',
            'data-loading': 'lazy',
        };
        Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
        host.appendChild(s);
    }

    /** 彩蛋：在页面上敲 rain 开启加强版终端雨，再敲一次关掉 */
    function initEasterEgg() {
        var buf = '';
        document.addEventListener('keydown', function (e) {
            var tag = (e.target && e.target.tagName) || '';
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
            if (!/^[a-z]$/.test(e.key)) { buf = ''; return; }

            buf = (buf + e.key.toLowerCase()).slice(-10);
            if (buf.slice(-4) !== 'rain' || !window.sfmbToggleRain) return;

            var now = window.sfmbToggleRain();
            var label = now === 'high' ? '终端雨 · 加强'
                : now === 'low' ? '终端雨 · 开启'
                    : '终端雨 · 关闭';
            toastMsg(label, now === 'off' ? '' : 'ok');
            buf = '';
        });
    }

    function boot() {
        initTheme();
        initNav();
        initToTop();
        initGlassFilter();
        initReveal();
        initRain();
        initAmbientPointer();
        initTypewriter();
        initEasterEgg();
        initLive2D();
        initComments();
        initCounter();
        initDebugPanel();

        var afterRender = function () {
            if (window.sfmbObserveReveal) window.sfmbObserveReveal();
        };
        renderIndex().then(afterRender);
        renderArchive().then(afterRender);
        renderPost().then(afterRender);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
