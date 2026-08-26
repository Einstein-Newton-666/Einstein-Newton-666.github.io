# 分时原生 4K 背景实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用四张经用户确认的原生 4K 动画电影感图片实现首页分时背景，并用暖光图书馆替换归档页背景。

**Architecture:** 新增一个无 DOM 依赖的首页场景模块，集中保存四个场景及本地时间映射；现有主题脚本只负责把模块返回的场景渲染到 Redefine 横幅。所有图片下载后生成缩略图、标准版和 4K 本地 WebP，内页继续沿用现有双分辨率选择逻辑，导航栏完全由 Redefine 官方样式控制。

**Tech Stack:** Hexo 7.3、Redefine 2.9、原生 JavaScript UMD、Node.js 内置测试、FFmpeg/libwebp、Playwright CLI、GitHub Pages

---

## 文件结构

- Create: `source/js/anime-home-scenes.js`：首页四个场景的数据、时间段判断和初始场景选择。
- Create: `test/anime-home-scenes.test.cjs`：时间边界、无效日期和场景资源契约测试。
- Modify: `source/js/anime-theme.js`：从首页场景模块读取场景并按本地时间选择初始项。
- Modify: `source/js/anime-page-scenes.js`：将归档页映射改为暖光图书馆。
- Modify: `_config.redefine.yml`：注入场景模块，并将无脚本回退图和 Open Graph 图改为白日场景。
- Modify: `source/images/brand/sources.json`：记录四张首页原图和归档原图的来源、作者、原始尺寸与处理方式。
- Create: `source/images/brand/hero-{morning,day,sunset,night}{,-4k,-thumb}.webp`：四个首页场景的三档资源。
- Create: `source/images/brand/archive-warm-library{,-4k}.webp`：归档页双档资源。
- Delete: `source/images/brand/{miku-field,morning-mountains,river-sunrise}{,-4k,-thumb}.webp`：不再引用的旧首页资源。
- Delete: `source/images/brand/archive-star-bay{,-4k}.webp`：不再引用的旧归档资源。
- Modify: `test/anime-theme.test.cjs`：首页模块接入和四场景渲染契约。
- Modify: `test/anime-page-scenes.test.cjs`：归档页新映射契约。
- Modify: `test/verify-site.mjs`：构建资源、来源记录、体积和无旧引用检查。

### Task 1: 原生 4K 候选筛选与用户确认

**Files:**
- Temporary: `.superpowers/brainstorm/<session>/content/native-4k-shortlist.html`
- No formal site files changed

- [ ] **Step 1: 按当前首页画风建立候选池**

分别搜索以下四类横向图片，每类保留 3 张：

```text
晨光：anime cinematic sunrise mountains clouds field 4k
白日：anime cinematic blue sky cumulus green field 4k
黄昏：anime cinematic sunset valley pink clouds 4k
夜晚：anime cinematic starry sky milky way aurora landscape 4k
```

来源优先使用可查看原始尺寸和来源页的站点。只保留原文件宽度至少 3840 像素、横向比例至少 1.5、无明显水印、无低质量放大痕迹的图片。人物可以出现或成为主体，但左侧 45% 桌面标题区必须可读，390×844 裁切必须保留人物面部或核心景物。

- [ ] **Step 2: 验证候选原始文件而非预览图**

将候选原文件下载到 `/tmp/einstein-native-4k-candidates/`，逐个运行：

```bash
for image in /tmp/einstein-native-4k-candidates/*; do
  printf '%s\t' "$image"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$image"
done
```

Expected: 每个候选宽度至少为 `3840`；任何只有预览尺寸或由站点插值生成的候选立即删除。

- [ ] **Step 3: 制作实际横幅裁切对比页**

在视觉伴侣页面中为每张候选同时显示 `1440×820` 桌面裁切与 `390×760` 手机裁切，叠加正式首页左侧渐变、标题和场景文案。每个时段最多展示 3 张，标注来源页与原始尺寸。

- [ ] **Step 4: 等待用户逐时段确认**

必须取得晨光、白日、黄昏、夜晚四张图片的明确选择。用户未确认前不得复制到 `source/images/brand/`，也不得替用户选择。

- [ ] **Step 5: 记录最终来源清单**

