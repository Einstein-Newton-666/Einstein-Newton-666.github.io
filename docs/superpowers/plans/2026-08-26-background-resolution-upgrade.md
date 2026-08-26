# 全站背景双分辨率升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为首页三张轮播背景和五类内页背景提供标准版与 4K 本地 WebP，在不改变现有透明度、头像、文章封面和 GitHub Actions 构建方式的前提下，按视口与像素密度加载合适资源。

**Architecture:** `anime-page-scenes.js` 继续作为页面类型与背景资源的唯一映射层，并新增可单测的分辨率档位判断函数；`anime-theme.js` 负责把首页双候选交给浏览器，并按明确阈值为内页选择资源和处理防抖 resize。所有图片离线生成后提交到 `source/images/brand/`，运行时不连接图片源站，CI 只构建静态站点。

**Tech Stack:** Hexo 7.3、Redefine 2.9、原生 JavaScript、Node.js `node:test`、FFmpeg/libwebp、临时 Real-ESRGAN NCNN Vulkan、Playwright CLI。

---

## 文件映射

**修改：**

- `source/js/anime-page-scenes.js:6-69`：五类内页的标准/4K 映射、固定文章背景、分辨率档位纯函数。
- `source/js/anime-theme.js:2-120`：首页 `srcset`/`sizes`、内页初始标准图、4K 档位切换和 resize 防抖。
- `source/images/brand/sources.json:1-43`：背景标准文件、4K 文件、原始尺寸、来源与处理方式。
- `test/anime-page-scenes.test.cjs:1-56`：页面映射、去重、文章固定背景和阈值边界。
- `test/anime-theme.test.cjs`：首页三个场景的标准/4K 候选和运行时接入契约。
- `test/verify-site.mjs:7-105`：新资源、来源记录、透明度和运行时本地图片契约。

**新增二进制资源：**

- `source/images/brand/miku-field-4k.webp`
- `source/images/brand/morning-mountains-4k.webp`
- `source/images/brand/river-sunrise-4k.webp`
- `source/images/brand/category-library-glow-4k.webp`
- `source/images/brand/tag-cloud-city.webp`
- `source/images/brand/tag-cloud-city-4k.webp`
- `source/images/brand/archive-star-bay.webp`
- `source/images/brand/archive-star-bay-4k.webp`
- `source/images/brand/article-digital-library.webp`
- `source/images/brand/article-digital-library-4k.webp`
- `source/images/brand/about-sky-terminal.webp`
- `source/images/brand/about-sky-terminal-4k.webp`

**明确不修改：**

- `source/css/anime-theme.css`：当前浅色/暗色遮罩、导航、卡片透明度和首页渐变保持原值。
- `_config.redefine.yml`：头像、文章封面、首页默认图配置保持不变。
- `node_modules/`、`package.json`、`package-lock.json`、`.github/workflows/pages.yml`：不引入运行时或 CI 图片处理依赖。

### Task 1: 用失败测试锁定页面映射和分辨率规则

**Files:**

- Modify: `test/anime-page-scenes.test.cjs:1-56`
- Test: `test/anime-page-scenes.test.cjs`

- [ ] **Step 1: 将导入扩展为三个公开函数**

把文件顶部导入改为：

```js
const {
  resolvePageScene,
  selectSceneImage,
  shouldUseHighResolution,
} = require('../source/js/anime-page-scenes.js');
```

- [ ] **Step 2: 用完整双分辨率用例替换现有索引页和文章页测试**

```js
test('为五类内页分配互不重复的固定双分辨率场景', () => {
  const cases = [
    ['/categories/', 'categories', 'category-library-glow'],
    ['/categories/笔记/', 'categories', 'category-library-glow'],
    ['/tags/', 'tags', 'tag-cloud-city'],
    ['/tags/Hexo/', 'tags', 'tag-cloud-city'],
    ['/archives/', 'archives', 'archive-star-bay'],
    ['/about/', 'about', 'about-sky-terminal'],
    ['/2026/08/15/welcome/', 'post', 'article-digital-library'],
  ];

  const topLevelScenes = new Map();
  for (const [pathname, type, basename] of cases) {
    const scene = resolvePageScene(pathname, `${origin}/images/brand/firefly-side.webp`, origin);
    assert.equal(scene.type, type);
    assert.equal(scene.image, `/images/brand/${basename}.webp`);
    assert.equal(scene.image4k, `/images/brand/${basename}-4k.webp`);
    if (!topLevelScenes.has(type)) topLevelScenes.set(type, scene.image);
  }

  assert.equal(new Set(topLevelScenes.values()).size, 5);
  for (const heroImage of [
    '/images/brand/miku-field.webp',
    '/images/brand/morning-mountains.webp',
    '/images/brand/river-sunrise.webp',
  ]) {
    assert.equal(new Set(topLevelScenes.values()).has(heroImage), false);
  }
  const categoryScene = resolvePageScene('/categories/', '', origin);
  assert.equal(categoryScene.desktopPosition, '54% center');
  assert.equal(categoryScene.mobilePosition, '57% center');
});

test('文章页忽略 Open Graph 封面并固定使用数字文库背景', () => {
  const localCover = resolvePageScene(
    '/2026/08/15/welcome/',
    `${origin}/images/brand/firefly-side.webp`,
    origin,
  );
  const externalCover = resolvePageScene(
    '/2026/08/15/welcome/',
    'https://example.com/external.webp',
    origin,
  );

  for (const scene of [localCover, externalCover]) {
    assert.equal(scene.image, '/images/brand/article-digital-library.webp');
    assert.equal(scene.image4k, '/images/brand/article-digital-library-4k.webp');
  }
});
```

