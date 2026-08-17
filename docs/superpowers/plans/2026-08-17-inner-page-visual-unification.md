# 内页视觉统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为分类、标签、归档、关于和文章页增加与首页协调但更适合阅读的独立场景背景。

**Architecture:** 新增一个无 DOM 依赖的 UMD 场景映射模块，负责把 URL 与文章 Open Graph 图片转换成稳定的页面类型和背景参数；现有 `anime-theme.js` 只负责把结果应用到根元素。CSS 根据根元素数据属性绘制背景、遮罩与阅读层，主题模板和 `node_modules` 保持不变。

**Tech Stack:** Hexo 7.3、Redefine 2.9.0、原生 JavaScript、CSS、Node.js 内置测试运行器、Playwright CLI

---

## 文件结构

- 新建 `source/js/anime-page-scenes.js`：页面路径、图片与裁切位置的纯数据映射，可同时在浏览器和 Node.js 中使用。
- 新建 `test/anime-page-scenes.test.cjs`：覆盖页面识别、文章封面校验和降级行为。
- 修改 `source/js/anime-theme.js`：清理旧页面状态并把场景映射应用到 DOM，不承担映射规则。
- 修改 `source/css/anime-theme.css`：实现内页背景、遮罩、阅读层、暗色和移动端样式。
- 修改 `_config.redefine.yml`：按依赖顺序加载场景模块和现有主题脚本。
- 修改 `test/verify-site.mjs`：验证构建产物中的脚本加载、内页路由与样式契约。
- 修改 `package.json`：把 Node.js 单元测试加入现有 `npm test`。

### Task 1: 建立可测试的页面场景映射

**Files:**
- Create: `test/anime-page-scenes.test.cjs`
- Create: `source/js/anime-page-scenes.js`
- Modify: `package.json:5-10`

- [ ] **Step 1: 写入失败的场景映射测试**

新建 `test/anime-page-scenes.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePageScene } = require('../source/js/anime-page-scenes.js');

const origin = 'https://einstein-newton-666.github.io';

test('为索引型内页分配互不相同的固定场景', () => {
  const cases = [
    ['/categories/', 'categories', '/images/brand/book-spring.webp'],
    ['/categories/笔记/', 'categories', '/images/brand/book-spring.webp'],
    ['/tags/', 'tags', '/images/brand/morning-mountains.webp'],
    ['/tags/Hexo/', 'tags', '/images/brand/morning-mountains.webp'],
    ['/archives/', 'archives', '/images/brand/river-sunrise.webp'],
    ['/about/', 'about', '/images/brand/tech-lab.webp'],
  ];

  const scenes = cases.map(([pathname, type, image]) => {
    const scene = resolvePageScene(pathname, '', origin);
    assert.equal(scene.type, type);
    assert.equal(scene.image, image);
    return scene.image;
  });

  assert.equal(new Set(scenes.slice(0, 1).concat(scenes.slice(2))).size, 4);
});

test('文章页优先使用同源 Open Graph 图片', () => {
  const scene = resolvePageScene(
    '/2026/08/15/welcome/',
    `${origin}/images/brand/firefly-side.webp`,
    origin,
  );

  assert.equal(scene.type, 'post');
  assert.equal(scene.image, '/images/brand/firefly-side.webp');
});

test('文章页拒绝跨域图片并使用本地备用图', () => {
  const scene = resolvePageScene(
    '/2026/08/15/welcome/',
    'https://example.com/external.webp',
    origin,
  );

  assert.equal(scene.image, '/images/brand/firefly-side.webp');
});

test('首页和未知页面不启用内页场景', () => {
  assert.equal(resolvePageScene('/', '', origin), null);
  assert.equal(resolvePageScene('/atom.xml', '', origin), null);
  assert.equal(resolvePageScene('/unknown/', '', origin), null);
});
```

在 `package.json` 中先增加测试命令：

```json
"test:unit": "node --test test/*.test.cjs",
"test": "npm run test:unit && npm run build && node test/verify-site.mjs"
```

- [ ] **Step 2: 运行测试并确认因模块缺失而失败**

Run: `npm run test:unit`

