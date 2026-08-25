# 分类页背景替换实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分类页背景替换为选定的暖金色图书馆少女插画，并保持其他页面、暗色模式和移动端行为不变。

**Architecture:** 继续使用 `resolvePageScene()` 为分类路径返回独立场景，只替换该场景的本地图片与裁切参数。原图在接入前由 FFmpeg 缩放并转换为 WebP，来源通过结构化 JSON 保存，现有构建验证负责检查文件存在且不与其他品牌图重复。

**Tech Stack:** Hexo 7.3、Redefine 2.9、JavaScript、Node.js test runner、FFmpeg、Playwright

---

## 文件结构

- 修改 `test/anime-page-scenes.test.cjs`：定义分类页新图片及桌面、手机裁切契约。
- 修改 `source/js/anime-page-scenes.js`：让分类路径返回新图片和裁切位置。
- 创建 `source/images/brand/category-library-glow.webp`：分类页本地压缩背景。
- 修改 `source/images/brand/sources.json`：记录素材槽位、文件、作者和来源页。
- 修改 `test/verify-site.mjs`：将新背景纳入文件存在性、内容去重和来源记录检查。

### Task 1: 更新分类页场景映射

**Files:**
- Modify: `test/anime-page-scenes.test.cjs:7-25`
- Modify: `source/js/anime-page-scenes.js:7-13`

- [ ] **Step 1: 写入失败的场景映射测试**

将测试用例中的两个分类页期望图片替换为新文件，并在同一个测试末尾增加裁切断言：

```js
const cases = [
  ['/categories/', 'categories', '/images/brand/category-library-glow.webp'],
  ['/categories/笔记/', 'categories', '/images/brand/category-library-glow.webp'],
  ['/tags/', 'tags', '/images/brand/morning-mountains.webp'],
  ['/tags/Hexo/', 'tags', '/images/brand/morning-mountains.webp'],
  ['/archives/', 'archives', '/images/brand/river-sunrise.webp'],
  ['/about/', 'about', '/images/brand/tech-lab.webp'],
];

const categoryScene = resolvePageScene('/categories/', '', origin);
assert.equal(categoryScene.desktopPosition, '54% center');
assert.equal(categoryScene.mobilePosition, '57% center');
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm run test:unit`

Expected: FAIL，分类页实际图片仍为 `/images/brand/book-spring.webp`。

- [ ] **Step 3: 最小化修改分类页场景**

将 `source/js/anime-page-scenes.js` 中分类场景改为：

```js
{
  pattern: /^\/categories(?:\/|$)/,
  type: 'categories',
  image: '/images/brand/category-library-glow.webp',
  desktopPosition: '54% center',
  mobilePosition: '57% center'
},
```

- [ ] **Step 4: 运行单元测试并确认通过**

Run: `npm run test:unit`

Expected: PASS，4 项测试全部通过。

- [ ] **Step 5: 提交场景映射**

```bash
git add test/anime-page-scenes.test.cjs source/js/anime-page-scenes.js
git commit -m "功能：替换分类页场景映射"
```

### Task 2: 接入压缩图片与来源记录

**Files:**
- Create: `source/images/brand/category-library-glow.webp`
- Modify: `source/images/brand/sources.json:32-37`
- Modify: `test/verify-site.mjs:7-48`

- [ ] **Step 1: 写入失败的品牌资源验证**

在 `expectedImages` 中加入：

```js
'category-library-glow.webp',
```

读取来源清单并验证分类槽位：

```js
const brandSources = JSON.parse(await read('source/images/brand/sources.json'));
const categorySource = brandSources.find((source) => source.slot === 'inner-categories');
if (
  categorySource?.file !== 'category-library-glow.webp'
  || categorySource?.author !== 'Tadokiari'
  || categorySource?.sourcePage !== 'https://wall.alphacoders.com/big.php?i=1317278'
) {
  failures.push('分类页背景缺少完整来源记录');
}
```

- [ ] **Step 2: 运行验证并确认按预期失败**

Run: `node test/verify-site.mjs`

Expected: FAIL，报告缺少 `source/images/brand/category-library-glow.webp` 和分类页来源记录。

- [ ] **Step 3: 下载原图并转换为 WebP**

```bash
curl -L --fail --max-time 120 \
  'https://images8.alphacoders.com/131/1317278.png' \
  -o /tmp/category-library-glow.png

ffmpeg -y -i /tmp/category-library-glow.png \
  -vf 'scale=1920:-2:flags=lanczos' \
  -c:v libwebp -quality 82 -compression_level 6 -preset picture -an \
  source/images/brand/category-library-glow.webp

file source/images/brand/category-library-glow.webp
test "$(stat -c %s source/images/brand/category-library-glow.webp)" -le 460800
```

Expected: 有效 WebP，宽度 1920 像素，文件不超过 460800 字节。

- [ ] **Step 4: 增加来源记录**

在 `sources.json` 末尾头像条目后增加逗号与以下对象：

```json
{
  "slot": "inner-categories",
  "file": "category-library-glow.webp",
  "author": "Tadokiari",
  "sourcePage": "https://wall.alphacoders.com/big.php?i=1317278"
}
```

- [ ] **Step 5: 构建站点并运行资源验证**

Run: `npm run build && node test/verify-site.mjs`

Expected: PASS，输出“站点资源、路由、RSS、字数统计与 MathJax 构建检查通过”。

- [ ] **Step 6: 提交图片与来源记录**

```bash
git add source/images/brand/category-library-glow.webp \
  source/images/brand/sources.json test/verify-site.mjs
git commit -m "资源：添加分类页暖金图书馆背景"
```

### Task 3: 浏览器视觉验证

**Files:**
- Verify: `public/categories/index.html`
- Verify: `public/categories/日志/index.html`

- [ ] **Step 1: 启动本地站点**

Run: `npm run server -- --ip 127.0.0.1 --port 4001`

Expected: Hexo 在 `http://127.0.0.1:4001` 提供页面。

- [ ] **Step 2: 检查桌面与手机浅色模式**

使用 Playwright 打开以下页面并截图：

```text
http://127.0.0.1:4001/categories/
http://127.0.0.1:4001/categories/日志/
```

视口：`1440 x 1000`、`390 x 844`。

Expected: 图片加载成功，人物面部可见，分类内容无遮挡，页面无横向滚动和文本重叠。

- [ ] **Step 3: 检查暗色模式与图片状态**

在 `html` 上启用 `dark` 类后重复两个视口截图，并在页面中执行：

```js
({
  page: document.documentElement.dataset.animePage,
  image: getComputedStyle(document.documentElement).getPropertyValue('--anime-page-image'),
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
})
```

Expected: `page` 为 `categories`，`image` 包含 `category-library-glow.webp`，`overflow` 为 `false`，暗色阅读层文字清晰。

- [ ] **Step 4: 运行最终验证**

Run: `npm run clean && npm test && git diff --check && git status --short`

Expected: 所有测试通过、无格式错误、工作区干净。