在执行记录中保存四个来源页、直接原图地址、作者（可取得时）、宽高和推荐桌面/手机焦点。此步骤不提交临时候选图。

### Task 2: 首页场景与时间选择模块

**Files:**
- Create: `test/anime-home-scenes.test.cjs`
- Create: `source/js/anime-home-scenes.js`

- [ ] **Step 1: 写入失败的时间边界测试**

创建 `test/anime-home-scenes.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slides,
  resolveTimePeriod,
  resolveHomeSceneIndex,
} = require('../source/js/anime-home-scenes.js');

function localDate(hour, minute = 0) {
  const date = new Date(2026, 7, 26, hour, minute, 0, 0);
  return date;
}

test('按本地时间边界返回四个首页时段', () => {
  const cases = [
    [localDate(4, 59), 'night'],
    [localDate(5), 'morning'],
    [localDate(10, 59), 'morning'],
    [localDate(11), 'day'],
    [localDate(16, 59), 'day'],
    [localDate(17), 'sunset'],
    [localDate(19, 59), 'sunset'],
    [localDate(20), 'night'],
  ];

  for (const [date, expected] of cases) {
    assert.equal(resolveTimePeriod(date), expected);
  }
});

test('无效日期回退到白日场景', () => {
  assert.equal(resolveTimePeriod(new Date(Number.NaN)), 'day');
  assert.equal(resolveHomeSceneIndex(new Date(Number.NaN)), 1);
});

test('四个场景使用互不重复的三档本地资源', () => {
  assert.deepEqual(slides.map((slide) => slide.period), [
    'morning',
    'day',
    'sunset',
    'night',
  ]);
  for (const slide of slides) {
    assert.match(slide.src, /^\/images\/brand\/hero-[a-z]+\.webp$/);
    assert.match(slide.src4k, /^\/images\/brand\/hero-[a-z]+-4k\.webp$/);
    assert.match(slide.thumb, /^\/images\/brand\/hero-[a-z]+-thumb\.webp$/);
  }
  assert.equal(new Set(slides.flatMap(({ src, src4k, thumb }) => [src, src4k, thumb])).size, 12);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/anime-home-scenes.test.cjs`

Expected: FAIL，错误为找不到 `source/js/anime-home-scenes.js`。

- [ ] **Step 3: 实现无 DOM 依赖的场景模块**

