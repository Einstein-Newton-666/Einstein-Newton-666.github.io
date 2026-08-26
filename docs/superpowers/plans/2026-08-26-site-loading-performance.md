# 网站加载性能优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 Redefine 官方 CDN 和轻量展示资源降低首次访问开销，同时保留现有正式背景图、4K 档位和站内交互。

**Architecture:** 主题自带资源通过 `_config.redefine.yml` 切换到版本固定的 `npmmirror` 地址，自定义资源继续由 GitHub Pages 提供。首页场景对象同时保存正式图、4K 图和缩略图，按钮只下载缩略图，正式图仍由现有 `setSlide` 流程在当前场景需要时加载。

**Tech Stack:** Hexo 7.3、Redefine 2.9、Node.js 内置测试、FFmpeg/libwebp、Playwright CLI、GitHub Pages

---

## 文件结构

- 修改 `_config.redefine.yml`：CDN、搜索预加载、展示头像和首页初始背景配置。
- 修改 `source/js/anime-theme.js`：声明缩略图并让场景按钮使用轻量资源。
- 新增 `source/images/brand/*-thumb.webp`：三个首页场景缩略图。
- 新增 `source/images/brand/castorice-avatar-display.webp`：头像展示版。
- 修改 `test/anime-theme.test.cjs`：场景缩略图与按需正式图的源代码契约。
- 修改 `test/verify-site.mjs`：构建产物、CDN、搜索、图片引用与体积上限检查。

### Task 1: Redefine 官方 CDN 与按需搜索

**Files:**
- Modify: `test/verify-site.mjs`
- Modify: `_config.redefine.yml`

- [ ] **Step 1: 写入失败的构建契约测试**

在读取 `public/index.html` 后增加：

```js
expect(
  home,
  /https:\/\/registry\.npmmirror\.com\/hexo-theme-redefine\/2\.9\.0\/files\/source\/fontawesome\/fontawesome\.min\.css/,
  '主题静态资源未使用 Redefine 官方 npmmirror CDN',
);
expect(home, /"search":\{"enable":true,"preload":false\}/, '搜索索引仍在首屏预加载');
if (/href="\/fontawesome\/fontawesome\.min\.css"/.test(home)) {
  failures.push('首页仍从 GitHub Pages 加载主题 Font Awesome');
}
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，包含“主题静态资源未使用 Redefine 官方 npmmirror CDN”和“搜索索引仍在首屏预加载”。

- [ ] **Step 3: 写入最小配置**

在 `_config.redefine.yml` 中修改搜索并增加 CDN：

```yaml
navbar:
  search:
    enable: true
    preload: false

cdn:
  enable: true
  provider: npmmirror
```

- [ ] **Step 4: 运行构建契约测试**

Run: `npm run clean && npm run build && node test/verify-site.mjs`

Expected: PASS；生成 HTML 包含 `registry.npmmirror.com` 预连接和主题资源地址，自定义 `/css/anime-theme.css` 仍为本站路径。

- [ ] **Step 5: 提交配置优化**

```bash
git add _config.redefine.yml test/verify-site.mjs
git commit -m "性能：启用主题 CDN 与按需搜索"
```

### Task 2: 首页场景轻量缩略图

**Files:**
- Modify: `test/anime-theme.test.cjs`
- Modify: `test/verify-site.mjs`
- Modify: `source/js/anime-theme.js`
- Create: `source/images/brand/miku-field-thumb.webp`
- Create: `source/images/brand/morning-mountains-thumb.webp`
- Create: `source/images/brand/river-sunrise-thumb.webp`
- Modify: `_config.redefine.yml`

- [ ] **Step 1: 写入失败的场景行为测试**

在 `test/anime-theme.test.cjs` 增加：

```js
test('场景按钮使用轻量缩略图而不是正式背景', () => {
  for (const basename of ['miku-field', 'morning-mountains', 'river-sunrise']) {
    assert.match(
      script,
      new RegExp(`thumb: '/images/brand/${basename}-thumb\\.webp'`),
    );
  }
  assert.match(script, /<img src="\$\{slide\.thumb\}" alt="" loading="lazy" decoding="async">/);
  assert.doesNotMatch(script, /<img src="\$\{slide\.src\}" alt="">/);
});
```

在 `test/verify-site.mjs` 的 `expectedImages` 加入三个缩略图，并读取文件大小，要求每张不超过 `30 * 1024` bytes。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm run test:unit && npm run build && node test/verify-site.mjs`

Expected: FAIL，原因是场景尚无 `thumb` 字段且三张缩略图不存在。

- [ ] **Step 3: 生成三张确定性 WebP 缩略图**

```bash
ffmpeg -y -i source/images/brand/miku-field.webp -vf "scale=320:-2:flags=lanczos" -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/miku-field-thumb.webp
ffmpeg -y -i source/images/brand/morning-mountains.webp -vf "scale=320:-2:flags=lanczos" -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/morning-mountains-thumb.webp
ffmpeg -y -i source/images/brand/river-sunrise.webp -vf "scale=320:-2:flags=lanczos" -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/river-sunrise-thumb.webp
```

