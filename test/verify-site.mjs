import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const root = process.cwd();
const failures = [];
const homePeriods = ['morning', 'day', 'sunset', 'night'];
const expectedImages = [
  ...homePeriods.flatMap((period) => [
    `hero-${period}-mobile.webp`,
    `hero-${period}.webp`,
    `hero-${period}-4k.webp`,
    `hero-${period}-thumb.webp`,
  ]),
  'firefly-side.webp',
  'tech-lab.webp',
  'book-spring.webp',
  'category-library-glow.webp',
  'category-library-glow-4k.webp',
  'log-gothic-library.webp',
  'log-gothic-library-4k.webp',
  'tag-cloud-city.webp',
  'tag-cloud-city-4k.webp',
  'article-digital-library.webp',
  'article-digital-library-4k.webp',
  'about-sky-terminal.webp',
  'about-sky-terminal-4k.webp',
  'castorice-avatar.webp',
  'castorice-avatar-display.webp',
  'favicon-avatar.png',
];

const imageSizeLimits = new Map([
  ...homePeriods.map((period) => [`hero-${period}-thumb.webp`, 30 * 1024]),
  ['castorice-avatar-display.webp', 50 * 1024],
  // 站点图标是 192×192 圆形 PNG：量化到 256 色后约 16KB，这里卡在 24KB 防止退回未优化的写法。
  ['favicon-avatar.png', 24 * 1024],
]);

// 4K 档单独设 1MB 上限。sources.json 里用 sizeException 显式记录“体积超标但为保住画质有意保留”
// 的资源（当前是 tag-cloud-city-4k.webp，继续压缩会损伤建筑与瀑布纹理），其余 4K 不应超标。
const largeImageLimit = 1024 * 1024;

const brandImageDirectory = path.join(root, 'source/images/brand');
const brandAssetEntries = await readdir(brandImageDirectory, { recursive: true, withFileTypes: true });
const relativeBrandPath = (entry) => path
  .relative(brandImageDirectory, path.join(entry.parentPath, entry.name))
  .split(path.sep)
  .join('/');
for (const entry of brandAssetEntries) {
  if (entry.isSymbolicLink()) failures.push(`品牌资源不得使用符号链接：source/images/brand/${relativeBrandPath(entry)}`);
}
const brandAssetNames = brandAssetEntries
  .filter((entry) => entry.isFile())
  .map(relativeBrandPath)
  .filter((name) => name !== 'sources.json')
  .sort();
for (const asset of brandAssetNames) {
  if (!expectedImages.includes(asset)) failures.push(`未登记品牌资源：source/images/brand/${asset}`);
}

async function read(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    failures.push(`缺少构建产物：${relativePath}`);
    return '';
  }
}

function expect(content, pattern, message) {
  if (!pattern.test(content)) failures.push(message);
}

// 读取 PNG 左上角像素的 alpha，用于确认站点图标是带透明四角的圆形。
// 支持 8 位 RGBA（色彩类型 6）与带 tRNS 的调色板 PNG（色彩类型 3，量化后的图标用它）。
function pngTopLeftAlpha(buffer) {
  if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;

  let offset = 8;
  let bitDepth = 0;
  let colorType = 0;
  let interlaced = false;
  let transparency = null;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      bitDepth = data[8];
      colorType = data[9];
      interlaced = data[12] !== 0;
    }
    if (type === 'tRNS') transparency = data;
    if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
  }

  if (bitDepth !== 8 || interlaced || !imageData.length) return null;
  const firstScanline = inflateSync(Buffer.concat(imageData));
  if (firstScanline[0] !== 0) return null; // 首行必须无过滤，才能直接读左上角像素
  if (colorType === 6) return firstScanline[4];
  if (colorType === 3) return transparency?.[firstScanline[1]] ?? 255;
  return null;
}