- [ ] **Step 3: 增加阈值边界与回退测试**

```js
test('只为宽桌面或有效像素足够的桌面启用 4K', () => {
  assert.equal(shouldUseHighResolution(2560, 1), true);
  assert.equal(shouldUseHighResolution(2559, 1), false);
  assert.equal(shouldUseHighResolution(1280, 2), true);
  assert.equal(shouldUseHighResolution(1200, 2), false);
  assert.equal(shouldUseHighResolution(390, 3), false);
  assert.equal(shouldUseHighResolution(undefined, undefined), false);
});

test('按档位返回内页图片且在缺少 4K 时回退标准图', () => {
  const scene = { image: '/standard.webp', image4k: '/high.webp' };
  assert.equal(selectSceneImage(scene, 1440, 1), '/standard.webp');
  assert.equal(selectSceneImage(scene, 1440, 2), '/high.webp');
  assert.equal(selectSceneImage({ image: '/standard.webp' }, 3840, 1), '/standard.webp');
});
```

保留“首页和未知页面不启用内页场景”测试。

- [ ] **Step 4: 运行测试并确认因 API 和映射尚未实现而失败**

Run: `npm run test:unit`

Expected: FAIL，错误应指向 `shouldUseHighResolution`/`selectSceneImage` 未导出或新图片路径不匹配；不能出现语法错误。

- [ ] **Step 5: 保留失败测试供 Task 5 完成闭环**

此时不提交失败测试。保持 `test/anime-page-scenes.test.cjs` 为未暂存更改，等 Task 5 的实现让它通过后，与实现一起提交。

### Task 2: 获取并验证原图，生成五类内页双分辨率资源

**Files:**

- Create: `source/images/brand/category-library-glow-4k.webp`
- Create: `source/images/brand/tag-cloud-city.webp`
- Create: `source/images/brand/tag-cloud-city-4k.webp`
- Create: `source/images/brand/archive-star-bay.webp`
- Create: `source/images/brand/archive-star-bay-4k.webp`
- Create: `source/images/brand/article-digital-library.webp`
- Create: `source/images/brand/article-digital-library-4k.webp`
- Create: `source/images/brand/about-sky-terminal.webp`
- Create: `source/images/brand/about-sky-terminal-4k.webp`

- [ ] **Step 1: 创建任务专用临时目录并下载原图**

```bash
mkdir -p /tmp/einstein-background-upgrade/raw
curl -L --fail --retry 4 --retry-all-errors \
  'https://images8.alphacoders.com/131/1317278.png' \
  -o /tmp/einstein-background-upgrade/raw/category.png
curl -L --fail --retry 4 --retry-all-errors \
  'https://safebooru.org//images/77/422a5c139f0d5d23b6a5901e39f79292a67bd18e.jpg?7085343' \
  -o /tmp/einstein-background-upgrade/raw/tags.jpg
curl -L --fail --retry 4 --retry-all-errors \
  'https://safebooru.org//images/329/061b5eb1f0144d8695f7375221de948449a00edb.jpg?7009209' \
  -o /tmp/einstein-background-upgrade/raw/archives.jpg
curl -L --fail --retry 4 --retry-all-errors \
  'https://safebooru.org//images/314/d9fba234ed0a0e352d94c24c3b2c84b74b23ad2b.jpg?6716883' \
  -o /tmp/einstein-background-upgrade/raw/article.jpg
curl -L --fail --retry 4 --retry-all-errors \
  'https://safebooru.org//images/4142/60998b3720f6db95f9cc37e6920c10b646c496de.png?6507788' \
  -o /tmp/einstein-background-upgrade/raw/about.png
```

- [ ] **Step 2: 在编码前验证下载完整且尺寸准确**

```bash
for image in /tmp/einstein-background-upgrade/raw/*; do
  ffmpeg -v error -i "$image" -f null - || exit 1
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=p=0 "$image"
done
```

Expected: 五个文件均可完整解码；输出集合包含 `8736,4896`、`4000,1857`、`4000,2500`、`7200,4050`、`5910,2944`。任何解码错误都必须重新下载，不能继续处理残缺文件。

- [ ] **Step 3: 从原图直接编码标准版与 4K 版**

