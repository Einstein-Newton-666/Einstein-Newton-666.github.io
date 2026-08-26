const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('首页使用 srcset，内页按像素密度切档并防抖 resize', () => {
  assert.match(script, /image\.srcset = `\$\{slide\.src\} 1920w, \$\{slide\.src4k\} 3840w`/);
  assert.match(script, /image\.sizes = '100vw'/);
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