Expected: FAIL，错误包含 `Cannot find module '../source/js/anime-page-scenes.js'`。

- [ ] **Step 3: 实现最小场景映射模块**

新建 `source/js/anime-page-scenes.js`，使用 UMD 包装同时暴露 `module.exports` 与 `window.AnimePageScenes`：

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimePageScenes = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const fixedScenes = [
    { pattern: /^\/categories(?:\/|$)/, type: 'categories', image: '/images/brand/book-spring.webp', desktopPosition: '50% center', mobilePosition: '68% center' },
    { pattern: /^\/tags(?:\/|$)/, type: 'tags', image: '/images/brand/morning-mountains.webp', desktopPosition: '50% center', mobilePosition: '58% center' },
    { pattern: /^\/archives(?:\/|$)/, type: 'archives', image: '/images/brand/river-sunrise.webp', desktopPosition: '50% center', mobilePosition: '82% center' },
    { pattern: /^\/about(?:\/|$)/, type: 'about', image: '/images/brand/tech-lab.webp', desktopPosition: '50% center', mobilePosition: '72% center' },
  ];

  function localImagePath(value, origin) {
    if (!value) return null;
    try {
      const url = new URL(value, origin);
      return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
      return null;
    }
  }

  function resolvePageScene(pathname, openGraphImage, origin) {
    const path = `/${String(pathname || '').replace(/^\/+|\/+$/g, '')}`;
    const fixed = fixedScenes.find((scene) => scene.pattern.test(path));
    if (fixed) return { ...fixed, pattern: undefined };

    if (/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/.test(path)) {
      return {
        type: 'post',
        image: localImagePath(openGraphImage, origin) || '/images/brand/firefly-side.webp',
        desktopPosition: '50% center',
        mobilePosition: '50% center',
      };
    }

    return null;
  }

  return { resolvePageScene };
}));
```

- [ ] **Step 4: 运行单元测试并确认通过**

Run: `npm run test:unit`

Expected: PASS，4 个测试全部通过。

- [ ] **Step 5: 提交场景映射模块**

```bash
git add package.json test/anime-page-scenes.test.cjs source/js/anime-page-scenes.js
git commit -m "功能：添加内页场景映射模块"
```

### Task 2: 将场景状态接入生成页面

**Files:**
- Modify: `test/verify-site.mjs:50-74`
- Modify: `_config.redefine.yml:111-118`
- Modify: `source/js/anime-theme.js:32-105`

- [ ] **Step 1: 写入失败的构建契约测试**

在 `test/verify-site.mjs` 中读取分类、标签和归档页：

```js
const categories = await read('public/categories/index.html');
const tags = await read('public/tags/index.html');
const archives = await read('public/archives/index.html');
```

增加统一脚本加载检查：

```js
for (const [name, content] of [
  ['首页', home],
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['文章页', post],
]) {
  expect(content, /src="\/js\/anime-page-scenes\.js"/, `${name}未加载页面场景映射脚本`);
  expect(content, /src="\/js\/anime-theme\.js"/, `${name}未加载 anime-theme.js`);
}
```

- [ ] **Step 2: 构建并确认新契约测试失败**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，至少报告“首页未加载页面场景映射脚本”。

- [ ] **Step 3: 按依赖顺序注入场景脚本**

将 `_config.redefine.yml` 的 footer 注入改为：

```yaml
footer:
  - '<script src="/js/anime-page-scenes.js"></script>'
  - '<script src="/js/anime-theme.js"></script>'