```bash
ffmpeg -y -i /tmp/einstein-background-upgrade/raw/category.png -vf 'scale=3840:-2:flags=lanczos' -c:v libwebp -preset drawing -quality 82 -compression_level 6 source/images/brand/category-library-glow-4k.webp

ffmpeg -y -i /tmp/einstein-background-upgrade/raw/tags.jpg -vf 'scale=1920:-2:flags=lanczos' -c:v libwebp -preset photo -quality 82 -compression_level 6 source/images/brand/tag-cloud-city.webp
ffmpeg -y -i /tmp/einstein-background-upgrade/raw/tags.jpg -vf 'scale=3840:-2:flags=lanczos' -c:v libwebp -preset photo -quality 80 -compression_level 6 source/images/brand/tag-cloud-city-4k.webp

ffmpeg -y -i /tmp/einstein-background-upgrade/raw/archives.jpg -vf 'scale=1920:-2:flags=lanczos' -c:v libwebp -preset photo -quality 82 -compression_level 6 source/images/brand/archive-star-bay.webp
ffmpeg -y -i /tmp/einstein-background-upgrade/raw/archives.jpg -vf 'scale=3840:-2:flags=lanczos' -c:v libwebp -preset photo -quality 80 -compression_level 6 source/images/brand/archive-star-bay-4k.webp

ffmpeg -y -i /tmp/einstein-background-upgrade/raw/article.jpg -vf 'scale=1920:-2:flags=lanczos' -c:v libwebp -preset drawing -quality 82 -compression_level 6 source/images/brand/article-digital-library.webp
ffmpeg -y -i /tmp/einstein-background-upgrade/raw/article.jpg -vf 'scale=3840:-2:flags=lanczos' -c:v libwebp -preset drawing -quality 80 -compression_level 6 source/images/brand/article-digital-library-4k.webp

ffmpeg -y -i /tmp/einstein-background-upgrade/raw/about.png -vf 'scale=1920:-2:flags=lanczos' -c:v libwebp -preset drawing -quality 82 -compression_level 6 source/images/brand/about-sky-terminal.webp
ffmpeg -y -i /tmp/einstein-background-upgrade/raw/about.png -vf 'scale=3840:-2:flags=lanczos' -c:v libwebp -preset drawing -quality 80 -compression_level 6 source/images/brand/about-sky-terminal-4k.webp
```

如果标准版超过 450 KB 或 4K 版超过 1.2 MB，每次只降低 2 点 `quality` 并重新目视检查；不得低于 74。低于该值才满足体积时，保留质量更好的版本，并在 Task 4 对应记录增加具体 `sizeException`。

- [ ] **Step 4: 验证成品尺寸、体积和可解码性**

```bash
for image in source/images/brand/{category-library-glow-4k,tag-cloud-city,tag-cloud-city-4k,archive-star-bay,archive-star-bay-4k,article-digital-library,article-digital-library-4k,about-sky-terminal,about-sky-terminal-4k}.webp; do
  ffmpeg -v error -i "$image" -f null - || exit 1
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$image"
  stat -c '%n %s bytes' "$image"
done
```

Expected: 标准版宽 1920；4K 版宽 3840；所有文件完整解码。逐张查看人物五官、细线、天空渐变和建筑轮廓，拒绝明显色带、断线或块状伪影。

- [ ] **Step 5: 暂存内页图片，尚不提交**

```bash
git add source/images/brand/category-library-glow-4k.webp \
  source/images/brand/tag-cloud-city.webp source/images/brand/tag-cloud-city-4k.webp \
  source/images/brand/archive-star-bay.webp source/images/brand/archive-star-bay-4k.webp \
  source/images/brand/article-digital-library.webp source/images/brand/article-digital-library-4k.webp \
  source/images/brand/about-sky-terminal.webp source/images/brand/about-sky-terminal-4k.webp
```

### Task 3: 用临时 AI 超分生成首页 4K 资源并设置质量闸门

**Files:**

- Create: `source/images/brand/miku-field-4k.webp`
- Create: `source/images/brand/morning-mountains-4k.webp`
- Create: `source/images/brand/river-sunrise-4k.webp`

- [ ] **Step 1: 在临时目录安装官方 Real-ESRGAN 命令行包**

```bash
mkdir -p /tmp/einstein-background-upgrade/realesrgan
curl -L --fail --retry 4 --retry-all-errors -C - \
  'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip' \
  -o /tmp/einstein-background-upgrade/realesrgan.zip
unzip -q /tmp/einstein-background-upgrade/realesrgan.zip \
  -d /tmp/einstein-background-upgrade/realesrgan
chmod +x /tmp/einstein-background-upgrade/realesrgan/realesrgan-ncnn-vulkan
```

- [ ] **Step 2: 转为无损 PNG 后执行 2 倍动漫模型超分**

```bash
for name in miku-field morning-mountains river-sunrise; do
  ffmpeg -y -i "source/images/brand/$name.webp" \
    "/tmp/einstein-background-upgrade/$name-input.png"
  /tmp/einstein-background-upgrade/realesrgan/realesrgan-ncnn-vulkan \
    -i "/tmp/einstein-background-upgrade/$name-input.png" \
    -o "/tmp/einstein-background-upgrade/$name-2x.png" \
    -m /tmp/einstein-background-upgrade/realesrgan/models \
    -n realesrgan-x4plus-anime -s 2 -f png
done
```

Quality gate: 如果二进制无法识别 Vulkan/GPU，或任何输出的脸部、文字、手指、头发与地平线出现明显错误，立即停止本计划并报告具体失败；不得用 Lanczos、双三次或其他普通插值生成这三张 `-4k` 文件。

