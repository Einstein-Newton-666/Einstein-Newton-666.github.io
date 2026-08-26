(function () {
  const runtime = globalThis.__einsteinAnimeThemeRuntime || {};
  globalThis.__einsteinAnimeThemeRuntime = runtime;

  const slides = [
    {
      src: '/images/brand/miku-field.webp',
      src4k: '/images/brand/miku-field-4k.webp',
      thumb: '/images/brand/miku-field-thumb.webp',
      alt: '风吹草地上的初音未来',
      kicker: 'WIND LOG · 01',
      scene: '让灵感沿着风的方向展开',
      note: '把学习、旅行与偶然遇见的风景，一起收进日常记录。',
      desktopPosition: '50% center',
      mobilePosition: '18% center'
    },
    {
      src: '/images/brand/morning-mountains.webp',
      src4k: '/images/brand/morning-mountains-4k.webp',
      thumb: '/images/brand/morning-mountains-thumb.webp',
      alt: '晨光照亮云雾山谷',
      kicker: 'MORNING NOTE · 02',
      scene: '在晨雾散开之前，写下新的开始',
      note: '用安静的风景承接技术笔记与生活片段。',
      desktopPosition: '50% center',
      mobilePosition: '58% center'
    },
    {
      src: '/images/brand/river-sunrise.webp',
      src4k: '/images/brand/river-sunrise-4k.webp',
      thumb: '/images/brand/river-sunrise-thumb.webp',
      alt: '河谷晨光中的二次元少女',
      kicker: 'VALLEY JOURNAL · 03',
      scene: '沿着河谷，把思绪带向更远的地方',
      note: '让每一次整理与记录，都留下清晰而温柔的路径。',
      desktopPosition: '50% center',
      mobilePosition: '82% center'
    }
  ];

  function applyInnerPageScene() {
    const root = document.documentElement;
    delete root.dataset.animePage;
    root.style.removeProperty('--anime-page-image');
    root.style.removeProperty('--anime-page-position-desktop');
    root.style.removeProperty('--anime-page-position-mobile');

    if (runtime.innerSceneResizeHandler) {
      window.removeEventListener('resize', runtime.innerSceneResizeHandler);
      runtime.innerSceneResizeHandler = undefined;
    }
    clearTimeout(runtime.innerSceneResizeTimer);

    const resolver = globalThis.AnimePageScenes?.resolvePageScene;
    const selectImage = globalThis.AnimePageScenes?.selectSceneImage;
    if (!resolver || !selectImage) return;

    const scene = resolver(location.pathname);
    if (!scene) return;

    root.dataset.animePage = scene.type;
    root.style.setProperty('--anime-page-image', `url("${scene.image}")`);
    root.style.setProperty('--anime-page-position-desktop', scene.desktopPosition);
    root.style.setProperty('--anime-page-position-mobile', scene.mobilePosition);

    let currentImage = scene.image;
    const updateImage = () => {
      const nextImage = selectImage(scene, window.innerWidth, window.devicePixelRatio);
      if (nextImage === currentImage) return;
      currentImage = nextImage;
      root.style.setProperty('--anime-page-image', `url("${nextImage}")`);
    };

    updateImage();
    runtime.innerSceneResizeHandler = () => {
      clearTimeout(runtime.innerSceneResizeTimer);
      runtime.innerSceneResizeTimer = setTimeout(updateImage, 150);
    };
    window.addEventListener('resize', runtime.innerSceneResizeHandler, { passive: true });
  }

  function initialiseAnimeTheme() {
    applyInnerPageScene();

    const hero = document.querySelector('.home-banner-container');
    const background = document.querySelector('.home-banner-background');
    const description = hero && hero.querySelector('.description');
    const images = background ? Array.from(background.querySelectorAll('img')) : [];

    if (!hero || !background || !description || !images.length || hero.dataset.animeThemeReady === 'true') return;
    hero.dataset.animeThemeReady = 'true';

    description.innerHTML = `
      <div class="anime-hero-copy">
        <span class="anime-hero-kicker"></span>
        <h1><span>Einstein-Newton-666</span><span> 的博客</span></h1>
        <p class="anime-hero-scene"></p>
        <p class="anime-hero-note"></p>
      </div>`;

    const switcher = document.createElement('div');
    switcher.className = 'anime-scene-switcher';
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', '切换首页场景');
    switcher.innerHTML = slides.map((slide, index) => `
      <button type="button" title="场景 ${index + 1}：${slide.scene}" aria-label="查看场景 ${index + 1}" aria-pressed="${index === 0}">
        <img src="${slide.thumb}" alt="" loading="lazy" decoding="async">
      </button>`).join('');

    const scrollCue = document.createElement('button');
    scrollCue.className = 'anime-scroll-cue';
    scrollCue.type = 'button';
    scrollCue.title = '查看最新文章';
    scrollCue.setAttribute('aria-label', '查看最新文章');
    scrollCue.innerHTML = '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i>';

    hero.append(switcher, scrollCue);

    const kicker = description.querySelector('.anime-hero-kicker');
    const scene = description.querySelector('.anime-hero-scene');
    const note = description.querySelector('.anime-hero-note');
    const buttons = Array.from(switcher.querySelectorAll('button'));

    function setSlide(index) {
      const slide = slides[index];
      images.forEach((image) => {
        image.srcset = `${slide.src} 1920w, ${slide.src4k} 3840w`;
        image.sizes = '100vw';
        image.src = slide.src;
        image.alt = slide.alt;
      });
      background.style.setProperty('--anime-hero-position-desktop', slide.desktopPosition);
      background.style.setProperty('--anime-hero-position-mobile', slide.mobilePosition);
      kicker.textContent = slide.kicker;
      scene.textContent = slide.scene;
      note.textContent = slide.note;
      buttons.forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }

    buttons.forEach((button, index) => button.addEventListener('click', () => setSlide(index)));
    scrollCue.addEventListener('click', () => {
      document.querySelector('.main-content-body')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    });

    setSlide(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseAnimeTheme, { once: true });
  } else {
    initialiseAnimeTheme();
  }
}());