const packageJson = JSON.parse(await read('package.json'));
for (const dependency of ['hexo-generator-feed', 'hexo-wordcount']) {
  if (!packageJson.dependencies?.[dependency]) failures.push(`缺少依赖：${dependency}`);
}

const brandSources = JSON.parse(await read('source/images/brand/sources.json'));
const backgroundSources = new Map([
  ['hero-morning', ['hero-morning.webp', 'hero-morning-4k.webp', 4096, 2304]],
  ['hero-day', ['hero-day.webp', 'hero-day-4k.webp', 5000, 3000]],
  ['hero-sunset', ['hero-sunset.webp', 'hero-sunset-4k.webp', 3840, 2400]],
  ['hero-night', ['hero-night.webp', 'hero-night-4k.webp', 5333, 3000]],
  ['inner-categories', ['category-library-glow.webp', 'category-library-glow-4k.webp', 8736, 4896]],
  ['inner-logs', ['log-gothic-library.webp', 'log-gothic-library-4k.webp', 9045, 5109]],
  ['inner-tags', ['tag-cloud-city.webp', 'tag-cloud-city-4k.webp', 4000, 1857]],
  ['inner-archives', ['article-digital-library.webp', 'article-digital-library-4k.webp', 7200, 4050]],
  ['inner-post', ['article-digital-library.webp', 'article-digital-library-4k.webp', 7200, 4050]],
  ['inner-about', ['about-sky-terminal.webp', 'about-sky-terminal-4k.webp', 5910, 2944]],
]);

for (const [slot, [file, file4k, width, height]] of backgroundSources) {
  const source = brandSources.find((candidate) => candidate.slot === slot);
  if (
    source?.file !== file
    || source?.file4k !== file4k
    || source?.originalDimensions?.width !== width
    || source?.originalDimensions?.height !== height
    || !source?.sourcePage
    || !source?.processing
  ) {
    failures.push(`${slot} 缺少完整双分辨率来源记录`);
  }
}

for (const slot of ['hero-morning', 'hero-day', 'hero-sunset', 'hero-night', 'inner-archives']) {
  const source = brandSources.find((candidate) => candidate.slot === slot);
  if ((source?.originalDimensions?.width || 0) < 3840) {
    failures.push(`${slot} 不是原生 4K 来源`);
  }
}

for (const period of homePeriods) {
  const source = brandSources.find((candidate) => candidate.slot === `hero-${period}`);
  if (source?.fileMobile !== `hero-${period}-mobile.webp`) {
    failures.push(`hero-${period} 缺少 1280 档来源记录`);
  }
}

const sizeExceptionFiles = new Set(
  brandSources
    .filter((source) => source.sizeException)
    .flatMap((source) => [source.file, source.file4k, source.fileMobile, source.thumb])
    .filter(Boolean),
);

const imageHashes = [];
for (const image of expectedImages) {
  const relativePath = `source/images/brand/${image}`;
  try {
    await access(path.join(root, relativePath));
    const buffer = await readFile(path.join(root, relativePath));
    imageHashes.push(createHash('sha256').update(buffer).digest('hex'));
    const sizeLimit = imageSizeLimits.get(image);
    if (sizeLimit && buffer.byteLength > sizeLimit) {
      failures.push(`品牌图片超过体积上限：${relativePath}`);
    }
    if (image.endsWith('-4k.webp') && buffer.byteLength > largeImageLimit && !sizeExceptionFiles.has(image)) {
      failures.push(`4K 品牌图片超过 1MB，若确为画质所需请在 sources.json 记录 sizeException：${relativePath}`);
    }
  } catch {
    failures.push(`缺少品牌图片：${relativePath}`);
  }
}
if (imageHashes.length === expectedImages.length && new Set(imageHashes).size !== expectedImages.length) {
  failures.push('品牌图片存在重复内容');
}

const favicon = await readFile(path.join(root, 'source/images/brand/favicon-avatar.png'));
if (pngTopLeftAlpha(favicon) !== 0) {
  failures.push('站点头像 favicon 不是带透明四角的圆形 PNG');
}