- [ ] **Step 3: 把通过目视检查的超分 PNG 编码成 4K WebP**

```bash
for name in miku-field morning-mountains river-sunrise; do
  ffmpeg -y -i "/tmp/einstein-background-upgrade/$name-2x.png" \
    -c:v libwebp -preset drawing -quality 80 -compression_level 6 \
    "source/images/brand/$name-4k.webp"
done
```

- [ ] **Step 4: 验证输出宽度、体积和完整解码**

```bash
for image in source/images/brand/{miku-field-4k,morning-mountains-4k,river-sunrise-4k}.webp; do
  ffmpeg -v error -i "$image" -f null - || exit 1
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$image"
  stat -c '%n %s bytes' "$image"
done
```

Expected: 三张宽度均为 3840；目标单张不超过 1.2 MB。超限处理规则与 Task 2 相同。

- [ ] **Step 5: 暂存首页 4K 图片，尚不提交**

```bash
git add source/images/brand/miku-field-4k.webp \
  source/images/brand/morning-mountains-4k.webp \
  source/images/brand/river-sunrise-4k.webp
```

### Task 4: 更新来源清单并让资源契约进入构建检查

**Files:**

- Modify: `source/images/brand/sources.json:1-43`
- Modify: `test/verify-site.mjs:7-59`

- [ ] **Step 1: 将所有背景槽位改为统一元数据结构**

用下列完整内容替换 `sources.json`：

```json
[
  {
    "slot": "hero-1",
    "file": "miku-field.webp",
    "file4k": "miku-field-4k.webp",
    "sourcePage": "https://www.goodfon.com/anime/wallpaper-badfon-art-yuuko-san-devushka-hatsune.html",
    "originalDimensions": { "width": 1920, "height": 1080 },
    "processing": "标准版沿用现有 WebP；4K 版由 Real-ESRGAN 动漫模型 2 倍超分后编码为 WebP"
  },
  {
    "slot": "hero-2",
    "file": "morning-mountains.webp",
    "file4k": "morning-mountains-4k.webp",
    "sourcePage": "https://wall.alphacoders.com/big.php?i=862038",
    "originalDimensions": { "width": 1920, "height": 1080 },
    "processing": "标准版沿用现有 WebP；4K 版由 Real-ESRGAN 动漫模型 2 倍超分后编码为 WebP"
  },
  {
    "slot": "hero-3",
    "file": "river-sunrise.webp",
    "file4k": "river-sunrise-4k.webp",
    "sourcePage": "https://wall.alphacoders.com/big.php?i=1056636",
    "originalDimensions": { "width": 1920, "height": 1152 },
    "processing": "标准版沿用现有 WebP；4K 版由 Real-ESRGAN 动漫模型 2 倍超分后编码为 WebP"
  },
  {
    "slot": "cover-welcome",
    "file": "firefly-side.webp",
    "sourcePage": "https://firefly.cuteleaf.cn/"
  },
  {
    "slot": "cover-tech",
    "file": "tech-lab.webp",
    "sourcePage": "https://konachan.net/post/show/340800"
  },
  {
    "slot": "cover-life",
    "file": "book-spring.webp",
    "sourcePage": "https://art.alphacoders.com/arts/view/122414"
  },
  {
    "slot": "avatar",
    "file": "castorice-avatar.webp",
    "sourcePage": "https://wall.alphacoders.com/big.php?i=1395160"
  },
  {
    "slot": "inner-categories",
    "file": "category-library-glow.webp",
    "file4k": "category-library-glow-4k.webp",
    "author": "Tadokiari",
    "sourcePage": "https://wall.alphacoders.com/big.php?i=1317278",
    "originalDimensions": { "width": 8736, "height": 4896 },
    "processing": "标准版与 4K 版均从原始 PNG 直接缩放并编码为 WebP"
  },
  {
    "slot": "inner-tags",
    "file": "tag-cloud-city.webp",
    "file4k": "tag-cloud-city-4k.webp",
    "sourcePage": "https://safebooru.org/index.php?page=post&s=view&id=7085343",
    "originalDimensions": { "width": 4000, "height": 1857 },
    "processing": "标准版与 4K 版均从 4000 像素原图直接编码为 WebP"
  },
  {
    "slot": "inner-archives",
    "file": "archive-star-bay.webp",
    "file4k": "archive-star-bay-4k.webp",
    "sourcePage": "https://safebooru.org/index.php?page=post&s=view&id=7009209",
    "originalDimensions": { "width": 4000, "height": 2500 },
    "processing": "标准版与 4K 版均从 4000 像素原图直接编码为 WebP"
  },
  {
    "slot": "inner-post",
    "file": "article-digital-library.webp",
    "file4k": "article-digital-library-4k.webp",
    "sourcePage": "https://safebooru.org/index.php?page=post&s=view&id=6716883",
    "originalDimensions": { "width": 7200, "height": 4050 },
    "processing": "标准版与 4K 版均从 7200 像素原图直接缩放并编码为 WebP"
  },
  {
    "slot": "inner-about",
    "file": "about-sky-terminal.webp",
    "file4k": "about-sky-terminal-4k.webp",
    "sourcePage": "https://safebooru.org/index.php?page=post&s=view&id=6507788",
    "originalDimensions": { "width": 5910, "height": 2944 },
    "processing": "标准版与 4K 版均从原始 PNG 直接缩放并编码为 WebP"
  }
]
```

