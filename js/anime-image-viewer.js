(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AnimeImageViewer = api;
    if (root.document) api.install(root.document);
  }
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const imageSelector = '.markdown-body img, .masonry-item img, #shuoshuo-content img';
  const placeholderPattern = /(?:loading\.svg|data:image\/)/i;

  function getAttribute(image, name) {
    return typeof image?.getAttribute === 'function' ? image.getAttribute(name) : null;
  }

  function isPlaceholder(value) {
    return !value || placeholderPattern.test(String(value));
  }

  function resolveViewerImageSource(image) {
    if (!image) return '';

    for (const attribute of ['data-viewer-src', 'data-full-src', 'data-original', 'data-original-src']) {
      const explicitSource = getAttribute(image, attribute);
      if (explicitSource && !isPlaceholder(explicitSource)) return explicitSource;
    }

    const currentSource = image.currentSrc || '';
    if (!isPlaceholder(currentSource)) return currentSource;

    const lazySource = getAttribute(image, 'data-src');
    if (lazySource && !isPlaceholder(lazySource)) return lazySource;

    return getAttribute(image, 'src') || image.src || '';
  }

  function promoteImageSource(event) {
    const target = event?.target;
    const image = target?.closest?.(imageSelector);
    if (!image || image.closest?.('.image-viewer-container')) return;

    const source = resolveViewerImageSource(image);
    if (!source || getAttribute(image, 'src') === source) return;
    image.setAttribute('src', source);
    image.removeAttribute?.('lazyload');
  }

  function install(documentObject) {
    if (!documentObject?.addEventListener || documentObject.__animeImageViewerInstalled) return;
    documentObject.addEventListener('click', promoteImageSource, true);
    documentObject.__animeImageViewerInstalled = true;
  }

  return { install, resolveViewerImageSource };
}));
