const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

// scripts/hero-preload.js 在模块加载时就注册 Hexo 过滤器，测试里给它一个最小桩。
// node --test 每个测试文件跑在独立进程里，不会影响别的测试。
global.hexo = { extend: { filter: { register() {} } } };

const { heroPreloadSnippet, injectHeroPreload } = require('../scripts/hero-preload.js');
const { slides, resolveTimePeriod, selectHomeSceneImage } = require('../source/js/anime-home-scenes.js');
const { readWebpDimensions } = require('./helpers/webp-dimensions.cjs');

const brandDirectory = path.join(__dirname, '../source/images/brand');

function readPreloadScript() {
  const match = heroPreloadSnippet.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'scripts/hero-preload.js 里找不到内联脚本');
  return match[1];
}

// 在最小 DOM 桩里执行内联的预加载脚本，收集它插入的 <link>。
// 脚本可能被重复执行（例如站内跳转后重跑），所以这里支持调用多次。
function createPreloadRuntime(hour, innerWidth, devicePixelRatio) {
  const links = [];
  class FixedDate {
    getHours() {
      return hour;
    }
  }
  const context = vm.createContext({
    Date: FixedDate,
    document: {
      createElement() {
        return {
          setAttribute(name, value) {
            this[name] = value;
          },
        };
      },
      head: {
        appendChild(link) {
          links.push(link);
        },
      },
      querySelector(selector) {
        const period = /data-anime-hero-preload="([^"]+)"/.exec(selector)?.[1];
        return links.find((link) => link['data-anime-hero-preload'] === period) ?? null;
      },
    },
    window: { innerWidth, devicePixelRatio },
  });

  return {
    links,
    run: () => vm.runInContext(readPreloadScript(), context),
  };
}

function runPreloadScript(hour, innerWidth, devicePixelRatio) {
  const runtime = createPreloadRuntime(hour, innerWidth, devicePixelRatio);
  runtime.run();

  assert.equal(runtime.links.length, 2, '预加载脚本应同时声明移动档与桌面档');
  for (const link of runtime.links) {
    assert.equal(link.rel, 'preload');
    assert.equal(link.as, 'image');
    assert.equal(link.fetchPriority, 'high');
  }
  return runtime.links;
}

function matchesMedia(media, viewportWidth) {
  const max = /max-width:\s*(\d+)px/.exec(media);
  if (max) return viewportWidth <= Number(max[1]);
  const min = /min-width:\s*(\d+)px/.exec(media);
  if (min) return viewportWidth >= Number(min[1]);
  return true;
}

function pickLink(links, viewportWidth) {
  const matched = links.filter((link) => matchesMedia(link.media, viewportWidth));
  assert.equal(matched.length, 1, `视口 ${viewportWidth}px 应只命中一个预加载声明`);
  return matched[0];
}

function parseSrcset(srcset) {
  return srcset.split(',').map((entry) => {
    const [url, descriptor] = entry.trim().split(/\s+/);
    assert.match(descriptor, /^\d+w$/, `srcset 缺少 w 描述符：${entry}`);
    return { url, width: Number(descriptor.slice(0, -1)) };
  });
}

// 复刻浏览器的 srcset 选档：取“刚好覆盖设备像素”的最小候选，都不够时取最大的。
function chooseFromSrcset(srcset, viewportWidth, devicePixelRatio) {
  const candidates = parseSrcset(srcset).sort((left, right) => left.width - right.width);
  const covering = candidates.find((candidate) => candidate.width >= viewportWidth * devicePixelRatio);
  return (covering || candidates[candidates.length - 1]).url;
}

test('预加载脚本只注入到带首页横幅的页面', () => {
  const home = '<html><head><title>首页</title></head><body><div class="home-banner-container"></div></body></html>';
  const inner = '<html><head><title>关于</title></head><body><div class="page-template-container"></div></body></html>';

  const injected = injectHeroPreload(home);
  assert.match(injected, /data-anime-hero-preload/);
  assert.ok(injected.indexOf(heroPreloadSnippet) < injected.indexOf('</head>'), '脚本必须注入在 </head> 之前');
  assert.equal(injectHeroPreload(inner), inner, '内页没有横幅，不应注入预加载脚本');
  assert.equal(injectHeroPreload(injected), injected, '重复注入应保持幂等');
});

test('预加载脚本的时段划分与 resolveTimePeriod 一致', () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const expected = slides.find((slide) => slide.period === resolveTimePeriod(new Date(2026, 7, 26, hour)));
    const desktop = pickLink(runPreloadScript(hour, 1440, 1), 1440);

    assert.equal(desktop.imagesrcset, `${expected.src} 2560w, ${expected.src4k} 3840w`, `${hour} 点选错了时段`);
    assert.equal(desktop.imagesizes, '100vw');
  }
});

test('窄屏只声明移动档，宽屏只声明桌面档', () => {
  const mobileLinks = runPreloadScript(9, 390, 3);
  const mobile = pickLink(mobileLinks, 390);
  assert.equal(mobile.href, slides.find((slide) => slide.period === 'morning').srcMobile);
  assert.equal(mobile.imagesrcset, undefined, '移动档不应同时声明 srcset');

  const desktop = pickLink(mobileLinks, 1440);
  assert.equal(desktop.href, undefined, '桌面档不应同时声明固定 href');
});

test('预加载选出的图片与 selectHomeSceneImage 完全相同', () => {
  for (const hour of [6, 12, 18, 22]) {
    const slide = slides.find((candidate) => candidate.period === resolveTimePeriod(new Date(2026, 7, 26, hour)));
    for (const viewportWidth of [390, 767, 768, 1024, 1280, 1440, 1920, 2560, 3840]) {
      for (const devicePixelRatio of [1, 1.25, 2, 3]) {
        const link = pickLink(runPreloadScript(hour, viewportWidth, devicePixelRatio), viewportWidth);
        const preloaded = link.href ?? chooseFromSrcset(link.imagesrcset, viewportWidth, devicePixelRatio);
        const runtime = selectHomeSceneImage(slide, viewportWidth, devicePixelRatio);

        assert.equal(
          preloaded,
          runtime,
          `${hour} 点 / ${viewportWidth}px / DPR ${devicePixelRatio}：预加载 ${preloaded}，运行时 ${runtime}`,
        );
      }
    }
  }
});

test('srcset 的 w 描述符与图片真实宽度一致', () => {
  const link = pickLink(runPreloadScript(12, 1440, 1), 1440);
  const candidates = parseSrcset(link.imagesrcset);

  for (const candidate of candidates) {
    const relativePath = candidate.url.replace('/images/brand/', '');
    assert.equal(
      readWebpDimensions(path.join(brandDirectory, relativePath)).width,
      candidate.width,
      `${relativePath} 的 w 描述符与实际宽度不符`,
    );
  }
  assert.deepEqual(candidates.map((candidate) => candidate.width), [2560, 3840]);
});

test('重复执行脚本时不会叠加重复的预加载声明', () => {
  const runtime = createPreloadRuntime(9, 1440, 1);
  runtime.run();
  runtime.run();
  runtime.run();

  assert.equal(runtime.links.length, 2, '重复执行应被 data-anime-hero-preload 标记挡住');
});