若 Task 2 或 Task 3 产生经质量闸门批准的超限文件，只在对应对象增加形如 `"sizeException": "miku-field-4k.webp 为 1324088 bytes；继续压缩会破坏头发细线"` 的真实记录，不写估算值。

- [ ] **Step 2: 扩展构建检查的图片清单**

将 `expectedImages` 改为：

```js
const expectedImages = [
  'miku-field.webp',
  'miku-field-4k.webp',
  'morning-mountains.webp',
  'morning-mountains-4k.webp',
  'river-sunrise.webp',
  'river-sunrise-4k.webp',
  'firefly-side.webp',
  'tech-lab.webp',
  'book-spring.webp',
  'category-library-glow.webp',
  'category-library-glow-4k.webp',
  'tag-cloud-city.webp',
  'tag-cloud-city-4k.webp',
  'archive-star-bay.webp',
  'archive-star-bay-4k.webp',
  'article-digital-library.webp',
  'article-digital-library-4k.webp',
  'about-sky-terminal.webp',
  'about-sky-terminal-4k.webp',
  'castorice-avatar.webp',
];
```

- [ ] **Step 3: 用统一断言替换仅检查分类来源的代码**

```js
const backgroundSources = new Map([
  ['hero-1', ['miku-field.webp', 'miku-field-4k.webp', 1920, 1080]],
  ['hero-2', ['morning-mountains.webp', 'morning-mountains-4k.webp', 1920, 1080]],
  ['hero-3', ['river-sunrise.webp', 'river-sunrise-4k.webp', 1920, 1152]],
  ['inner-categories', ['category-library-glow.webp', 'category-library-glow-4k.webp', 8736, 4896]],
  ['inner-tags', ['tag-cloud-city.webp', 'tag-cloud-city-4k.webp', 4000, 1857]],
  ['inner-archives', ['archive-star-bay.webp', 'archive-star-bay-4k.webp', 4000, 2500]],
  ['inner-post', ['article-digital-library.webp', 'article-digital-library-4k.webp', 7200, 4050]],
  ['inner-about', ['about-sky-terminal.webp', 'about-sky-terminal-4k.webp', 5910, 2944]],
]);

for (const [slot, [file, file4k, width, height]] of backgroundSources) {
  const source = brandSources.find((candidate) => candidate.slot === slot);
  if (
    source?.file !== file
    || source?.file4k !== file4k
    || source?.originalDimensions?.width !== width
    || source?.originalDimensions?.height !== height
    || !source?.sourcePage
    || !source?.processing
  ) {
    failures.push(`${slot} 缺少完整双分辨率来源记录`);
  }
}
```

- [ ] **Step 4: 单独运行资源构建检查，再确认场景单测仍处于红灯**

```bash
npm run clean
npm run build
node test/verify-site.mjs
npm run test:unit
```

Expected: 前三个命令通过，证明资源和来源记录完整；最后一个命令仍因 `anime-page-scenes.js` 尚未实现新接口而失败。

- [ ] **Step 5: 提交资源与来源记录**

```bash
git add source/images/brand/sources.json test/verify-site.mjs source/images/brand/*.webp
git commit -m "资源：添加全站双分辨率背景图片"
```

不要暂存 Task 1 的 `test/anime-page-scenes.test.cjs`，保证这个资源提交在单独检出时仍通过当时已提交的旧单元测试。

### Task 5: 实现内页固定场景和分辨率选择纯函数

**Files:**

- Modify: `source/js/anime-page-scenes.js:6-69`
- Test: `test/anime-page-scenes.test.cjs`

- [ ] **Step 1: 用双分辨率固定场景替换 `fixedScenes`**

```js
const fixedScenes = [
  {
    pattern: /^\/categories(?:\/|$)/,
    type: 'categories',
    image: '/images/brand/category-library-glow.webp',
    image4k: '/images/brand/category-library-glow-4k.webp',
    desktopPosition: '54% center',
    mobilePosition: '57% center'
  },
  {
    pattern: /^\/tags(?:\/|$)/,
    type: 'tags',
    image: '/images/brand/tag-cloud-city.webp',
    image4k: '/images/brand/tag-cloud-city-4k.webp',
    desktopPosition: '50% center',
    mobilePosition: '50% center'
  },
  {
    pattern: /^\/archives(?:\/|$)/,
    type: 'archives',
    image: '/images/brand/archive-star-bay.webp',
    image4k: '/images/brand/archive-star-bay-4k.webp',
    desktopPosition: '50% center',
    mobilePosition: '50% center'
  },
  {
    pattern: /^\/about(?:\/|$)/,
    type: 'about',
    image: '/images/brand/about-sky-terminal.webp',
    image4k: '/images/brand/about-sky-terminal-4k.webp',
    desktopPosition: '50% center',
    mobilePosition: '44% center'
  }
];
```

- [ ] **Step 2: 删除 `localImagePath` 并把文章分支改成固定数字文库**

