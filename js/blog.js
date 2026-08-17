// ====== 全新逻辑：单文件切割模式 ======
async function getAllPosts() {
    try {
        const response = await fetch('./blogs/default.md');
        if (!response.ok) throw new Error('找不到 default.md');
        
        const fullText = await response.text();
        
        const rawPosts = fullText.split('---POST---');
        let posts = [];

        rawPosts.forEach((text, index) => {
            if (!text.trim()) return;

            const titleMatch = text.match(/^#\s+(.+)/m);
            const title = titleMatch ? titleMatch[1] : '无标题文章';

            const metaMatch = text.match(/<!--\s*DATE:\s*(.*?)\s*\|\s*TAG:\s*(.*?)\s*-->/);
            const date = metaMatch ? metaMatch[1] : '1970-01-01';
            const tag = metaMatch ? metaMatch[2] : 'Blog';

            const textWithoutMeta = text.replace(/^#\s+(.+)/m, '').replace(/<!--.*?-->/s, '').trim();
            const summaryMatch = textWithoutMeta.match(/^(.+)/m);
            let summary = summaryMatch ? summaryMatch[1].trim() : '';
            if (summary.length > 90) summary = summary.substring(0, 90) + '...';

            posts.push({
                id: index.toString(), 
                title: title, 
                date: date, 
                tag: tag, 
                summary: summary, 
                rawContent: text 
            });
        });
        
        posts.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        return posts;

    } catch (e) {
        console.error("加载 default.md 失败：", e);
        return [];
    }
}

// 2. 渲染首页和归档页
document.addEventListener('DOMContentLoaded', async () => {
    const posts = await getAllPosts();
    const latestContainer = document.getElementById('latest-posts-container');
    if (latestContainer) {
        latestContainer.innerHTML = ''; 
        const latestPosts = posts.slice(0, 4); 
        
        latestPosts.forEach(post => {
            const html = `
                <article class="post-card liquid-glass">
                    <a href="post.html?id=${post.id}" class="post-title">${post.title}</a>
                    <div class="post-meta">DATE: ${post.date} | TAG: ${post.tag}</div>
                    <p class="post-summary">${post.summary}</p>
                    <a href="post.html?id=${post.id}" class="read-more">阅读全文 →</a>
                </article>
            `;
            latestContainer.innerHTML += html;
        });
    }

    // === 渲染归档页时间轴 ===
    const archiveContainer = document.getElementById('archive-list-container');
    if (archiveContainer) {
        archiveContainer.innerHTML = ''; 
        let currentYear = '';

        posts.forEach(post => {
            const postYear = post.date.split('-')[0];
            const postDate = post.date.substring(5); 

            if (postYear !== currentYear) {
                currentYear = postYear;
                archiveContainer.innerHTML += `
                    <div class="timeline-year-group" id="year-${currentYear}">
                        <h3 class="archive-year">${currentYear}</h3>
                    </div>
                `;
            }

            const yearGroup = document.getElementById(`year-${currentYear}`);
            const itemHtml = `
                <div class="timeline-item liquid-glass">
                    <div class="timeline-dot"></div>
                    <div class="timeline-date">${postDate}</div>
                    <div class="timeline-content">
                        <!-- 同样改成 ?id=xxx -->
                        <a href="post.html?id=${post.id}" class="timeline-title">${post.title}</a>
                        <span class="tag">${post.tag}</span>
                    </div>
                </div>
            `;
            yearGroup.innerHTML += itemHtml;
        });
    }
});

// ====== 黑夜/白天模式切换逻辑 (保持原有不变) ======
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-mode');
        toggleBtn.innerText = '☀️';
    }

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.body.classList.toggle('dark-mode');
        if (document.body.classList.contains('dark-mode')) {
            toggleBtn.innerText = '☀️';
            localStorage.setItem('theme', 'dark');
        } else {
            toggleBtn.innerText = '🌙';
            localStorage.setItem('theme', 'light');
        }
    });
});