创建 `source/js/anime-home-scenes.js`：

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimeHomeScenes = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const slides = [
    {
      period: 'morning',
      src: '/images/brand/hero-morning.webp',
      src4k: '/images/brand/hero-morning-4k.webp',
      thumb: '/images/brand/hero-morning-thumb.webp',
      alt: '晨光中的动画风景',
      kicker: 'MORNING LOG · 01',
      scene: '在晨光里，写下今天的第一行',
      note: '让新的问题与灵感，从清晰而安静的早晨开始。',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    },
    {
      period: 'day',
      src: '/images/brand/hero-day.webp',
      src4k: '/images/brand/hero-day-4k.webp',
      thumb: '/images/brand/hero-day-thumb.webp',
      alt: '晴空下的动画风景',
      kicker: 'DAYLIGHT NOTE · 02',
      scene: '把思路铺开，让答案逐渐清晰',
      note: '在明亮的天空下，整理技术笔记与生活片段。',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    },
    {
      period: 'sunset',
      src: '/images/brand/hero-sunset.webp',
      src4k: '/images/brand/hero-sunset-4k.webp',
      thumb: '/images/brand/hero-sunset-thumb.webp',
      alt: '晚霞中的动画风景',
      kicker: 'SUNSET JOURNAL · 03',
      scene: '在天色变深以前，收好今天的片段',
      note: '把完成的工作、未解的问题与沿途风景留在这里。',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    },
    {
      period: 'night',
      src: '/images/brand/hero-night.webp',
      src4k: '/images/brand/hero-night-4k.webp',
      thumb: '/images/brand/hero-night-thumb.webp',
      alt: '星空下的动画风景',
      kicker: 'NIGHT ARCHIVE · 04',
      scene: '让安静的夜晚，收纳仍在延伸的思绪',
      note: '在星光与屏幕之间，为今天的记录留下结尾。',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    }
  ];

  function resolveTimePeriod(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const hour = date.getHours();
    if (!Number.isInteger(hour)) return 'day';
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'day';
    if (hour >= 17 && hour < 20) return 'sunset';
    return 'night';
  }

  function resolveHomeSceneIndex(value = new Date()) {
    const period = resolveTimePeriod(value);
    const index = slides.findIndex((slide) => slide.period === period);
    return index === -1 ? 1 : index;
  }

  return { slides, resolveTimePeriod, resolveHomeSceneIndex };
}));
```

初始焦点均写为 `50% center`，Task 1 确认图片后用实际裁切记录替换八个焦点值。

- [ ] **Step 4: 运行单元测试**

Run: `node --test test/anime-home-scenes.test.cjs`

Expected: 3 tests PASS。

- [ ] **Step 5: 提交场景模块**

```bash
git add source/js/anime-home-scenes.js test/anime-home-scenes.test.cjs
git commit -m "功能：添加首页分时时段模型"
```

### Task 3: 生成首页与归档多档图片资源

**Files:**
- Create: `source/images/brand/hero-{morning,day,sunset,night}{,-4k,-thumb}.webp`
- Create: `source/images/brand/archive-warm-library{,-4k}.webp`
- Modify: `source/images/brand/sources.json`
- Modify: `test/verify-site.mjs`

- [ ] **Step 1: 先更新失败的资源契约**

在 `test/verify-site.mjs` 中把旧首页和归档文件替换为：

```js
const homePeriods = ['morning', 'day', 'sunset', 'night'];
const expectedImages = [
  ...homePeriods.flatMap((period) => [
    `hero-${period}.webp`,
    `hero-${period}-4k.webp`,
    `hero-${period}-thumb.webp`,
  ]),
  'archive-warm-library.webp',
  'archive-warm-library-4k.webp',
  'firefly-side.webp',
  'tech-lab.webp',
  'book-spring.webp',
  'category-library-glow.webp',
  'category-library-glow-4k.webp',
  'tag-cloud-city.webp',
  'tag-cloud-city-4k.webp',
  'article-digital-library.webp',
  'article-digital-library-4k.webp',
  'about-sky-terminal.webp',
  'about-sky-terminal-4k.webp',
  'castorice-avatar.webp',
  'castorice-avatar-display.webp',
];

const imageSizeLimits = new Map([
  ...homePeriods.map((period) => [`hero-${period}-thumb.webp`, 30 * 1024]),
  ['castorice-avatar-display.webp', 50 * 1024],
]);
```

将来源映射中的首页和归档项改为 `hero-morning`、`hero-day`、`hero-sunset`、`hero-night` 与 `archive-warm-library`，并为这五项增加原始宽度断言：

```js
for (const slot of ['hero-morning', 'hero-day', 'hero-sunset', 'hero-night', 'inner-archives']) {
  const source = brandSources.find((candidate) => candidate.slot === slot);
  if ((source?.originalDimensions?.width || 0) < 3840) {
    failures.push(`${slot} 不是原生 4K 来源`);
  }
}
```

- [ ] **Step 2: 运行构建检查并确认失败**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，缺少十二张首页资源、两张归档资源及对应来源记录。

- [ ] **Step 3: 下载五张已确认原图到临时目录**

创建 `/tmp/einstein-native-4k-approved/`，按 Task 1 的确认结果保存为：

```text
hero-morning-original
hero-day-original
hero-sunset-original
hero-night-original
archive-warm-library-original
```

归档原图固定使用已确认来源：`https://safebooru.org/index.php?page=post&s=view&id=7051655`，原始尺寸应为 `5156×3402`。首页四张必须使用 Task 1 中用户确认的直接原图地址，不得下载页面预览图。

- [ ] **Step 4: 再次验证原始宽高**

Run:

```bash
for image in /tmp/einstein-native-4k-approved/*; do
  printf '%s\t' "$image"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$image"
done
```

Expected: 五张宽度均至少为 3840；归档为 `5156x3402`。不满足时返回 Task 1，不能继续编码。

- [ ] **Step 5: 从原图生成三档首页 WebP**

对四个首页时段分别执行，输入文件使用对应的 `*-original`：