```js
if (/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/.test(path)) {
  return {
    type: 'post',
    image: '/images/brand/article-digital-library.webp',
    image4k: '/images/brand/article-digital-library-4k.webp',
    desktopPosition: '62% center',
    mobilePosition: '62% center'
  };
}
```

保留 `resolvePageScene(pathname, openGraphImage, origin)` 的调用兼容性没有必要；函数签名改为 `resolvePageScene(pathname)`，JavaScript 调用方多传参数不会影响行为。

- [ ] **Step 3: 在 `resolvePageScene` 后加入纯函数并统一导出**

```js
function shouldUseHighResolution(viewportWidth, devicePixelRatio) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const pixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
  return width >= 2560 || (width >= 1200 && width * pixelRatio >= 2560);
}

function selectSceneImage(scene, viewportWidth, devicePixelRatio) {
  if (shouldUseHighResolution(viewportWidth, devicePixelRatio) && scene.image4k) {
    return scene.image4k;
  }
  return scene.image;
}

return { resolvePageScene, selectSceneImage, shouldUseHighResolution };
```

- [ ] **Step 4: 运行单元测试**

Run: `npm run test:unit`

Expected: PASS，所有映射、文章固定背景和阈值边界通过。

- [ ] **Step 5: 提交场景映射实现**

```bash
git add source/js/anime-page-scenes.js test/anime-page-scenes.test.cjs
git commit -m "功能：实现内页背景分辨率选择"
```

### Task 6: 接入首页 `srcset` 与内页防抖切档

**Files:**

- Modify: `source/js/anime-theme.js:2-120`
- Create: `test/anime-theme.test.cjs`
- Modify: `test/verify-site.mjs:61-105`

- [ ] **Step 1: 新增首页响应式加载的失败测试**

创建 `test/anime-theme.test.cjs`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const script = readFileSync(
  path.join(__dirname, '../source/js/anime-theme.js'),
  'utf8',
);

test('首页三个场景都声明标准与 4K 候选', () => {
  const pairs = [
    ['miku-field.webp', 'miku-field-4k.webp'],
    ['morning-mountains.webp', 'morning-mountains-4k.webp'],
    ['river-sunrise.webp', 'river-sunrise-4k.webp'],
  ];

  for (const [standard, high] of pairs) {
    assert.match(script, new RegExp(`src: '/images/brand/${standard}'[\\s\\S]+?src4k: '/images/brand/${high}'`));
  }
});

