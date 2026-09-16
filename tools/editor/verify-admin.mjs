/**
 * 编辑台静态一致性校验（不启动浏览器）
 *
 *   node tools/editor/verify-admin.mjs
 *
 * 校验对象是「源码」与「构建产物 public/admin/index.html」之间的一致性，
 * 用来在没有浏览器的环境下抓出这类问题：
 *   · editor-app.js 依赖的 DOM id 在页面里不存在
 *   · 页面引用的 js/css 产物缺失
 *   · 模块之间的全局依赖（EditorDoc 等）声明顺序错误
 *   · 误把工厂作用域外的 root 当全局用（浏览器里会 ReferenceError）
 *   · 编辑台被搜索引擎收录、或误入 sitemap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ADMIN_SRC = path.join(ROOT, 'source/admin');
const PUBLIC_ADMIN = path.join(ROOT, 'public/admin/index.html');

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);
const ok = (message) => notes.push(message);

function readIfExists(target) {
  try {
    return fs.readFileSync(target, 'utf8');
  } catch (error) {
    return null;
  }
}

/* ------------------------- 1. 产物是否存在 ------------------------- */

if (!fs.existsSync(PUBLIC_ADMIN)) {
  fail('缺少构建产物 public/admin/index.html（先运行 npx hexo generate）');
  console.error(failures.join('\n'));
  process.exit(1);
}

const page = fs.readFileSync(PUBLIC_ADMIN, 'utf8');
ok(`已读取构建产物（${page.length} 字节）`);

/* ------------------------- 2. 引用的资源都能落地 ------------------------- */

const referenced = [
  ...page.matchAll(/<script src="([^"]+)"/g),
  ...page.matchAll(/<link[^>]+href="([^"]+\.css)"/g),
].map((match) => match[1]);

