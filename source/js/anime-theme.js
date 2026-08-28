(function () {
  const runtime = globalThis.__einsteinAnimeThemeRuntime || {};
  globalThis.__einsteinAnimeThemeRuntime = runtime;

  const homeScenes = globalThis.AnimeHomeScenes;
  const slides = homeScenes?.slides || [];
  const resolveHomeSceneIndex = homeScenes?.resolveHomeSceneIndex;
  const selectHomeSceneImage = homeScenes?.selectHomeSceneImage;

  function cleanupHomeSceneResize() {
    if (runtime.homeSceneResizeHandler) {
      window.removeEventListener('resize', runtime.homeSceneResizeHandler);
      runtime.homeSceneResizeHandler = undefined;
    }
    clearTimeout(runtime.homeSceneResizeTimer);
  }

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

    if (!hero || !background || !description || !images.length) {
      cleanupHomeSceneResize();
      return;
    }
    if (hero.dataset.animeThemeReady === 'true') return;
    cleanupHomeSceneResize();
    if (!slides.length || !resolveHomeSceneIndex || !selectHomeSceneImage) return;
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
      <button type="button" title="场景 ${index + 1}：${slide.scene}" aria-label="查看场景 ${index + 1}" aria-pressed="false">
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
    let activeSlide;

    const updateHomeImage = () => {
      if (!activeSlide) return;
      const nextImage = selectHomeSceneImage(activeSlide, window.innerWidth, window.devicePixelRatio);
      images.forEach((image) => {
        if (image.getAttribute('src') !== nextImage) image.src = nextImage;
      });
    };

    function setSlide(index) {
      const slide = slides[index];
      activeSlide = slide;
      images.forEach((image) => {
        image.alt = slide.alt;
      });
      updateHomeImage();
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
    runtime.homeSceneResizeHandler = () => {
      clearTimeout(runtime.homeSceneResizeTimer);
      runtime.homeSceneResizeTimer = setTimeout(updateHomeImage, 150);
    };
    window.addEventListener('resize', runtime.homeSceneResizeHandler, { passive: true });
    scrollCue.addEventListener('click', () => {
      document.querySelector('.main-content-body')?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    });

    const initialIndex = resolveHomeSceneIndex(new Date());
    setSlide(initialIndex);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseAnimeTheme, { once: true });
  } else {
    initialiseAnimeTheme();
  }
}());