test('首页使用 srcset，内页按像素密度切档并防抖 resize', () => {
  assert.match(script, /image\.srcset = `\$\{slide\.src\} 1920w, \$\{slide\.src4k\} 3840w`/);
  assert.match(script, /image\.sizes = '100vw'/);
  assert.match(script, /selectImage\(scene, window\.innerWidth, window\.devicePixelRatio\)/);
  assert.match(script, /setTimeout\(updateImage, 150\)/);
});
```

Run: `npm run test:unit`

Expected: 新文件中的两个测试 FAIL，原因是 `src4k`、`srcset` 和内页切档尚未接入；Task 5 的页面映射测试保持通过。

- [ ] **Step 2: 为首页三个场景增加 4K 地址**

在每个 `src` 后分别增加：

```js
src4k: '/images/brand/miku-field-4k.webp',
```

```js
src4k: '/images/brand/morning-mountains-4k.webp',
```

```js
src4k: '/images/brand/river-sunrise-4k.webp',
```

- [ ] **Step 3: 用标准图优先、按档位更新的实现替换 `applyInnerPageScene`**

在函数前增加状态：

```js
let innerSceneResizeHandler;
let innerSceneResizeTimer;
```

然后完整替换函数：

```js
function applyInnerPageScene() {
  const root = document.documentElement;
  delete root.dataset.animePage;
  root.style.removeProperty('--anime-page-image');
  root.style.removeProperty('--anime-page-position-desktop');
  root.style.removeProperty('--anime-page-position-mobile');

  if (innerSceneResizeHandler) {
    window.removeEventListener('resize', innerSceneResizeHandler);
    innerSceneResizeHandler = undefined;
  }
  clearTimeout(innerSceneResizeTimer);

  const resolver = globalThis.AnimePageScenes?.resolvePageScene;
  const selectImage = globalThis.AnimePageScenes?.selectSceneImage;
  if (!resolver || !selectImage) return;

  const scene = resolver(location.pathname);
  if (!scene) return;

  root.dataset.animePage = scene.type;
  root.style.setProperty('--anime-page-image', `url("${scene.image}")`);
  root.style.setProperty('--anime-page-position-desktop', scene.desktopPosition);
  root.style.setProperty('--anime-page-position-mobile', scene.mobilePosition);

  let currentImage = scene.image;
  const updateImage = () => {
    const nextImage = selectImage(scene, window.innerWidth, window.devicePixelRatio);
    if (nextImage === currentImage) return;
    currentImage = nextImage;
    root.style.setProperty('--anime-page-image', `url("${nextImage}")`);
  };

  updateImage();
  innerSceneResizeHandler = () => {
    clearTimeout(innerSceneResizeTimer);
    innerSceneResizeTimer = setTimeout(updateImage, 150);
  };
  window.addEventListener('resize', innerSceneResizeHandler, { passive: true });
}
```

- [ ] **Step 4: 在 `setSlide` 中设置首页响应式候选**

用下列块替换当前 `images.forEach`：

```js
images.forEach((image) => {
  image.srcset = `${slide.src} 1920w, ${slide.src4k} 3840w`;
  image.sizes = '100vw';
  image.src = slide.src;
  image.alt = slide.alt;
});
```

场景切换器缩略图继续只用标准 `src`，不为 58px/46px 缩略图下载 4K。

- [ ] **Step 5: 在构建检查中锁定响应式脚本、透明度和本地图片**

在读取构建产物处增加：

```js
const animeScript = await read('public/js/anime-theme.js');
```

在现有 CSS 断言后增加：

```js
expect(animeScript, /\.srcset\s*=.*1920w.*3840w/s, '首页脚本未设置标准与 4K 候选');
expect(animeScript, /window\.innerWidth, window\.devicePixelRatio/, '内页脚本未按视口和像素密度选图');
expect(animeCss, /rgba\(247, 250, 249, \.74\).*rgba\(247, 250, 249, \.91\)/s, '浅色内页遮罩透明度发生变化');
expect(animeCss, /background: rgba\(247, 250, 249, \.82\)/, '浅色导航透明度发生变化');
expect(animeCss, /background: rgba\(250, 252, 251, \.9\)/, '浅色内容卡片透明度发生变化');
expect(animeCss, /rgba\(13, 22, 28, \.72\).*rgba\(13, 22, 28, \.91\)/s, '暗色内页遮罩透明度发生变化');
expect(animeCss, /background: rgba\(17, 26, 33, \.84\)/, '暗色导航透明度发生变化');
expect(animeCss, /background: rgba\(21, 31, 39, \.9\)/, '暗色内容卡片透明度发生变化');
```

并对已读取的六个 HTML 页面增加运行时外链图片检查：

```js
for (const [name, content] of [
  ['首页', home],
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['文章页', post],
]) {
  if (/<img[^>]+src=["']https?:\/\//i.test(content)) {
    failures.push(`${name}仍包含运行时外链图片`);
  }
}
```

- [ ] **Step 6: 先执行单元测试，再执行完整自动化检查**

```bash
npm run test:unit
npm run clean
npm test
```

Expected: PASS，输出 `PASS: 站点资源、路由、RSS、字数统计与 MathJax 构建检查通过`。

- [ ] **Step 7: 提交运行时接入**

```bash
git add source/js/anime-theme.js test/anime-theme.test.cjs test/verify-site.mjs
git commit -m "功能：按屏幕加载双分辨率背景"
```

### Task 7: 用真实浏览器验证请求档位、裁切和回归

**Files:**

- Verify: `public/`
- Temporary artifacts: `output/playwright/background-upgrade/`

- [ ] **Step 1: 确认 Playwright 前置条件并启动本地站点**

```bash
command -v npx >/dev/null 2>&1
npm run clean
npm test
npm run server
```

保留 Hexo server 会话运行；确认日志显示 `http://localhost:4000/` 且无端口冲突。若 4000 被占用，先用 `curl http://localhost:4000/` 判断是否为当前站点；否则用 `npx hexo server -p 4001` 并在后续 URL 统一改为 4001。

- [ ] **Step 2: 在 `output/playwright/background-upgrade/` 创建四个临时 CLI 配置**

先运行 `mkdir -p output/playwright/background-upgrade`，再使用 `apply_patch` 创建以下四个文件。

`desktop-1x.json`：

```json
{
  "browser": {
    "contextOptions": {
      "viewport": { "width": 1440, "height": 1000 },
      "deviceScaleFactor": 1
    }
  }
}
```

`desktop-2x.json`：

```json
{
  "browser": {
    "contextOptions": {
      "viewport": { "width": 1440, "height": 1000 },
      "deviceScaleFactor": 2,
      "colorScheme": "dark"
    }
  }
}
```

`mobile-3x.json`：

```json
{
  "browser": {
    "contextOptions": {
      "viewport": { "width": 390, "height": 844 },
      "deviceScaleFactor": 3,
      "reducedMotion": "reduce"
    }
  }
}
```

`desktop-4k.json`：

```json
{
  "browser": {
    "contextOptions": {
      "viewport": { "width": 3840, "height": 2160 },
      "deviceScaleFactor": 1
    }
  }
}
```

预期档位：`desktop-1x` 与 `mobile-3x` 使用标准版；`desktop-2x` 与 `desktop-4k` 使用 4K 版。`desktop-2x` 同时覆盖暗色系统偏好，`mobile-3x` 同时覆盖低动态偏好。

- [ ] **Step 3: 对四种配置分别打开页面并记录实际资源**

使用 `/home/gaoyuan/.agents/skills/playwright/scripts/playwright_cli.sh`，每个配置使用独立 session。示例：

```bash
BG_PWCLI=/home/gaoyuan/.agents/skills/playwright/scripts/playwright_cli.sh
"$BG_PWCLI" --config output/playwright/background-upgrade/mobile-3x.json --session bg-mobile open http://localhost:4000/categories/
"$BG_PWCLI" --session bg-mobile snapshot
"$BG_PWCLI" --session bg-mobile eval "getComputedStyle(document.documentElement).getPropertyValue('--anime-page-image')"
"$BG_PWCLI" --session bg-mobile network
"$BG_PWCLI" --session bg-mobile screenshot
```

对 `/`、`/categories/`、`/tags/`、`/archives/`、`/about/`、`/2026/08/15/welcome/` 重复检查。首页用下列命令读取实际候选：

```bash
"$BG_PWCLI" --session bg-mobile eval "document.querySelector('.home-banner-background img').currentSrc"
```

Expected: 1440@1x 和 390@3x 只请求标准背景；1440@2x 与 3840@1x 请求 `-4k.webp`；每页只出现其指定场景，不请求图片源站。

在 `desktop-1x` 的分类页再验证一次跨档 resize：

```bash
"$BG_PWCLI" --session bg-desktop1 resize 2600 1000
"$BG_PWCLI" --session bg-desktop1 run-code "await page.waitForTimeout(200)"
"$BG_PWCLI" --session bg-desktop1 eval "getComputedStyle(document.documentElement).getPropertyValue('--anime-page-image')"
"$BG_PWCLI" --session bg-desktop1 resize 1440 1000
"$BG_PWCLI" --session bg-desktop1 run-code "await page.waitForTimeout(200)"
"$BG_PWCLI" --session bg-desktop1 eval "getComputedStyle(document.documentElement).getPropertyValue('--anime-page-image')"
```

Expected: 第一次为 `category-library-glow-4k.webp`，第二次恢复 `category-library-glow.webp`；同一档位内连续 resize 不再替换 CSS 变量。

- [ ] **Step 4: 检查图片解码、溢出、主题模式和低动态偏好**

每个 session 至少执行：

```bash
"$BG_PWCLI" --session bg-mobile eval "Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0)"
"$BG_PWCLI" --session bg-mobile eval "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
"$BG_PWCLI" --session bg-mobile console warning
```

Expected: 两个表达式均为 `true`，控制台没有资源 404、脚本异常或布局警告。切换站点明暗模式后重新截图，确认现有遮罩透明度观感一致；低动态配置中首页显现和切换过渡被关闭；390 x 844 下移动导航可打开且不遮住标题。

- [ ] **Step 5: 逐页目视确认焦点**

检查标准：分类页保留暖金人物与图书馆光源；标签页保留瀑布和中央城堡；归档页保留星湾与主要灯火；文章页保留数字文库人物面部；关于页保留晴空终端主角面部。标题、导航、卡片无重叠，页面无横向滚动，首页底部仍露出下一段内容。

如果只需微调焦点，仅修改 `anime-page-scenes.js` 的 `desktopPosition`/`mobilePosition`，补充对应单测断言后重新执行 Task 5 Step 4 与本任务全部截图；不得借机修改 CSS 透明度。

- [ ] **Step 6: 关闭浏览器与服务器并清理临时截图配置**

```bash
"$BG_PWCLI" --session bg-mobile close
"$BG_PWCLI" --session bg-desktop1 close
"$BG_PWCLI" --session bg-desktop2 close
"$BG_PWCLI" --session bg-4k close
rm -rf output/playwright/background-upgrade
```

在 Hexo server 的终端发送 `Ctrl-C`，确认进程退出。只删除上述明确的临时产物目录，不删除 `output/playwright/` 的其他内容。

### Task 8: 最终审查并形成可推送提交

**Files:**

- Verify: all changed files

- [ ] **Step 1: 检查没有越界改动与未跟踪临时文件**

```bash
git status --short
git diff --check
git diff 808ecd0 --stat
git diff 808ecd0 -- source/css/anime-theme.css _config.redefine.yml package.json package-lock.json .github/workflows/pages.yml
```

Expected: 最后一条命令无输出；`git diff --check` 无空白错误；没有 `public/`、下载原图、模型或 Playwright 临时文件进入提交。

- [ ] **Step 2: 重新执行从干净构建开始的最终验证**

```bash
npm ci
npm run clean
npm test
```

Expected: 所有命令退出码 0；Hexo 生成首页、分类、标签、归档、关于、文章、搜索与 `atom.xml`；MathJax、字数和阅读时间检查继续通过。

- [ ] **Step 3: 核对提交历史均为中文且工作区干净**

```bash
git log 808ecd0..HEAD --format='%h %s'
git status --short
```

Expected: 本计划产生的提交标题均为中文；`git status --short` 无输出。若视觉焦点微调产生未提交更改，使用：

```bash
git add source/js/anime-page-scenes.js test/anime-page-scenes.test.cjs
git commit -m "样式：微调内页背景视觉焦点"
```

- [ ] **Step 4: 推送前输出最终资源审计**

```bash
for image in source/images/brand/*-4k.webp; do
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$image"
  stat -c '%n %s bytes' "$image"
done
```

Expected: 本计划新增的 4K 背景宽度均为 3840、完整可读，超限项与 `sources.json` 的实际例外记录一致。此时分支达到可提交、可推送状态；只有在用户明确要求推送时才执行 `git push origin main`。
