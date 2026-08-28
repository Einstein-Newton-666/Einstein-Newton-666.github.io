const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePageScene,
  selectSceneImage,
  shouldUseHighResolution,
} = require('../source/js/anime-page-scenes.js');

const origin = 'https://einstein-newton-666.github.io';

test('为五类内页分配互不重复的固定双分辨率场景', () => {
  const cases = [
    ['/categories/', 'categories', 'category-library-glow'],
    ['/categories/笔记/', 'categories', 'category-library-glow'],
    ['/logs/', 'categories', 'log-gothic-library'],
    ['/tags/', 'tags', 'tag-cloud-city'],
    ['/tags/Hexo/', 'tags', 'tag-cloud-city'],
    ['/archives/', 'archives', 'archive-magic-spiral-library'],
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
    '/images/brand/hero-morning.webp',
    '/images/brand/hero-day.webp',
    '/images/brand/hero-sunset.webp',
    '/images/brand/hero-night.webp',
  ]) {
    assert.equal(new Set(topLevelScenes.values()).has(heroImage), false);
  }

  const categoryScene = resolvePageScene('/categories/', '', origin);
  assert.equal(categoryScene.desktopPosition, '54% center');
  assert.equal(categoryScene.mobilePosition, '57% center');

  const archiveScene = resolvePageScene('/archives/', '', origin);
  assert.equal(archiveScene.desktopPosition, '50% center');
  assert.equal(archiveScene.mobilePosition, '60% center');
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

test('日志页使用独立的双分辨率哥特图书馆背景', () => {
  const logsScene = resolvePageScene('/logs/', '', origin);
  const categoryScene = resolvePageScene('/categories/', '', origin);

  assert.equal(logsScene.image, '/images/brand/log-gothic-library.webp');
  assert.equal(logsScene.image4k, '/images/brand/log-gothic-library-4k.webp');
  assert.notEqual(logsScene.image, categoryScene.image);
});

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

test('首页和未知页面不启用内页场景', () => {
  assert.equal(resolvePageScene('/', '', origin), null);
  assert.equal(resolvePageScene('/atom.xml', '', origin), null);
  assert.equal(resolvePageScene('/unknown/', '', origin), null);
});
