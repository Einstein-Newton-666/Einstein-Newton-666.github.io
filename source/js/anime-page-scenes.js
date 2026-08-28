(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimePageScenes = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
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
      pattern: /^\/logs(?:\/|$)/,
      type: 'categories',
      image: '/images/brand/log-gothic-library.webp',
      image4k: '/images/brand/log-gothic-library-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '52% center'
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
      image: '/images/brand/archive-magic-spiral-library.webp',
      image4k: '/images/brand/archive-magic-spiral-library-4k.webp',
      desktopPosition: '50% center',
      mobilePosition: '60% center'
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
        image: '/images/brand/article-digital-library.webp',
        image4k: '/images/brand/article-digital-library-4k.webp',
        desktopPosition: '62% center',
        mobilePosition: '62% center'
      };
    }

    return null;
  }

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
}));