```

- [ ] **Step 4: 在主题脚本中应用并清理页面状态**

在 `source/js/anime-theme.js` 中增加：

```js
function applyInnerPageScene() {
  const root = document.documentElement;
  delete root.dataset.animePage;
  root.style.removeProperty('--anime-page-image');
  root.style.removeProperty('--anime-page-position-desktop');
  root.style.removeProperty('--anime-page-position-mobile');

  const resolver = globalThis.AnimePageScenes?.resolvePageScene;
  if (!resolver) return;

  const openGraphImage = document.querySelector('meta[property="og:image"]')?.content || '';
  const scene = resolver(location.pathname, openGraphImage, location.origin);
  if (!scene) return;

  root.dataset.animePage = scene.type;
  root.style.setProperty('--anime-page-image', `url("${scene.image}")`);
  root.style.setProperty('--anime-page-position-desktop', scene.desktopPosition);
  root.style.setProperty('--anime-page-position-mobile', scene.mobilePosition);
}
```

在 `initialiseAnimeTheme()` 的第一行调用 `applyInnerPageScene()`，确保首页没有 hero 时仍会清理旧状态。保留现有 `data-swup-reload-script` 行为，不新增路由库或重复事件监听器。

- [ ] **Step 5: 运行单元测试与构建契约测试**

Run: `npm test`

Expected: PASS，单元测试、Hexo 构建与站点验证全部通过。

- [ ] **Step 6: 提交页面状态接入**

```bash
git add _config.redefine.yml source/js/anime-theme.js test/verify-site.mjs
git commit -m "功能：为内页接入独立场景状态"
```

### Task 3: 实现统一背景与阅读层

**Files:**
- Modify: `test/verify-site.mjs:55-80`
- Modify: `source/css/anime-theme.css:1-376`

- [ ] **Step 1: 写入失败的样式契约测试**

在 `test/verify-site.mjs` 中读取生成后的自定义样式并增加断言：

```js
const animeCss = await read('public/css/anime-theme.css');

expect(animeCss, /html\[data-anime-page\]/, '自定义样式缺少内页场景选择器');
expect(animeCss, /--anime-page-image/, '自定义样式未使用内页背景变量');
expect(animeCss, /html\.dark\[data-anime-page\]/, '内页场景缺少暗色模式');
expect(animeCss, /--anime-page-position-mobile/, '内页场景缺少移动端裁切变量');
```

- [ ] **Step 2: 构建并确认样式契约测试失败**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，报告“自定义样式缺少内页场景选择器”。

- [ ] **Step 3: 添加内页背景和可读性样式**

在 `source/css/anime-theme.css` 的根变量后加入以下样式，并根据实际页面截图微调透明度而不改变结构：

```css
html[data-anime-page] body {
  background: var(--anime-paper);
}

html[data-anime-page] .page-container {
  position: relative;
  z-index: 0;
  min-height: 100dvh;
  isolation: isolate;
}

html[data-anime-page] .page-container::before,
html[data-anime-page] .page-container::after {
  position: fixed;
  inset: 0;
  z-index: -2;
  content: '';
  pointer-events: none;
}

html[data-anime-page] .page-container::before {
  background-image: var(--anime-page-image);
  background-position: var(--anime-page-position-desktop, 50% center);
  background-size: cover;
  filter: saturate(.82) brightness(1.04);
}

html[data-anime-page] .page-container::after {
  z-index: -1;
  background: linear-gradient(180deg, rgba(247, 250, 249, .72), rgba(247, 250, 249, .9) 72%);
}

html[data-anime-page] .main-content-container {
  background: transparent;
}