这些是原图的确定性缩放压缩，不进行生成式改绘，不改变人物、构图、色彩或内容。

- [ ] **Step 4: 让按钮引用缩略图**

为每个 `slides` 条目增加对应 `thumb`，并将按钮模板改为：

```js
switcher.innerHTML = slides.map((slide, index) => `
  <button type="button" title="场景 ${index + 1}：${slide.scene}" aria-label="查看场景 ${index + 1}" aria-pressed="${index === 0}">
    <img src="${slide.thumb}" alt="" loading="lazy" decoding="async">
  </button>`).join('');
```

将 `home_banner.image.dark` 与 `light` 都设为 `/images/brand/miku-field.webp`，避免主题模板在脚本初始化前抢先下载第三场景。正式暗色显示仍由当前场景脚本控制。

- [ ] **Step 5: 运行单元与构建测试**

Run: `npm run test:unit && npm run clean && npm run build && node test/verify-site.mjs`

Expected: PASS；三张缩略图存在且各自小于 30 KB，所有正式与 4K 图片仍存在。

- [ ] **Step 6: 提交场景资源优化**

```bash
git add _config.redefine.yml source/js/anime-theme.js source/images/brand/*-thumb.webp test/anime-theme.test.cjs test/verify-site.mjs
git commit -m "性能：首页场景改用轻量缩略图"
```

### Task 3: 头像展示版

**Files:**
- Modify: `test/verify-site.mjs`
- Modify: `_config.redefine.yml`
- Create: `source/images/brand/castorice-avatar-display.webp`

- [ ] **Step 1: 写入失败的头像资源测试**

将 `castorice-avatar-display.webp` 加入 `expectedImages`，增加 50 KB 体积上限，并把首页头像断言改为：

```js
expect(home, /\/images\/brand\/castorice-avatar-display\.webp/, '首页未使用轻量头像展示版');
if (/\/images\/brand\/castorice-avatar\.webp/.test(home)) {
  failures.push('首页仍引用 900x900 原头像');
}
```

- [ ] **Step 2: 运行构建检查并确认按预期失败**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，原因是展示头像不存在且生成 HTML 仍引用原头像。

- [ ] **Step 3: 生成头像展示版并更新配置**

```bash
ffmpeg -y -i source/images/brand/castorice-avatar.webp -vf "scale=320:320:flags=lanczos" -frames:v 1 -c:v libwebp -preset picture -quality 78 source/images/brand/castorice-avatar-display.webp
```

```yaml
defaults:
  avatar: /images/brand/castorice-avatar-display.webp
```

- [ ] **Step 4: 运行完整测试**

Run: `npm run clean && npm test`

Expected: 所有 Node 测试、Hexo 构建和站点契约检查通过。

- [ ] **Step 5: 提交头像优化**

```bash
git add _config.redefine.yml source/images/brand/castorice-avatar-display.webp test/verify-site.mjs
git commit -m "性能：使用轻量头像展示资源"
```

### Task 4: 浏览器性能与视觉回归

**Files:**
- Verify only; no production file changes expected

- [ ] **Step 1: 启动本地站点**

Run: `npm run server`

Expected: Hexo 在可用本地端口提供 `public/`。

- [ ] **Step 2: 检查桌面与移动布局**

使用 Playwright CLI 分别以 `1440x1000`、`390x844` 打开首页、分类页和文章页，执行快照、截图和控制台检查。

Expected: 图片均加载成功，无文本重叠、水平溢出或控制台错误；明暗模式、导航与移动抽屉正常。

- [ ] **Step 3: 检查首页请求行为**

读取 `performance.getEntriesByType('resource')`：

- 首屏存在 `miku-field.webp` 和三张 `*-thumb.webp`。
- 首屏不存在 `morning-mountains.webp`、`river-sunrise.webp`、900x900 原头像和 `search.xml`。
- 点击第二、第三场景按钮后，相应正式背景能够加载并显示。

- [ ] **Step 4: 检查 CDN 回退边界**

确认生成 HTML 中只有 Redefine 主题自带的 CSS、JS、字体使用 `registry.npmmirror.com`；`anime-theme.css`、`anime-theme.js` 和 `images/brand/` 仍为本站资源。

- [ ] **Step 5: 运行最终验证**

Run: `npm ci && npm run clean && npm test && git diff --check && git status --short --branch`

Expected: 依赖安装成功、全部测试通过、无空白错误、仅保留本计划产生的提交。

### Task 5: 推送与线上确认

**Files:**
- No file changes expected

- [ ] **Step 1: 推送 `main`**

Run: `git push Einstein-Newton-666.github.io main`

Expected: 远程 `main` 更新到本地 HEAD。

- [ ] **Step 2: 确认 GitHub Actions**

通过 GitHub Actions API 等待对应 HEAD 的 `Deploy Hexo site to GitHub Pages` 完成。

Expected: `status=completed` 且 `conclusion=success`。

- [ ] **Step 3: 确认线上资源**

对线上首页执行冷浏览器检查，确认 CDN URL、轻量头像、缩略图和按需搜索均已部署；记录优化后的请求数、传输量和 DOMContentLoaded 作为前后对比。
