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

    // 按设备挑出该场景要用的那一档地址。
    const resolveHomeImage = (slide) =>
      selectHomeSceneImage(slide, window.innerWidth, window.devicePixelRatio);

    // 浏览器换 <img> 的 src 是「先撤掉旧图，解码完才画新图」：这段空档里屏幕上留着旧图的
    // 像素，却已经按新图的 object-position 在裁 —— 于是先看到旧图横着挪一段，再被新图替掉
    // （就是「原有图片先左右移动一下才切换」）。旧图跨越这段空档时也已经不是所选场景，
    // 等于同时闪了一张错图。
    //
    // 只把「换 src」和「换位置」放进同一帧并不够：那个可见的 <img> 换了 src 之后仍要自己
    // 重新解码（预载用的是另一份），这段窗口一样存在 —— 手机上四张图的 mobilePosition 各不
    // 相同（72/74/52/46%），一眼就能看出横移。
    //
    // 所以改成换元素：预载好之后新建一个 <img> 插进同一个容器，再删掉旧的。旧元素在它被
    // 移除之前一个像素都不会动，中间态没有存在的余地；新元素插入前就把 src 写好，
    // 插入时直接命中缓存，也不会先画一张空白。
    //
    // 地址由调用方一并传进来，不在这里重算：预载用的是发起那一刻的档位，提交时再按当时的
    // 视口算一次的话，中途改窗口大小就会提交一个没预载过的地址，白等一次网络 ——
    // 那正是这个改动要消掉的那段空档。
    function applyHomeScene(slide, target, nextImage) {
      if (target !== runtime.pendingHomeScene) return;
      runtime.pendingHomeScene = undefined;

      // 位置变量要给新元素用，先写；容器上的变量对两张新图同时生效。
      background.style.setProperty('--anime-hero-position-desktop', slide.desktopPosition);
      background.style.setProperty('--anime-hero-position-mobile', slide.mobilePosition);

      // 首次进入、或屏幕上已经就是这一档（静态 HTML 里的兜底图正好等于当前时段的图）时
      // 不必换元素：换一次反而让浏览器重新解码同一个位图，白闪一帧。
      const current = images.filter((image) => image.isConnected);
      if (current.length && current.every((image) => image.getAttribute('src') === nextImage)) {
        current.forEach((image) => {
          image.alt = slide.alt;
        });
        return;
      }

      // 明暗两张各留一份：className 里带着 dark:hidden / hidden dark:block，
      // 主题切明暗只认这两个工具类，所以新元素必须照抄旧元素的类。
      const templates = images.filter((image) => image.isConnected);
      images.forEach((image) => {
        if (image.isConnected) image.remove();
      });
      images.length = 0;
      templates.forEach((template) => {
        const image = document.createElement('img');
        image.className = template.className;
        image.alt = slide.alt;
        image.setAttribute('src', nextImage);
        image.decoding = 'async';
        images.push(image);
        background.appendChild(image);
      });
    }

    function updateHomeImage() {
      if (!activeSlide) return;
      const slide = activeSlide;
      const nextImage = resolveHomeImage(slide);
      const shown = () => images.every((image) => image.getAttribute('src') === nextImage);
      const pending = runtime.pendingHomeScene;

      // 正在预载的就是这一档：复用那次预载，只把它要提交的场景换成当前这个。
      // 复用而不是新起一次：同一档地址的两次预载对浏览器是同一份缓存，再等一次只是白等。
      if (pending && pending.nextImage === nextImage) {
        pending.slide = slide;
        return;
      }

      // 屏幕上已经是这一档：不用等任何预载，但还是把提交登记下来 —— 登记本身就是
      // 「此刻起以这个场景为准」的凭据，先前那次切换的提交因此作废（否则它落地时会把
      // 停了一拍的位置写回上一张）。登记的提交会在下一行同步执行掉。
      const target = { nextImage, slide };
      runtime.pendingHomeScene = target;

      if (shown()) {
        applyHomeScene(slide, target, nextImage);
        return;
      }

      let settled = false;
      const finish = () => {
        // onload 与 decode() 会先后到达，只认第一次。
        if (settled) return;
        settled = true;
        applyHomeScene(target.slide, target, target.nextImage);
      };

      const loader = new Image();
      loader.decoding = 'async';
      loader.onload = finish;
      // 图挂了也必须提交 —— 否则这一屏会永远停在上一张，还带着已经过期的文字。
      loader.onerror = finish;
      loader.src = nextImage;

      // 图片已在缓存里时 onload 可能在这行之前就烧掉了，所以这里再确认一次。
      if (typeof loader.decode === 'function') {
        loader.decode().then(finish, finish);
      } else if (loader.complete) {
        finish();
      }
    }

    function setSlide(index) {
      const slide = slides[index];
      activeSlide = slide;
      updateHomeImage();
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