const home = await read('public/index.html');
const post = await read('public/2026/08/15/welcome/index.html');
const about = await read('public/about/index.html');
const logs = await read('public/logs/index.html');
const categories = await read('public/categories/index.html');
const tags = await read('public/tags/index.html');
const archives = await read('public/archives/index.html');
const feed = await read('public/atom.xml');
const sitemap = await read('public/sitemap.xml');
const robots = await read('public/robots.txt');
const notFound = await read('public/404.html');
const animeCss = await read('public/css/anime-theme.css');
const animeScript = await read('public/js/anime-theme.js');
const animeViewerScript = await read('public/js/anime-image-viewer.js');

// 主题版本从实际安装的包里读，升级 Redefine 后不必再手改这里的版本号。
const themeVersion = JSON.parse(await read('node_modules/hexo-theme-redefine/package.json')).version;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const themeAssetPrefix = `https://registry.npmmirror.com/hexo-theme-redefine/${themeVersion}/files/source/`;

expect(home, /href="\/css\/anime-theme\.css"/, '首页未加载 anime-theme.css');
expect(
  home,
  new RegExp(`${escapeRegExp(themeAssetPrefix)}fontawesome/fontawesome\\.min\\.css`),
  `主题静态资源未使用 Redefine 官方 npmmirror CDN（当前主题版本 ${themeVersion}）`,
);
expect(home, /"search":\{"enable":true,"preload":false\}/, '搜索索引仍在首屏预加载');
if (/href="\/fontawesome\/fontawesome\.min\.css"/.test(home)) {
  failures.push('首页仍从 GitHub Pages 加载主题 Font Awesome');
}
for (const [name, content] of [
  ['首页', home],
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['日志页', logs],
  ['文章页', post],
]) {
  expect(content, /src="\/js\/anime-home-scenes\.js"/, `${name}未加载首页分时场景模块`);
  expect(content, /src="\/js\/anime-page-scenes\.js"/, `${name}未加载页面场景映射脚本`);
  expect(content, /src="\/js\/anime-theme\.js"/, `${name}未加载 anime-theme.js`);
  expect(content, /src="\/js\/anime-image-viewer\.js"/, `${name}未加载图片清晰度增强脚本`);
}
expect(
  home,
  /src="\/js\/anime-home-scenes\.js"[\s\S]+src="\/js\/anime-page-scenes\.js"[\s\S]+src="\/js\/anime-theme\.js"/,
  '首页分时场景模块未在主题脚本之前加载',
);
expect(home, /Einstein-Newton-666 的博客/, '站点标题尚未中文化');
expect(home, /href="\/images\/brand\/favicon-avatar\.png"/, '首页未使用角色头像 favicon');
expect(home, /link\.rel = "preload"[\s\S]{0,120}link\.as = "image"/, '首页 <head> 未预加载当前时段的横幅图');
expect(home, /hero-" \+ period/, '横幅预加载脚本没有按当前时段拼接图片地址');
for (const [name, content] of [
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['日志页', logs],
  ['文章页', post],
  ['404 页', notFound],
]) {
  if (content.includes('data-anime-hero-preload')) {
    failures.push(`${name}没有首页横幅，不应预加载横幅图（会白下 213–925KB）`);
  }
}
if (/redefine-favicon\.svg/.test(home)) {
  failures.push('首页仍引用 Redefine 默认 R 图标');
}
expect(home, /\/images\/brand\/castorice-avatar-display\.webp/, '首页未使用轻量头像展示版');
if (/\/images\/brand\/castorice-avatar\.webp/.test(home)) {
  failures.push('首页仍引用 900x900 原头像');
}
expect(home, /\/images\/brand\/hero-day\.webp/, '首页无脚本回退未使用白日场景');
expect(animeViewerScript, /resolveViewerImageSource/, '图片清晰度增强脚本缺少原图解析逻辑');
expect(animeViewerScript, /addEventListener\('click', promoteImageSource, true\)/, '图片清晰度增强脚本未在灯箱前捕获点击');
expect(
  home,
  /<img src="\/images\/brand\/hero-day\.webp"[^>]+class="[^"]*hidden dark:block"/,
  '首页暗色初始背景仍会抢先下载非当前场景',
);
expect(home, /href="\/about\/?"/, '导航栏缺少关于页');
expect(home, /href="\/logs\/?"/, '导航栏缺少独立日志页');
expect(home, /href="\/atom\.xml"/, '页面缺少 RSS 入口');
expect(home, />归档</, '侧栏缺少中文“归档”链接');
expect(home, />分类</, '侧栏缺少中文“分类”链接');
expect(home, />标签</, '侧栏缺少中文“标签”链接');
if (/class="tag-list"[^>]+data-show-value="true"/.test(tags)) {
  failures.push('标签页仍使用默认模糊样式');
}
expect(post, /class="article-wordcount/, '文章页未显示字数');
expect(post, /class="article-min2read/, '文章页未显示阅读时间');
expect(post, /mjx-container[^>]+jax="SVG"/, '文章公式未生成 MathJax SVG');
expect(about, /关于本站/, '关于页内容未生成');
expect(logs, /你好，世界 —— 第一篇日志/, '日志页未展示“日志”分类文章');
expect(logs, /<title>[^<]*日志[^<]*<\/title>/, '日志页标题未生成');
expect(feed, /<feed[\s>]/, 'atom.xml 不是有效的 Atom 订阅文件');

expect(sitemap, /<urlset[\s>]/, 'sitemap.xml 不是有效的站点地图');
expect(sitemap, /<loc>https:\/\/einstein-newton-666\.github\.io\/2026\/08\/15\/welcome\/<\/loc>/, 'sitemap 缺少文章条目');
expect(sitemap, /<loc>https:\/\/einstein-newton-666\.github\.io\/about\/<\/loc>/, 'sitemap 中的页面地址不是去掉 index.html 的干净 URL');
expect(sitemap, /<lastmod>2026-08-15<\/lastmod>/, 'sitemap 的 lastmod 不是文章自身日期（检查 updated_option 是否被改回 mtime）');
// 首页/标签/分类条目不应带 lastmod：自定义模板省略了它，避免每次部署都告诉爬虫“全变了”。
const sitemapHomeEntry = sitemap.match(/<url>\s*<loc>https:\/\/einstein-newton-666\.github\.io\/<\/loc>([\s\S]*?)<\/url>/)?.[1] ?? '';
expect(sitemapHomeEntry, /<changefreq>/, 'sitemap 缺少首页条目');
if (/<lastmod>/.test(sitemapHomeEntry)) failures.push('sitemap 首页条目的 lastmod 会随构建时间变化');
for (const banned of ['404.html', 'sources.json', 'index.html']) {
  if (sitemap.includes(banned)) failures.push(`sitemap 不应包含 ${banned}`);
}

expect(robots, /^User-agent: \*$/m, 'robots.txt 缺少 User-agent 规则');
expect(robots, /Sitemap: https:\/\/einstein-newton-666\.github\.io\/sitemap\.xml/, 'robots.txt 未声明 sitemap 地址');

expect(notFound, /页面未找到/, '404 页面内容未生成');
expect(notFound, /<link rel="canonical" href="https:\/\/einstein-newton-666\.github\.io\/404\.html"\/>/, '404 页面未声明自身的 canonical');
if (!/navbar-container/.test(notFound)) failures.push('404 页面没有套用站点布局（导航栏缺失）');
expect(animeCss, /html\[data-anime-page\]/, '自定义样式缺少内页场景选择器');
expect(animeCss, /html\[data-anime-page\] \.page-container\s*\{[^}]*background: transparent/s, '内页容器仍遮挡背景场景');
expect(animeCss, /--anime-page-image/, '自定义样式未使用内页背景变量');
expect(animeCss, /html\.dark\[data-anime-page\]/, '内页场景缺少暗色模式');
expect(animeCss, /--anime-page-position-mobile/, '内页场景缺少移动端裁切变量');
expect(animeScript, /selectHomeSceneImage\(activeSlide, window\.innerWidth, window\.devicePixelRatio\)/, '首页脚本未按设备选择三级清晰度');
expect(animeScript, /window\.innerWidth, window\.devicePixelRatio/, '内页脚本未按视口和像素密度选图');
expect(animeCss, /rgba\(247, 250, 249, \.42\).*rgba\(247, 250, 249, \.64\)/s, '浅色内页遮罩未使用更透明的设置');
expect(animeCss, /html\[data-anime-page\] :is\(\.page-template-container, \.archive-container, \.article-content-container, \.toc-content-container\)\s*\{[^}]*background: rgba\(250, 252, 251, \.48\)/s, '浅色内页内容卡片未使用更透明的设置');
expect(animeCss, /\.home-content-container \.home-article-list \.home-article-item\s*\{[^}]*background: rgba\(250, 252, 251, \.80\)/s, '首页浅色文章卡片未使用更透明的设置');
expect(animeCss, /rgba\(13, 22, 28, \.40\).*rgba\(13, 22, 28, \.62\)/s, '暗色内页遮罩未使用更透明的设置');
expect(animeCss, /html\.dark\[data-anime-page\] :is\(\.page-template-container, \.archive-container, \.article-content-container, \.toc-content-container\)\s*\{[^}]*background: rgba\(21, 31, 39, \.48\)/s, '暗色内页内容卡片未使用更透明的设置');
expect(animeCss, /html\.dark \.home-content-container \.home-article-list \.home-article-item\s*\{[^}]*background: rgba\(21, 31, 39, \.80\)/s, '首页暗色文章卡片未使用更透明的设置');

const neutralNavbarRule = animeCss.match(/html \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(neutralNavbarRule, /background:\s*rgba\(255, 255, 255, \.24\)/, '浅色导航栏未使用无色玻璃背景');
expect(neutralNavbarRule, /backdrop-filter:\s*blur\(10px\) saturate\(115%\)/, '导航栏玻璃模糊参数缺失');
if (/linear-gradient\(/.test(neutralNavbarRule)) {
  failures.push('导航栏仍包含彩色渐变');
}

const darkNeutralNavbarRule = animeCss.match(/html\.dark \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(darkNeutralNavbarRule, /background:\s*rgba\(12, 18, 24, \.42\)/, '暗色导航栏未使用中性玻璃背景');

const innerNavbarRule = animeCss.match(/html\[data-anime-page\] \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(innerNavbarRule, /background:\s*rgba\(255, 255, 255, \.18\)/, '浅色内页导航栏未使用更透明的玻璃背景');

const darkInnerNavbarRule = animeCss.match(/html\.dark\[data-anime-page\] \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(darkInnerNavbarRule, /background:\s*rgba\(12, 18, 24, \.34\)/, '暗色内页导航栏未使用更透明的玻璃背景');

for (const [name, content] of [
  ['首页', home],
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['文章页', post],
]) {
  if (/<img[^>]+src=["']https?:\/\//i.test(content)) {
    failures.push(`${name}仍包含运行时外链图片`);
  }
}

for (const [name, content] of [['首页', home], ['文章页', post]]) {
  if (/example\.example\.com|waline/i.test(content)) failures.push(`${name}仍包含失效的 Waline 配置`);
  if (/<script[^>]+(?:cn\.)?vercount|id="busuanzi_/i.test(content)) failures.push(`${name}仍加载不可信的第三方访问计数`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('PASS: 站点资源、路由、RSS、字数统计与 MathJax 构建检查通过');
