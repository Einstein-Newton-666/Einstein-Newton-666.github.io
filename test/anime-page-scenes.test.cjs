const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePageScene } = require('../source/js/anime-page-scenes.js');

const origin = 'https://einstein-newton-666.github.io';

test('为索引型内页分配互不相同的固定场景', () => {
  const cases = [
    ['/categories/', 'categories', '/images/brand/category-library-glow.webp'],
    ['/categories/笔记/', 'categories', '/images/brand/category-library-glow.webp'],
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

  assert.equal(new Set(scenes).size, 4);

  const categoryScene = resolvePageScene('/categories/', '', origin);
  assert.equal(categoryScene.desktopPosition, '54% center');
  assert.equal(categoryScene.mobilePosition, '57% center');
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
