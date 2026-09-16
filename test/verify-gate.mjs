import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const browserGate = require('../source/js/site-gate.js');
const gateBuild = require('../scripts/gate-build.js');

/* ---------------------------------------------------------------------------
 * 带密码构建的产物校验：跑在 `npm run gate:build` 之后、上传 Pages 之前。
 *
 * 三件事必须成立，否则“加了密码”只是心理安慰：
 *   1. 每个 HTML 都是锁屏外壳（有密文负载），没有一个是漏掉的明文页；
 *   2. 用密码解出来的正文与构建报告里的哈希一致（证明访客真的能打开）；
 *   3. 全 public/ 里搜不到任何只属于正文的文本（证明密文确实没漏）。
 * ------------------------------------------------------------------------- */

const root = process.cwd();
const password = process.env.BLOG_GATE_PASSWORD;
const publicDir = path.join(root, 'public');
const reportPath = path.join(root, 'output', 'gate-report.json');
const failures = [];

if (!password) {
  console.error('- 缺少 BLOG_GATE_PASSWORD：校验必须带上与构建相同的密码');
  process.exit(1);
}

const TEXT_EXTENSIONS = new Set(['.html', '.xml', '.txt', '.json', '.js', '.css', '.svg']);
const PAYLOAD_RE = /<script type="application\/json" id="einblog-gate-payload">([\s\S]*?)<\/script>/;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else found.push(full);
  }
  return found.sort();
}

function toText(markup) {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** 只挑“像正文”的长中文片段，避免把导航词、站点名当成泄漏。 */
function contentRuns(markup) {
  const runs = toText(markup).match(/[\u4e00-\u9fff][\u4e00-\u9fff\w，。！？、：；“”‘’（）《》—…·\-]{9,}/g) || [];
  return [...new Set(runs.map((run) => run.trim()))];
}

const files = await walk(publicDir);
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const textFiles = files.filter((file) => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()));

const contents = new Map();
for (const file of textFiles) contents.set(file, await readFile(file, 'utf8'));

let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch {
  failures.push(`缺少构建报告：output/gate-report.json（先跑 npm run gate:build）`);
}

for (const asset of ['js/site-gate.js', 'css/site-gate.css']) {
  try {
    await access(path.join(publicDir, asset));
  } catch {
    failures.push(`缺少解锁资源：public/${asset}`);
  }
}

/* 1. 每个页面都必须是外壳（admin/ 等刻意排除的除外） */
const skipped = new Set((report && report.skipped) || []);
for (const relative of skipped) {
  if (!gateBuild.DEFAULT_SKIP_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
    failures.push(`构建报告跳过了不该跳过的页面：${relative}`);
  }
}

const shellText = [];
for (const file of htmlFiles) {
  const relative = path.relative(publicDir, file).split(path.sep).join('/');
  const html = contents.get(file);

  if (skipped.has(relative)) {
    if (PAYLOAD_RE.test(html)) failures.push(`${relative} 在跳过名单里却带了密文负载`);
    continue;
  }

  if (!PAYLOAD_RE.test(html)) {
    failures.push(`页面没有被加密：public/${relative}`);
    continue;
  }
  // 外壳（含 head）里不许留主题配置脚本：window.theme 带着站点标题、侧栏公告等自写文案
  if (/hexo-configurations|window\.theme\s*=/.test(html)) {
    failures.push(`public/${relative} 的外壳里还留着主题配置脚本（站点文案明文可见）`);
  }
  shellText.push(toText(html.replace(PAYLOAD_RE, ' ')));
}

/* 2. 密码能解回原文，且与报告里的哈希一致 */
const plainTexts = new Map();
if (report) {
  for (const entry of report.pages) {
    const file = path.join(publicDir, ...entry.path.split('/'));
    const html = contents.get(file);
    if (!html) {
      failures.push(`报告里的页面不存在：${entry.path}`);
      continue;
    }
    const match = html.match(PAYLOAD_RE);
    if (!match) continue;

    try {
      const payload = browserGate.parsePayload(match[1]);
      const key = await browserGate.deriveKey(password, payload);
      const content = await browserGate.decryptPayload(payload, key);
      if (sha256(content.bodyHtml) !== entry.plainTextSha256) {
        failures.push(`${entry.path} 解出来的正文与构建报告不一致`);
      }
      plainTexts.set(entry.path, content.bodyHtml);
    } catch (error) {
      failures.push(`${entry.path} 解不开：${error.message}`);
    }
  }

  const gatedPages = htmlFiles
    .map((file) => path.relative(publicDir, file).split(path.sep).join('/'))
    .filter((relative) => !report.skipped.includes(relative));
  for (const relative of gatedPages) {
    if (!report.pages.some((entry) => entry.path === relative)) {
      failures.push(`页面没有进构建报告：${relative}`);
    }
  }
}

/* 3. 全产物搜不到“只属于正文”的文本 */
const shellCorpus = [...shellText, ...contents.values()].join('\n');
const canaries = new Set();
for (const plain of plainTexts.values()) {
  for (const run of contentRuns(plain)) {
    if (!shellCorpus.includes(run)) canaries.add(run);
  }
}

for (const [file, content] of contents) {
  const relative = path.relative(publicDir, file).split(path.sep).join('/');
  for (const canary of canaries) {
    if (content.includes(canary)) {
      failures.push(`明文泄漏：public/${relative} 里出现了正文片段「${canary.slice(0, 18)}…」`);
    }
  }
}

/* 4. 锁屏页不得进搜索引擎索引；robots.txt 归编辑台的线上比对管，门闩不碰 */
for (const file of htmlFiles) {
  const relative = path.relative(publicDir, file).split(path.sep).join('/');
  if (skipped.has(relative)) continue;
  if (!/<meta name="robots" content="noindex, nofollow">/.test(contents.get(file))) {
    failures.push(`${relative} 缺少 noindex（锁屏页会被搜索引擎收录）`);
  }
}

for (const xml of ['search.xml', 'atom.xml']) {
  const file = path.join(publicDir, xml);
  const content = contents.get(file);
  if (content === undefined) continue;
  for (const canary of canaries) {
    if (content.includes(canary)) failures.push(`${xml} 里仍有正文片段`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`PASS: 整站加密校验通过（${(report && report.pages.length) || 0} 个页面为密文外壳，跳过 ${skipped.size} 个，正文片段 ${canaries.size} 条，产物内未出现明文）`);
