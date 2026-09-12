const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { selectHomeSceneImage } = require('../source/js/anime-home-scenes.js');
const { readWebpDimensions } = require('./helpers/webp-dimensions.cjs');
const {
  resolvePageScene,
  selectSceneImage,
  shouldUseHighResolution,
} = require('../source/js/anime-page-scenes.js');

const brandDirectory = path.join(__dirname, '../source/images/brand');

test('为内页分配固定双分辨率场景', () => {
  const cases = [
    ['/categories/', 'categories', 'category-library-glow'],
    ['/categories/笔记/', 'categories', 'category-library-glow'],
    ['/logs/', 'categories', 'log-gothic-library'],
    ['/tags/', 'tags', 'tag-cloud-city'],
    ['/tags/Hexo/', 'tags', 'tag-cloud-city'],
    ['/archives/', 'archives', 'article-digital-library'],
    ['/about/', 'about', 'about-sky-terminal'],
    ['/2026/08/15/welcome/', 'post', 'article-digital-library'],
  ];

  const topLevelScenes = new Map();
  for (const [pathname, type, basename] of cases) {
    const scene = resolvePageScene(pathname);
    assert.equal(scene.type, type);
    assert.equal(scene.image, `/images/brand/${basename}.webp`);
    assert.equal(scene.image4k, `/images/brand/${basename}-4k.webp`);
    if (!topLevelScenes.has(type)) topLevelScenes.set(type, scene.image);
  }

  // 归档页与文章页共用数字文库背景，其余顶层页面各自独立。
  assert.equal(new Set(topLevelScenes.values()).size, 4);
  for (const heroImage of [
    '/images/brand/hero-morning.webp',
    '/images/brand/hero-day.webp',
    '/images/brand/hero-sunset.webp',
  ]) {
    assert.equal(new Set(topLevelScenes.values()).has(heroImage), false);
  }

  const categoryScene = resolvePageScene('/categories/');
  assert.equal(categoryScene.desktopPosition, '54% center');
  assert.equal(categoryScene.mobilePosition, '57% center');

  const archiveScene = resolvePageScene('/archives/');
  assert.equal(archiveScene.desktopPosition, '50% center');
  assert.equal(archiveScene.mobilePosition, '60% center');
});

test('文章页忽略文章封面并固定使用数字文库背景', () => {
  // 封面只影响列表与 Open Graph，不参与内页背景决策：resolvePageScene 只接受 pathname。
  assert.equal(resolvePageScene.length, 1);

  const scene = resolvePageScene('/2026/08/15/welcome/');
  assert.equal(scene.image, '/images/brand/article-digital-library.webp');
  assert.equal(scene.image4k, '/images/brand/article-digital-library-4k.webp');
});

test('日志页使用独立的双分辨率哥特图书馆背景', () => {
  const logsScene = resolvePageScene('/logs/');
  const categoryScene = resolvePageScene('/categories/');

  assert.equal(logsScene.image, '/images/brand/log-gothic-library.webp');
  assert.equal(logsScene.image4k, '/images/brand/log-gothic-library-4k.webp');
  assert.notEqual(logsScene.image, categoryScene.image);
});

test('内页在宽桌面或设备像素达到 2560 时启用 4K', () => {
  assert.equal(shouldUseHighResolution(2559, 1), false);
  assert.equal(shouldUseHighResolution(1200, 2), false);
  assert.equal(shouldUseHighResolution(390, 3), false);
  assert.equal(shouldUseHighResolution(undefined, undefined), false);
  // 窄视口即使像素密度很高，也不该拿 3840 宽的图。
  assert.equal(shouldUseHighResolution(800, 4), false);
  assert.equal(shouldUseHighResolution(2560, 1), true);
  assert.equal(shouldUseHighResolution(1280, 2), true);
  assert.equal(shouldUseHighResolution(1440, 2), true);
  assert.equal(shouldUseHighResolution(3840, 1), true);
});

test('按档位返回内页图片且在缺少 4K 时回退标准图', () => {
  const scene = { image: '/standard.webp', image4k: '/high.webp' };
  assert.equal(selectSceneImage(scene, 1440, 1), '/standard.webp');
  assert.equal(selectSceneImage(scene, 1440, 2), '/high.webp');
  assert.equal(selectSceneImage({ image: '/standard.webp' }, 3840, 1), '/standard.webp');
});

test('首页与内页各按自己的档位结构选择 4K', () => {
  // 首页三档是 1280/2560/3840，标准档正好 2560 宽：物理像素正好 2560 时标准档 1:1，
  // 所以边界取 > 2560（与预加载 imagesrcset 交给浏览器的选档规则一致）。
  const homeSlide = { srcMobile: '/mobile.webp', src: '/standard.webp', src4k: '/high.webp' };
  assert.equal(selectHomeSceneImage(homeSlide, 2560, 1), homeSlide.src);
  assert.equal(selectHomeSceneImage(homeSlide, 2561, 1), homeSlide.src4k);

  // 内页只有“标准档 / 4K”两档，标准档实际是 1920（日志页 2560），跨度接近 2 倍：
  // 边界保持在 >= 2560，低于它的屏幕最多放大 1.33 倍，避免直接跳到过采样的 4K。
  const standardWidths = new Set();
  for (const pathname of ['/categories/', '/logs/', '/tags/', '/archives/', '/about/']) {
    const scene = resolvePageScene(pathname);
    standardWidths.add(readWebpDimensions(path.join(brandDirectory, path.posix.basename(scene.image))).width);
    assert.equal(
      readWebpDimensions(path.join(brandDirectory, path.posix.basename(scene.image4k))).width,
      3840,
      `${scene.image4k} 不是 3840 宽`,
    );
  }
  assert.deepEqual(
    [...standardWidths].sort((left, right) => left - right),
    [1920, 2560],
    '内页标准档宽度变了，请重新确认 4K 边界',
  );
  assert.equal(shouldUseHighResolution(1920, 1), false);
  assert.equal(shouldUseHighResolution(2560, 1), true);
});

test('首页和未知页面不启用内页场景', () => {
  assert.equal(resolvePageScene('/'), null);
  assert.equal(resolvePageScene('/atom.xml'), null);
  assert.equal(resolvePageScene('/unknown/'), null);
});
