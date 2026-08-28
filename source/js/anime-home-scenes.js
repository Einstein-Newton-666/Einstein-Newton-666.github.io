(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimeHomeScenes = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const slides = [
    {
      period: 'morning',
      srcMobile: '/images/brand/hero-morning-mobile.webp',
      src: '/images/brand/hero-morning.webp',
      src4k: '/images/brand/hero-morning-4k.webp',
      thumb: '/images/brand/hero-morning-thumb.webp',
      alt: '晨光中的动画风景',
      kicker: 'MORNING LOG · 01',
      scene: '在晨光里，写下今天的第一行',
      note: '让新的问题与灵感，从清晰而安静的早晨开始。',
      desktopPosition: '50% center',
      mobilePosition: '48% center',
    },
    {
      period: 'day',
      srcMobile: '/images/brand/hero-day-mobile.webp',
      src: '/images/brand/hero-day.webp',
      src4k: '/images/brand/hero-day-4k.webp',
      thumb: '/images/brand/hero-day-thumb.webp',
      alt: '晴空下的动画风景',
      kicker: 'DAYLIGHT NOTE · 02',
      scene: '把思路铺开，让答案逐渐清晰',
      note: '在明亮的天空下，整理技术笔记与生活片段。',
      desktopPosition: '50% center',
      mobilePosition: '74% center',
    },
    {
      period: 'sunset',
      srcMobile: '/images/brand/hero-sunset-mobile.webp',
      src: '/images/brand/hero-sunset.webp',
      src4k: '/images/brand/hero-sunset-4k.webp',
      thumb: '/images/brand/hero-sunset-thumb.webp',
      alt: '晚霞中的动画风景',
      kicker: 'SUNSET JOURNAL · 03',
      scene: '在天色变深以前，收好今天的片段',
      note: '把完成的工作、未解的问题与沿途风景留在这里。',
      desktopPosition: '50% center',
      mobilePosition: '52% center',
    },
    {
      period: 'night',
      srcMobile: '/images/brand/hero-night-mobile.webp',
      src: '/images/brand/hero-night.webp',
      src4k: '/images/brand/hero-night-4k.webp',
      thumb: '/images/brand/hero-night-thumb.webp',
      alt: '星空下的动画风景',
      kicker: 'NIGHT ARCHIVE · 04',
      scene: '让安静的夜晚，收纳仍在延伸的思绪',
      note: '在星光与屏幕之间，为今天的记录留下结尾。',
      desktopPosition: '50% center',
      mobilePosition: '46% center',
    },
  ];

  function resolveTimePeriod(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const hour = date.getHours();
    if (!Number.isInteger(hour)) return 'day';
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 17) return 'day';
    if (hour >= 17 && hour < 20) return 'sunset';
    return 'night';
  }

  function resolveHomeSceneIndex(value = new Date()) {
    const period = resolveTimePeriod(value);
    const index = slides.findIndex((slide) => slide.period === period);
    return index === -1 ? 1 : index;
  }

  function selectHomeSceneImage(scene, viewportWidth, devicePixelRatio) {
    const width = Math.max(0, Number(viewportWidth) || 0);
    const pixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
    if (width >= 2560 || (width >= 1200 && width * pixelRatio >= 2560)) return scene.src4k;
    if (width < 768) return scene.srcMobile;
    return scene.src;
  }

  return { slides, resolveTimePeriod, resolveHomeSceneIndex, selectHomeSceneImage };
}));