for (const url of referenced) {
  // 只校验站内资源；主题通过 CDN 引用的外链（registry.npmmirror.com 等）不属于本站产物
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith('//')) continue;
  const target = path.join(ROOT, 'public', url);
  if (!fs.existsSync(target)) fail(`页面引用了不存在的资源：${url}`);
}
const localReferences = referenced.filter((url) => !/^[a-z]+:\/\//i.test(url) && !url.startsWith('//'));
if (localReferences.length) ok(`页面引用 ${localReferences.length} 个站内资源，全部存在`);

/* ------------------------- 3. DOM id 一致性 ------------------------- */

const appSource = readIfExists(path.join(ADMIN_SRC, 'js/editor-app.js')) || '';
const cacheMatch = appSource.match(/const ids = \[([\s\S]*?)\];/);
if (!cacheMatch) {
  fail('未能在 editor-app.js 中找到 cacheElements 的 id 列表');
} else {
  const requiredIds = [...cacheMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const pageIds = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const missing = requiredIds.filter((id) => !pageIds.has(id));
  if (missing.length) fail(`页面缺少 editor-app.js 需要的元素 id：${missing.join(', ')}`);
  else ok(`${requiredIds.length} 个必需 DOM id 全部存在于页面`);

  const toolbarActions = new Set([...page.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]));
  const handled = new Set([...appSource.matchAll(/action === '([^']+)'/g)].map((match) => match[1]));
  const unhandled = [...toolbarActions].filter((action) => !handled.has(action)
    && !['bold', 'italic', 'strike', 'code', 'bullet', 'ordered', 'quote', 'table', 'fence', 'indent', 'outdent'].includes(action));
  if (unhandled.length) fail(`工具条按钮没有对应处理逻辑：${unhandled.join(', ')}`);
  else ok(`工具条 ${toolbarActions.size} 个按钮都有处理逻辑`);
}

/* ------------------------- 4. 脚本加载顺序 ------------------------- */

const scriptOrder = [...page.matchAll(/<script src="\/admin\/js\/([^"]+)"/g)].map((match) => match[1]);
const dependencies = {
  'editor-publish.js': [],
  'editor-toolbar.js': [],
  'editor-preview.js': [],
  'editor-upload.js': [],
  'editor-app.js': ['editor-doc.js', 'editor-publish.js', 'editor-toolbar.js', 'editor-preview.js', 'editor-upload.js'],
};
for (const [file, needs] of Object.entries(dependencies)) {
  const index = scriptOrder.indexOf(file);
  if (index === -1) {
    fail(`页面未加载 ${file}`);
    continue;
  }
  for (const need of needs) {
    const needIndex = scriptOrder.indexOf(need);
    if (needIndex === -1) fail(`页面未加载 ${need}（${file} 依赖它）`);
    else if (needIndex > index) fail(`${need} 必须在 ${file} 之前加载`);
  }
}
ok(`脚本加载顺序：${scriptOrder.join(' → ')}`);

/* ------------------------- 5. 全局引用与 root 误用 ------------------------- */

const adminJsFiles = fs.readdirSync(path.join(ADMIN_SRC, 'js'));
for (const file of adminJsFiles.filter((name) => name.endsWith('.js'))) {
  const source = readIfExists(path.join(ADMIN_SRC, 'js', file)) || '';
  const body = source
    .replace(/^\(function \(root, factory\) \{[\s\S]*?function \([^)]*\) \{\n/, '')
    .replace(/\}\(typeof globalThis === 'undefined' \? this : globalThis\)\);\s*$/, '');
  const offenders = body.match(/(?<![\w.$])root\.\w+/g) || [];
  if (file !== 'editor-app.js' && offenders.length) {
    fail(`${file} 引用了工厂作用域外的 root：${offenders.join(', ')}（浏览器里会 ReferenceError）`);
  }
  if (file === 'editor-app.js') {
    if (!/\}\(typeof globalThis === 'undefined' \? this : globalThis, function \(root\) \{/.test(source)) {
      fail('editor-app.js 使用了 root 但没有把它作为工厂形参传入');
    }
  }
}
ok('未发现工厂作用域外的 root 引用');

/* ------------------------- 6. 不被收录 ------------------------- */

if (!/name="robots"[^>]*noindex/.test(page)) fail('编辑台页面缺少 noindex，会被搜索引擎收录');
const robotsPath = path.join(ROOT, 'public/robots.txt');
if (!fs.existsSync(robotsPath)) {
  fail('缺少构建产物 public/robots.txt');
} else if (!/Disallow:\s*\/admin\//.test(fs.readFileSync(robotsPath, 'utf8'))) {
  fail('robots.txt 未禁止收录 /admin/');
}
const sitemapPath = path.join(ROOT, 'public/sitemap.xml');
if (fs.existsSync(sitemapPath) && /\/admin\//.test(fs.readFileSync(sitemapPath, 'utf8'))) {
  fail('sitemap.xml 不应包含 /admin/');
}
ok('收录控制：noindex + robots + sitemap 三项均已处理');

/* ------------------------- 7. 令牌不落在产物里 ------------------------- */

for (const file of adminJsFiles) {
  const source = readIfExists(path.join(ADMIN_SRC, 'js', file)) || '';
  const hardcoded = source.match(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g);
  if (hardcoded) fail(`${file} 里疑似硬编码了令牌：${hardcoded[0].slice(0, 12)}…`);
}
if (/gh[pousr]_[A-Za-z0-9]{20,}/.test(page)) fail('构建产物里疑似包含令牌');
ok('未在源码与产物中发现硬编码令牌');

/* -------------------------------- 输出 -------------------------------- */

console.log('');
for (const note of notes) console.log(`  ✓ ${note}`);
if (failures.length) {
  console.log('');
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error(`\nFAIL: ${failures.length} 项静态校验未通过\n`);
  process.exit(1);
}
console.log(`\nPASS: 编辑台静态一致性校验通过（${notes.length} 项）\n`);