```bash
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-morning-original -vf 'scale=320:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/hero-morning-thumb.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-morning-original -vf 'scale=1920:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 82 -compression_level 6 source/images/brand/hero-morning.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-morning-original -vf 'scale=3840:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 80 -compression_level 6 source/images/brand/hero-morning-4k.webp

ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-day-original -vf 'scale=320:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/hero-day-thumb.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-day-original -vf 'scale=1920:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 82 -compression_level 6 source/images/brand/hero-day.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-day-original -vf 'scale=3840:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 80 -compression_level 6 source/images/brand/hero-day-4k.webp

ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-sunset-original -vf 'scale=320:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/hero-sunset-thumb.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-sunset-original -vf 'scale=1920:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 82 -compression_level 6 source/images/brand/hero-sunset.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-sunset-original -vf 'scale=3840:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 80 -compression_level 6 source/images/brand/hero-sunset-4k.webp

ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-night-original -vf 'scale=320:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 72 source/images/brand/hero-night-thumb.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-night-original -vf 'scale=1920:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 82 -compression_level 6 source/images/brand/hero-night.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/hero-night-original -vf 'scale=3840:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 80 -compression_level 6 source/images/brand/hero-night-4k.webp
```

所有 4K 输出都直接读取对应 `*-original`，不得从 1920 标准版生成。

- [ ] **Step 6: 从归档原图生成双档 WebP**

```bash
ffmpeg -y -i /tmp/einstein-native-4k-approved/archive-warm-library-original -vf 'scale=1920:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 82 -compression_level 6 source/images/brand/archive-warm-library.webp
ffmpeg -y -i /tmp/einstein-native-4k-approved/archive-warm-library-original -vf 'scale=3840:-2:flags=lanczos' -frames:v 1 -c:v libwebp -preset picture -quality 80 -compression_level 6 source/images/brand/archive-warm-library-4k.webp
```

- [ ] **Step 7: 检查尺寸、体积和视觉质量**

Run:

```bash
for image in source/images/brand/hero-*.webp source/images/brand/archive-warm-library*.webp; do
  printf '%s\t' "$image"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$image"
done
ls -lh source/images/brand/hero-*.webp source/images/brand/archive-warm-library*.webp
```

Expected: 缩略图宽 320、标准版宽 1920、4K 版宽 3840；缩略图各自小于 30 KB。标准版目标不超过 450 KB，4K 版目标不超过 1.2 MB。超过目标时每次只降低 2 点质量并重新检查天空色带、人物面部、发丝和建筑线条；不得低于质量 74。

- [ ] **Step 8: 写入完整来源记录**

在 `source/images/brand/sources.json` 中用五个新对象替换旧首页和归档对象。每个对象必须包含 `slot`、`file`、`file4k`、首页的 `thumb`、`sourcePage`、可取得时的 `author`、真实 `originalDimensions` 和 `processing`。处理说明统一为“标准版与 4K 版均从原始高分辨率文件直接缩放并编码为 WebP”。体积超限项增加含实际 bytes 的 `sizeException`。

- [ ] **Step 9: 运行资源契约测试**

Run: `npm run build && node test/verify-site.mjs`

Expected: 资源和来源相关失败消失；脚本引用尚未切换造成的旧首页引用失败允许保留到 Task 4。

- [ ] **Step 10: 提交新资源但暂不删除旧资源**

```bash
git add source/images/brand/hero-*.webp source/images/brand/archive-warm-library*.webp source/images/brand/sources.json test/verify-site.mjs
git commit -m "资源：添加分时原生 4K 背景"
```

### Task 4: 接入首页分时切换

**Files:**
- Modify: `test/anime-theme.test.cjs`
- Modify: `source/js/anime-theme.js`
- Modify: `_config.redefine.yml`

- [ ] **Step 1: 更新失败的首页接入测试**

将 `test/anime-theme.test.cjs` 的旧三场景断言替换为：

