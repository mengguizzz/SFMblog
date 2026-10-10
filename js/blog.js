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
            m.setAttribute('content', theme === 'dark' ? '#070810' : '#fbf7fc');
        });
        if (persist) { try { localStorage.setItem('theme', theme); } catch (e) { } }
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
        initCounter();

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
