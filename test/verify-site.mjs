import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
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
  'archive-magic-spiral-library.webp',
  'archive-magic-spiral-library-4k.webp',
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
  ['favicon-avatar.png', 100 * 1024],
]);

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

function pngTopLeftAlpha(buffer) {
  if (buffer.subarray(1, 4).toString('ascii') !== 'PNG') return null;

  let offset = 8;
  let rgba = false;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') rgba = data[8] === 8 && data[9] === 6 && data[12] === 0;
    if (type === 'IDAT') imageData.push(data);
    offset += length + 12;
  }

  if (!rgba || !imageData.length) return null;
  const firstScanline = inflateSync(Buffer.concat(imageData));
  return firstScanline[4];
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
const animeCss = await read('public/css/anime-theme.css');
const animeScript = await read('public/js/anime-theme.js');
const animeViewerScript = await read('public/js/anime-image-viewer.js');

expect(home, /href="\/css\/anime-theme\.css"/, '首页未加载 anime-theme.css');
expect(
  home,
  /https:\/\/registry\.npmmirror\.com\/hexo-theme-redefine\/2\.9\.0\/files\/source\/fontawesome\/fontawesome\.min\.css/,
  '主题静态资源未使用 Redefine 官方 npmmirror CDN',
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
expect(animeCss, /html\[data-anime-page\]/, '自定义样式缺少内页场景选择器');
expect(animeCss, /--anime-page-image/, '自定义样式未使用内页背景变量');
expect(animeCss, /html\.dark\[data-anime-page\]/, '内页场景缺少暗色模式');
expect(animeCss, /--anime-page-position-mobile/, '内页场景缺少移动端裁切变量');
expect(animeScript, /selectHomeSceneImage\(activeSlide, window\.innerWidth, window\.devicePixelRatio\)/, '首页脚本未按设备选择三级清晰度');
expect(animeScript, /window\.innerWidth, window\.devicePixelRatio/, '内页脚本未按视口和像素密度选图');
expect(animeCss, /rgba\(247, 250, 249, \.68\).*rgba\(247, 250, 249, \.86\)/s, '浅色内页遮罩未使用更透明的设置');
expect(animeCss, /background: rgba\(250, 252, 251, \.80\)/, '浅色内容卡片未使用更透明的设置');
expect(animeCss, /\.home-content-container \.home-article-list \.home-article-item\s*\{[^}]*background: rgba\(250, 252, 251, \.80\)/s, '首页浅色文章卡片未使用更透明的设置');
expect(animeCss, /rgba\(13, 22, 28, \.66\).*rgba\(13, 22, 28, \.86\)/s, '暗色内页遮罩未使用更透明的设置');
expect(animeCss, /background: rgba\(21, 31, 39, \.80\)/, '暗色内容卡片未使用更透明的设置');
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
