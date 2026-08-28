const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = readFileSync(
  path.join(__dirname, '../source/js/anime-theme.js'),
  'utf8',
);

test('首页从分时模块读取四个场景并按本地时间初始化', () => {
  assert.match(script, /globalThis\.AnimeHomeScenes/);
  assert.match(script, /resolveHomeSceneIndex\(new Date\(\)\)/);
  assert.match(script, /setSlide\(initialIndex\)/);
  assert.doesNotMatch(script, /miku-field|morning-mountains|river-sunrise/);
});

test('场景按钮使用缩略图且首页选择 4K 正式图', () => {
  assert.match(script, /<img src="\$\{slide\.thumb\}" alt="" loading="lazy" decoding="async">/);
  assert.match(script, /selectHomeSceneImage\(activeSlide, window\.innerWidth, window\.devicePixelRatio\)/);
  assert.match(script, /setTimeout\(updateHomeImage, 150\)/);
});

test('内页按像素密度切档并防抖 resize', () => {
  assert.match(script, /selectImage\(scene, window\.innerWidth, window\.devicePixelRatio\)/);
  assert.match(script, /setTimeout\(updateImage, 150\)/);
});

test('Swup 重载脚本时只保留一个内页 resize 监听器', () => {
  const resizeListeners = new Set();
  const style = {
    removeProperty() {},
    setProperty() {},
  };
  const context = vm.createContext({
    AnimePageScenes: {
      resolvePageScene: () => ({
        type: 'categories',
        image: '/standard.webp',
        image4k: '/high.webp',
        desktopPosition: '50% center',
        mobilePosition: '50% center',
      }),
      selectSceneImage: (scene) => scene.image,
    },
    clearTimeout,
    document: {
      documentElement: { dataset: {}, style },
      querySelector: () => null,
      readyState: 'complete',
    },
    location: { pathname: '/categories/' },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    window: {
      addEventListener(type, handler) {
        if (type === 'resize') resizeListeners.add(handler);
      },
      devicePixelRatio: 1,
      innerWidth: 1440,
      removeEventListener(type, handler) {
        if (type === 'resize') resizeListeners.delete(handler);
      },
    },
  });

  vm.runInContext(script, context);
  vm.runInContext(script, context);

  assert.equal(resizeListeners.size, 1);
});

test('离开首页时清理首页 resize 监听器', () => {
  const staleHomeHandler = () => {};
  const resizeListeners = new Set([staleHomeHandler]);
  const runtime = { homeSceneResizeHandler: staleHomeHandler };
  const context = vm.createContext({
    __einsteinAnimeThemeRuntime: runtime,
    clearTimeout,
    document: {
      documentElement: {
        dataset: {},
        style: { removeProperty() {} },
      },
      querySelector: () => null,
      readyState: 'complete',
    },
    location: { pathname: '/archives/' },
    window: {
      removeEventListener(type, handler) {
        if (type === 'resize') resizeListeners.delete(handler);
      },
    },
  });

  vm.runInContext(script, context);

  assert.equal(resizeListeners.size, 0);
  assert.equal(runtime.homeSceneResizeHandler, undefined);
});