html[data-anime-page] .navbar-container {
  border-bottom: 1px solid rgba(255, 255, 255, .58);
  background: rgba(247, 250, 249, .82);
  box-shadow: 0 8px 24px rgba(22, 43, 51, .08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

html[data-anime-page] .navbar-container .navbar-item a.active {
  color: var(--anime-teal);
}

html[data-anime-page] :is(.page-template-container, .archive-container, .article-content-container, .toc-content-container) {
  border: 1px solid rgba(255, 255, 255, .72);
  border-radius: 8px;
  background: rgba(250, 252, 251, .9);
  box-shadow: 0 14px 36px rgba(22, 43, 51, .12);
  backdrop-filter: blur(14px);
}

html[data-anime-page] :is(.page-template-container, .archive-container) h1,
html[data-anime-page] .article-title {
  font-family: STSong, 'Songti SC', SimSun, serif;
  letter-spacing: 0;
}

html.dark[data-anime-page] body {
  background: #111a21;
}

html.dark[data-anime-page] .page-container::before {
  filter: saturate(.72) brightness(.55);
}

html.dark[data-anime-page] .page-container::after {
  background: linear-gradient(180deg, rgba(13, 22, 28, .7), rgba(13, 22, 28, .9) 72%);
}

html.dark[data-anime-page] .navbar-container {
  border-bottom-color: rgba(255, 255, 255, .08);
  background: rgba(17, 26, 33, .84);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .2);
}

html.dark[data-anime-page] :is(.page-template-container, .archive-container, .article-content-container, .toc-content-container) {
  border-color: rgba(255, 255, 255, .1);
  background: rgba(21, 31, 39, .9);
  box-shadow: 0 16px 40px rgba(0, 0, 0, .24);
}
```

在现有移动端媒体查询中加入：

```css
html[data-anime-page] .page-container::before {
  background-position: var(--anime-page-position-mobile, 50% center);
}

html[data-anime-page] :is(.page-template-container, .archive-container, .article-content-container) {
  border-right: 0;
  border-left: 0;
  border-radius: 0;
  backdrop-filter: blur(10px);
}
```

- [ ] **Step 4: 运行完整自动化测试**

Run: `npm test`

Expected: PASS，所有场景映射和构建契约检查通过。

- [ ] **Step 5: 提交内页视觉样式**

```bash
git add source/css/anime-theme.css test/verify-site.mjs
git commit -m "样式：统一内页背景与阅读层"
```

### Task 4: 浏览器验收与最终验证

**Files:**
- Verify: `source/css/anime-theme.css`
- Verify: `source/js/anime-theme.js`
- Modify after reproducing an acceptance failure: `source/css/anime-theme.css`
- Modify after reproducing a stale-page-state failure: `source/js/anime-theme.js`

- [ ] **Step 1: 从干净依赖环境验证构建**

Run: `npm ci && npm run clean && npm test`

Expected: PASS；Hexo 生成完成，资源、路由、RSS、字数统计和 MathJax 检查通过。

- [ ] **Step 2: 启动独立预览服务**

Run: `npm run server -- --ip 0.0.0.0 --port 4001`

Expected: 输出 `Hexo is running at http://localhost:4001/`，且 `curl -I http://127.0.0.1:4001/` 返回 `200`。

- [ ] **Step 3: 使用 Playwright 检查桌面端与移动端**

若本机尚无 Chromium，先运行：

```bash
npx playwright install chromium
```

使用独立会话打开以下路径，并分别调整到 `1440x1000` 与 `390x844`：

```text
http://127.0.0.1:4001/categories/
http://127.0.0.1:4001/tags/
http://127.0.0.1:4001/archives/
http://127.0.0.1:4001/about/
http://127.0.0.1:4001/2026/08/15/welcome/
```

每个页面检查：背景图成功加载、正文不透明度足以阅读、导航和标题不重叠、移动端裁切合理、键盘焦点可见。切换暗色模式后重复检查；设置 `prefers-reduced-motion: reduce` 时不出现新增持续动画。

- [ ] **Step 4: 验证单页导航不会遗留旧场景**

在同一浏览器会话中依次从分类进入标签、归档、关于和首页。每次导航后读取 `document.documentElement.dataset.animePage`，预期依次为 `categories`、`tags`、`archives`、`about`、`undefined`；背景图片必须随之变化。

- [ ] **Step 5: 检查静态资源响应与工作区**

Run:

```bash
for asset in \
  /js/anime-page-scenes.js \
  /js/anime-theme.js \
  /css/anime-theme.css \
  /images/brand/book-spring.webp \
  /images/brand/morning-mountains.webp \
  /images/brand/river-sunrise.webp \
  /images/brand/tech-lab.webp \
  /images/brand/firefly-side.webp; do
  curl --fail --silent --output /dev/null "http://127.0.0.1:4001${asset}"
done
git diff --check
git status --short
```

Expected: 所有请求成功，`git diff --check` 无输出，只显示本任务预期修改。

- [ ] **Step 6: 提交视觉验收阶段的必要微调**

仅当截图检查产生必要修改时执行：

```bash
git add source/css/anime-theme.css source/js/anime-theme.js
git commit -m "修复：调整内页背景的响应式显示"
```

- [ ] **Step 7: 最终复验**

Run: `npm run clean && npm test && git status --short --branch`

Expected: 测试全部通过，工作区干净，本地分支仅领先远程预期提交。
