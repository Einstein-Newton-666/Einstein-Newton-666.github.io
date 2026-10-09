(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimePageScenes = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const fixedScenes = [
    {
      pattern: /^\/categories(?:\/|$)/,
      type: 'categories',
      imageMobile: '/images/brand/category-library-glow-mobile.webp',
      image: '/images/brand/category-library-glow.webp',
      image4k: '/images/brand/category-library-glow-4k.webp',
      desktopPosition: '54% center',
      mobilePosition: '57% center'
    },
    {
      pattern: /^\/logs(?:\/|$)/,
      type: 'categories',
      imageMobile: '/images/brand/log-gothic-library-mobile.webp',
      image: '/images/brand/log-gothic-library.webp',
      image4k: '/images/brand/log-gothic-library-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '52% center'
    },
    {
      pattern: /^\/tags(?:\/|$)/,
      type: 'tags',
      imageMobile: '/images/brand/tag-cloud-city-mobile.webp',
      image: '/images/brand/tag-cloud-city.webp',
      image4k: '/images/brand/tag-cloud-city-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    },
    {
      pattern: /^\/archives(?:\/|$)/,
      type: 'archives',
      imageMobile: '/images/brand/article-digital-library-mobile.webp',
      image: '/images/brand/article-digital-library.webp',
      image4k: '/images/brand/article-digital-library-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '60% center'
    },
    {
      pattern: /^\/about(?:\/|$)/,
      type: 'about',
      imageMobile: '/images/brand/about-sky-terminal-mobile.webp',
      image: '/images/brand/about-sky-terminal.webp',
      image4k: '/images/brand/about-sky-terminal-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '44% center'
    },
    {
      // 404 页先前没有场景，是唯一一张纯白页面，和其余内页完全不像同一个站。
      pattern: /^\/404\.html$/,
      type: 'notfound',
      imageMobile: '/images/brand/notfound-quiet-window-mobile.webp',
      image: '/images/brand/notfound-quiet-window.webp',
      image4k: '/images/brand/notfound-quiet-window-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '50% center'
    }
  ];

  function resolvePageScene(pathname) {
    const path = `/${String(pathname || '').replace(/^\/+|\/+$/g, '')}`;
    const fixed = fixedScenes.find((scene) => scene.pattern.test(path));

    if (fixed) {
      const { pattern, ...scene } = fixed;
      return scene;
    }

    if (/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/.test(path)) {
      return {
        type: 'post',
        imageMobile: '/images/brand/article-digital-library-mobile.webp',
        image: '/images/brand/article-digital-library.webp',
        image4k: '/images/brand/article-digital-library-4k.webp',
        desktopPosition: '62% center',
        mobilePosition: '62% center'
      };
    }

    return null;
  }

  // 内页只有“标准档(1920 或 2560) / 4K(3840)”两档，跨度很大：标准档放到 2560 物理像素时
  // 最多放大 1.33 倍，仍在可接受范围，所以沿用 >= 2560 才换 4K，避免为了 1920→3840 的 2 倍
  // 过采样多下几百 KB（例如 tag-cloud-city 444KB → 1805KB）。
  // 首页档位是 1280/2560/3840、标准档正好 2560，那边用的是另一套边界（见 anime-home-scenes.js），
  // 两者的档位结构不同，不要合并成同一个判断。
  function shouldUseHighResolution(viewportWidth, devicePixelRatio) {
    const width = Math.max(0, Number(viewportWidth) || 0);
    const pixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
    return width >= 2560 || (width >= 1200 && width * pixelRatio >= 2560);
  }

  // 窄屏（< 768，与首页 selectHomeSceneImage 同一条边界）用 810×1440 的竖版移动档：
  // 它按该场景的 mobilePosition 从 4K 档裁出，手机本来就只露出这一段，
  // 却不必再下整张横版标准档（例如 tag-cloud-city 443KB → 291KB）。
  function selectSceneImage(scene, viewportWidth, devicePixelRatio) {
    const width = Math.max(0, Number(viewportWidth) || 0);
    if (width < 768 && scene.imageMobile) return scene.imageMobile;
    if (shouldUseHighResolution(viewportWidth, devicePixelRatio) && scene.image4k) {
      return scene.image4k;
    }
    return scene.image;
  }

  return { resolvePageScene, selectSceneImage, shouldUseHighResolution };
}));
