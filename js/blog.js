/* ============================================================================
   梦归の小站 · 前端逻辑
   单文件 Markdown 数据库 (blogs/default.md) 的读取、渲染与交互。
   文章块以 `---POST---` 分隔；块的序号（跳过空块后）即为文章 id，
   与 api.php 中的编辑 / 删除索引保持一致。
============================================================================ */
(function () {
    'use strict';

    var MD_URL = './blogs/default.md';
    var SEPARATOR = '---POST---';
    var API = './api.php';
    var DELETED_RE = /<!--\s*DELETED:\s*(.*?)\s*-->/;

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    /* ------------------------------------------------------------------ utils */
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function readMinutes(text) {
        var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        var words = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
        return Math.max(1, Math.round(cjk / 400 + words / 200));
    }

    /* 把 Markdown 压成一行纯文本，用于摘要 */
    function plainText(md) {
        return md
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/~~~[\s\S]*?~~~/g, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
            .replace(/^\s{0,3}=+\s*$/gm, ' ')
            .replace(/^\s{0,3}>+\s?/gm, ' ')
            .replace(/^\s*([-*+]|\d+\.)\s+/gm, ' ')
            .replace(/^\s*\|.*\|\s*$/gm, ' ')
            .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
            .replace(/`([^`]*)`/g, '$1')
            .replace(/[*_~]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tagList(raw) {
        if (!raw) return [];
        return String(raw)
            .split(/[,，;；]/)
            .map(function (t) { return t.trim(); })
            .filter(Boolean);
    }

    /* ----------------------------------------------------------------- parser */
    var _all = null;        // 全部文章，含被标记删除的
    var _visible = null;    // 前台可见的文章

    function parsePosts(fullText) {
        var blocks = fullText.split(SEPARATOR);
        var posts = [];

        blocks.forEach(function (block, index) {
            // 与 api.php 完全一致：空块不产生文章
            if (block.trim() === '') return;

            var del = block.match(DELETED_RE);
            var titleMatch = block.match(/^#\s+(.+)$/m);
            var metaMatch = block.match(/<!--\s*DATE:\s*(.*?)\s*\|\s*TAG:\s*(.*?)\s*-->/);

            var title = titleMatch ? titleMatch[1].trim() : '无标题文章';
            var date = metaMatch ? metaMatch[1].trim() : '';
            var tags = tagList(metaMatch ? metaMatch[2] : '');

            var body = block
                .replace(/^#\s+(.+)$/m, '')
                .replace(/<!--[\s\S]*?-->/g, '')
                .trim();

            var text = plainText(body);

            posts.push({
                // id 用的是「原始块下标」，不是"第几篇可见文章"。
                // 删除是原地打 <!-- DELETED --> 标记，块仍然留在原位置，
                // 所以删掉一篇不会让后面所有文章改号，旧链接不会失效。
                id: index,
                deleted: !!del,
                deletedAt: del ? del[1].trim() : '',
                title: title,
                date: date,
                dateISO: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
                tag: tags[0] || 'Blog',
                tags: tags.length ? tags : ['Blog'],
                body: body,
                rawContent: block.trim(),
                summary: text.length > 110 ? text.slice(0, 110) + '…' : text,
                minutes: readMinutes(body)
            });
        });

        return posts;
    }

    async function loadPosts(force) {
        if (_all && !force) return;
        try {
            var res = await fetch(MD_URL, { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var text = await res.text();
            var posts = parsePosts(text);
            posts.sort(function (a, b) {
                return (b.dateISO || b.date).localeCompare(a.dateISO || a.date) || (b.id - a.id);
            });
            _all = posts;
            _visible = posts.filter(function (p) { return !p.deleted; });
        } catch (err) {
            console.error('[SFMblog] 读取 default.md 失败：', err);
            _all = _all || [];
            _visible = _visible || [];
        }
    }

    async function getAllPosts(force) {
        await loadPosts(force);
        return _visible;
    }

    async function getAllPostsIncludingDeleted(force) {
        await loadPosts(force);
        return _all;
    }

    window.getAllPosts = getAllPosts;
    window.getAllPostsIncludingDeleted = getAllPostsIncludingDeleted;

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
        btn.addEventListener('click', function () {
            applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
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
    function postCard(post) {
        var tags = post.tags.map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
        }).join('');

        var summary = post.summary
            ? '<p class="post-card-summary">' + esc(post.summary) + '</p>'
            : '';

        return '<article class="post-card glass sheen">' +
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

        box.innerHTML = posts.slice(0, 6).map(postCard).join('');

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
                '<div class="stat-card glass sheen"><strong>' + posts.length + '</strong><span>篇文章</span></div>' +
                '<div class="stat-card glass sheen"><strong>' + yearCount + '</strong><span>个年份</span></div>' +
                '<div class="stat-card glass sheen"><strong>' + Object.keys(tagSet).length + '</strong><span>个标签</span></div>' +
                '<div class="stat-card glass sheen"><strong class="stat-word">' + esc(topTag) + '</strong><span>最常出现的标签</span></div>';
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
            var items = g.items.map(function (p) {
                var tags = p.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
                var short = (p.dateISO || p.date).slice(5) || '--';
                return '<a class="timeline-item" href="post.html?id=' + p.id + '">' +
                    '<span class="timeline-date">' + esc(short || '--') + '</span>' +
                    '<span class="timeline-title">' + esc(p.title) + '</span>' +
                    '<span class="tag-row">' + tags + '</span>' +
                    '</a>';
            }).join('');

            return '<section class="year-group">' +
                '<h2 class="year-label">' + esc(g.year) + '<em>' + g.items.length + ' 篇</em></h2>' +
                items + '</section>';
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

        var posts = await getAllPosts();
        var post = posts.find(function (p) { return String(p.id) === String(id); });

        if (!post) {
            var gone = (await getAllPostsIncludingDeleted()).find(function (p) {
                return String(p.id) === String(id) && p.deleted;
            });

            if (gone) {
                titleEl.textContent = '这篇文章已被删除';
                var admin = false;
                try { admin = !!sessionStorage.getItem('admin_token'); } catch (e) { }
                content.innerHTML = '<p>「' + esc(gone.title) + '」已经被放进回收站，暂时不对外显示。</p>' +
                    (admin
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
        try {
            if (sessionStorage.getItem('admin_token')) {
                var chip = document.createElement('a');
                chip.className = 'edit-chip';
                chip.href = 'console.html?edit_id=' + post.id;
                chip.textContent = '✏️ 编辑此文';
                meta.appendChild(chip);
            }
        } catch (e) { }

        content.innerHTML = window.marked
            ? marked.parse(post.body, { gfm: true, breaks: true })
            : '<pre>' + esc(post.body) + '</pre>';

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
    function boot() {
        initTheme();
        initNav();
        initToTop();
        initCounter();
        renderIndex();
        renderArchive();
        renderPost();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
