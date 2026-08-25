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
      desktopPosition: '54% center',
      mobilePosition: '57% center'
    },
    {
      pattern: /^\/tags(?:\/|$)/,
      type: 'tags',
      image: '/images/brand/morning-mountains.webp',
      desktopPosition: '50% center',
      mobilePosition: '58% center'
    },
    {
      pattern: /^\/archives(?:\/|$)/,
      type: 'archives',
      image: '/images/brand/river-sunrise.webp',
      desktopPosition: '50% center',
      mobilePosition: '82% center'
    },
    {
      pattern: /^\/about(?:\/|$)/,
      type: 'about',
      image: '/images/brand/tech-lab.webp',
      desktopPosition: '50% center',
      mobilePosition: '72% center'
    }
  ];

  function localImagePath(value, origin) {
    if (!value) return null;

    try {
      const url = new URL(value, origin);
      return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
      return null;
    }
  }

  function resolvePageScene(pathname, openGraphImage, origin) {
    const path = `/${String(pathname || '').replace(/^\/+|\/+$/g, '')}`;
    const fixed = fixedScenes.find((scene) => scene.pattern.test(path));

    if (fixed) {
      const { pattern, ...scene } = fixed;
      return scene;
    }

    if (/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/.test(path)) {
      return {
        type: 'post',
        image: localImagePath(openGraphImage, origin) || '/images/brand/firefly-side.webp',
        desktopPosition: '50% center',
        mobilePosition: '50% center'
      };
    }

    return null;
  }

  return { resolvePageScene };
}));
