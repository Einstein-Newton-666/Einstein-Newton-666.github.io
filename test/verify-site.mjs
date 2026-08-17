import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const expectedImages = [
  'miku-field.webp',
  'morning-mountains.webp',
  'river-sunrise.webp',
  'firefly-side.webp',
  'tech-lab.webp',
  'book-spring.webp',
  'castorice-avatar.webp',
];

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

const packageJson = JSON.parse(await read('package.json'));
for (const dependency of ['hexo-generator-feed', 'hexo-wordcount']) {
  if (!packageJson.dependencies?.[dependency]) failures.push(`缺少依赖：${dependency}`);
}

const imageHashes = [];
for (const image of expectedImages) {
  const relativePath = `source/images/brand/${image}`;
  try {
    await access(path.join(root, relativePath));
    const buffer = await readFile(path.join(root, relativePath));
    imageHashes.push(createHash('sha256').update(buffer).digest('hex'));
  } catch {
    failures.push(`缺少品牌图片：${relativePath}`);
  }
}
if (imageHashes.length === expectedImages.length && new Set(imageHashes).size !== expectedImages.length) {
  failures.push('品牌图片存在重复内容');
}

const home = await read('public/index.html');
const post = await read('public/2026/08/15/welcome/index.html');
const about = await read('public/about/index.html');
const categories = await read('public/categories/index.html');
const tags = await read('public/tags/index.html');
const archives = await read('public/archives/index.html');
const feed = await read('public/atom.xml');

expect(home, /href="\/css\/anime-theme\.css"/, '首页未加载 anime-theme.css');
for (const [name, content] of [
  ['首页', home],
  ['分类页', categories],
  ['标签页', tags],
  ['归档页', archives],
  ['关于页', about],
  ['文章页', post],
]) {
  expect(content, /src="\/js\/anime-page-scenes\.js"/, `${name}未加载页面场景映射脚本`);
  expect(content, /src="\/js\/anime-theme\.js"/, `${name}未加载 anime-theme.js`);
}
expect(home, /Einstein-Newton-666 的博客/, '站点标题尚未中文化');
expect(home, /\/images\/brand\/castorice-avatar\.webp/, '首页未使用独立头像');
expect(home, /\/images\/brand\/miku-field\.webp/, '首页未使用已选头图');
expect(home, /href="\/about\/?"/, '导航栏缺少关于页');
expect(home, /href="\/atom\.xml"/, '页面缺少 RSS 入口');
expect(home, />归档</, '侧栏缺少中文“归档”链接');
expect(home, />分类</, '侧栏缺少中文“分类”链接');
expect(home, />标签</, '侧栏缺少中文“标签”链接');
expect(post, /class="article-wordcount/, '文章页未显示字数');
expect(post, /class="article-min2read/, '文章页未显示阅读时间');
expect(post, /mjx-container[^>]+jax="SVG"/, '文章公式未生成 MathJax SVG');
expect(about, /关于本站/, '关于页内容未生成');
expect(feed, /<feed[\s>]/, 'atom.xml 不是有效的 Atom 订阅文件');

for (const [name, content] of [['首页', home], ['文章页', post]]) {
  if (/example\.example\.com|waline/i.test(content)) failures.push(`${name}仍包含失效的 Waline 配置`);
  if (/<script[^>]+(?:cn\.)?vercount|id="busuanzi_/i.test(content)) failures.push(`${name}仍加载不可信的第三方访问计数`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('PASS: 站点资源、路由、RSS、字数统计与 MathJax 构建检查通过');