```js
test('首页从分时模块读取四个场景并按本地时间初始化', () => {
  assert.match(script, /globalThis\.AnimeHomeScenes/);
  assert.match(script, /resolveHomeSceneIndex\(new Date\(\)\)/);
  assert.match(script, /setSlide\(initialIndex\)/);
  assert.doesNotMatch(script, /miku-field|morning-mountains|river-sunrise/);
});

test('场景按钮继续使用缩略图并保留响应式正式图', () => {
  assert.match(script, /<img src="\$\{slide\.thumb\}" alt="" loading="lazy" decoding="async">/);
  assert.match(script, /image\.srcset = `\$\{slide\.src\} 1920w, \$\{slide\.src4k\} 3840w`/);
  assert.match(script, /image\.sizes = '100vw'/);
});
```

- [ ] **Step 2: 运行单元测试并确认失败**

Run: `npm run test:unit`

Expected: FAIL，首页仍在 `anime-theme.js` 内声明旧三场景并固定 `setSlide(0)`。

- [ ] **Step 3: 让主题脚本读取场景模块**

删除 `source/js/anime-theme.js` 顶部的本地 `slides` 数组，在运行时对象后加入：

```js
  const homeScenes = globalThis.AnimeHomeScenes;
  const slides = homeScenes?.slides || [];
  const resolveHomeSceneIndex = homeScenes?.resolveHomeSceneIndex;
```

首页 DOM 查询之后、初始化标记之前加入：

```js
    if (!slides.length || !resolveHomeSceneIndex) return;
```

把函数结尾的固定初始化替换为：

```js
    const initialIndex = resolveHomeSceneIndex(new Date());
    setSlide(initialIndex);
```

按钮模板初始 `aria-pressed` 全部写为 `false`，由 `setSlide` 设置实际活动项，避免无障碍状态短暂错误。

- [ ] **Step 4: 调整注入顺序和回退图片**

在 `_config.redefine.yml` 中将 Open Graph 和横幅回退图改为白日场景：

```yaml
global:
  open_graph:
    image: /images/brand/hero-day.webp

home_banner:
  image:
    light: /images/brand/hero-day.webp
    dark: /images/brand/hero-day.webp
```

将脚本注入顺序改为：

```yaml
inject:
  footer:
    - '<script src="/js/anime-home-scenes.js"></script>'
    - '<script src="/js/anime-page-scenes.js"></script>'
    - '<script src="/js/anime-theme.js"></script>'
```

- [ ] **Step 5: 用确认后的裁切焦点更新场景数据**

根据 Task 1 的桌面与手机裁切记录更新 `anime-home-scenes.js` 中四个 `desktopPosition` 和 `mobilePosition`。只调整百分比焦点，不增加按图片定制的 CSS 选择器。

- [ ] **Step 6: 运行单元和构建测试**

Run: `npm run test:unit && npm run clean && npm run build && node test/verify-site.mjs`

Expected: PASS；首页 HTML 先加载 `anime-home-scenes.js`，再加载 `anime-theme.js`，且不再引用旧三张首页图。

- [ ] **Step 7: 提交首页接入**

```bash
git add _config.redefine.yml source/js/anime-home-scenes.js source/js/anime-theme.js test/anime-theme.test.cjs test/verify-site.mjs
git commit -m "功能：首页背景按本地时间切换"
```

### Task 5: 替换归档背景并移除旧资源

**Files:**
- Modify: `test/anime-page-scenes.test.cjs`
- Modify: `source/js/anime-page-scenes.js`
- Delete: old homepage and archive WebP files

- [ ] **Step 1: 写入失败的归档映射测试**

在 `test/anime-page-scenes.test.cjs` 的 `cases` 中使用：

```js
    ['/archives/', 'archives', 'archive-warm-library'],
```

并把首页排除列表替换为：

```js
  for (const heroImage of [
    '/images/brand/hero-morning.webp',
    '/images/brand/hero-day.webp',
    '/images/brand/hero-sunset.webp',
    '/images/brand/hero-night.webp',
  ]) {
    assert.equal(new Set(topLevelScenes.values()).has(heroImage), false);
  }
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/anime-page-scenes.test.cjs`

Expected: FAIL，归档仍返回 `archive-star-bay.webp`。

- [ ] **Step 3: 修改归档场景映射**

在 `source/js/anime-page-scenes.js` 的 `archives` 场景中改为：

```js
      image: '/images/brand/archive-warm-library.webp',
      image4k: '/images/brand/archive-warm-library-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
```

