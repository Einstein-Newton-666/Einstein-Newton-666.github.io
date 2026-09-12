'use strict';

// 首页横幅的分时预加载。
//
// 背景：主题横幅 <img> 的静态地址固定是 /images/brand/hero-day.webp，anime-theme.js 要等到
// DOMContentLoaded 才按当前时段换成晨/昼/暮/夜对应的图，LCP 因此被推迟到脚本执行之后。
// 这里在 <head> 里内联一小段脚本，按当前时段下发 <link rel=preload as=image>，
// 让浏览器在解析 head 阶段就开始下载正确的图片；imagesrcset/sizes 交给浏览器选档，
// 规则与 source/js/anime-home-scenes.js 的 selectHomeSceneImage 保持一致，
// 避免预加载和正式请求选到不同文件而重复下载。
//
// 注入范围：只有含首页横幅的页面。内页（分类/标签/归档/关于/文章/404）没有横幅，
// 一旦注入就会让每个内页白下载 213–925KB 的横幅图，并和页面真正要用的背景图抢带宽，
// 所以这里用 after_render:html 过滤器按渲染结果筛选，而不是塞进全局 inject.head。
const heroPreloadSnippet = `<script>(function () {
try {
var hour = new Date().getHours();
var period = hour >= 5 && hour < 11 ? "morning" : hour >= 11 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "sunset" : "night";
if (document.querySelector('link[data-anime-hero-preload="' + period + '"]')) return;
var base = "/images/brand/hero-" + period;
var preload = function (attributes) {
var link = document.createElement("link");
link.rel = "preload";
link.as = "image";
link.fetchPriority = "high";
for (var name in attributes) link.setAttribute(name, attributes[name]);
document.head.appendChild(link);
};
preload({ "data-anime-hero-preload": period, href: base + "-mobile.webp", media: "(max-width: 767px)" });
preload({ "data-anime-hero-preload": period, imagesrcset: base + ".webp 2560w, " + base + "-4k.webp 3840w", imagesizes: "100vw", media: "(min-width: 768px)" });
} catch (error) {}
})();</script>`;

// 首页横幅的容器类名，只有首页会渲染出来；主题若改名，verify-site 的首页断言会立刻失败。
const bannerMarker = 'home-banner-container';
const alreadyInjectedMarker = 'data-anime-hero-preload';

function injectHeroPreload(html) {
  const markup = String(html || '');
  if (!markup.includes(bannerMarker)) return html;
  if (markup.includes(alreadyInjectedMarker)) return html;
  const headEnd = markup.indexOf('</head>');
  if (headEnd === -1) return html;
  return `${markup.slice(0, headEnd)}${heroPreloadSnippet}${markup.slice(headEnd)}`;
}

hexo.extend.filter.register('after_render:html', injectHeroPreload);

module.exports = { heroPreloadSnippet, injectHeroPreload, bannerMarker };