根据 Task 1 归档模拟页的裁切检查，只调整两个焦点百分比。

- [ ] **Step 4: 删除所有已无引用的旧背景资源**

先运行只读检查：

```bash
rg -n 'miku-field|morning-mountains|river-sunrise|archive-star-bay' --glob '!docs/superpowers/**' .
```

Expected: 只剩待删除文件自身或 `public/` 构建缓存；源代码、配置、测试和 `sources.json` 均无引用。随后删除旧首页九个文件和旧归档两个文件，不删除历史设计文档中的记录。

- [ ] **Step 5: 运行完整测试**

Run: `npm run clean && npm test`

Expected: 单元测试、Hexo 构建与站点契约全部 PASS；正式 HTML 不引用旧文件。

- [ ] **Step 6: 提交归档替换与清理**

```bash
git add source/js/anime-page-scenes.js test/anime-page-scenes.test.cjs source/images/brand source/images/brand/sources.json test/verify-site.mjs
git commit -m "资源：替换归档背景并清理旧图"
```

### Task 6: 浏览器视觉、导航栏与性能回归

**Files:**
- Temporary: `output/playwright/time-backgrounds/`
- No formal source changes unless a verified defect is found

- [ ] **Step 1: 启动本地站点**

Run: `npm run clean && npm run build && npm run server`

Expected: Hexo server reports a reachable local URL；若 4000 端口已占用，使用 `npx hexo server -p 4001`。

- [ ] **Step 2: 在浏览器中检查初始时段和四个场景**

使用 Playwright CLI 打开首页，读取当前本地小时和活动按钮，确认它与 `resolveTimePeriod(new Date())` 返回的场景一致。随后按顺序点击四个场景按钮；每次点击后重新读取活动按钮、主图 `currentSrc` 与所有横幅图片的 `naturalWidth`。Expected: 四个按钮各自能成为唯一活动项，主图路径随场景变化，所有 `naturalWidth > 0`。`05:00`、`11:00`、`17:00`、`20:00` 等时间边界由 Task 2 的单元测试覆盖，不修改系统时间。

- [ ] **Step 3: 截取桌面、4K 和手机画面**

为四个时段分别检查 `1440×1000` 与 `390×844`；至少为当前本地时间场景额外检查 `3840×2160`。截图保存到 `output/playwright/time-backgrounds/`，确认手机裁切保留人物面部或核心景物，页面无横向溢出，首屏底部仍露出下一段内容。

- [ ] **Step 4: 检查归档页和导航栏官方行为**

打开 `/archives/` 的桌面、手机、浅色和暗色状态。确认暖光图书馆背景加载、内容可读、导航栏在首页顶部、滚动后和归档页上的 class 与 Redefine 主题逻辑一致。检查 `source/css/anime-theme.css` 不含针对导航栏背景、透明度、模糊或阴影的自定义规则。

- [ ] **Step 5: 检查资源请求档位**

确认 1440×1000、DPR 1 首页使用 1920 标准版；3840×2160 首页使用 4K 版；390×844、DPR 3 不因缩略图或归档背景下载不必要的 4K 内页资源。手动切换前不得预下载四张正式背景，只允许加载缩略图。

- [ ] **Step 6: 检查暗色和低动态偏好**

确认暗色模式仍能读取当前分时场景，`prefers-reduced-motion: reduce` 下没有新增动画，手动切换和键盘焦点正常。

- [ ] **Step 7: 运行最终验证**

Run:

```bash
npm run clean
npm test
git diff --check
git status --short
```

Expected: 全部测试 PASS；`git diff --check` 无输出；工作树只允许出现 `.superpowers/` 和 `output/playwright/` 临时验收文件。

- [ ] **Step 8: 清理本次临时文件并提交必要修正**

停止本地服务与视觉伴侣服务，删除本次创建的 `.superpowers/brainstorm/` 会话和 `output/playwright/time-backgrounds/`。若视觉验收产生了焦点或文案修正，运行 `npm test` 后单独提交：

```bash
git add source/js/anime-home-scenes.js source/js/anime-page-scenes.js
git commit -m "样式：修正分时背景响应式焦点"
```

Expected: `git status --short` 无输出，所有正式修改均已提交；只有用户明确要求时才执行 `git push`。
