'use strict';

/* ---------------------------------------------------------------------------
 * 访问密码的门闩：在 `hexo generate` 之后直接改写 public/ 里的产物。
 *
 * 为什么放在生成之后、而不是写成 Hexo 过滤器：
 *   Hexo 会把渲染结果缓存进 db.json，只对“变过的文件”重跑过滤器。过滤器方案
 *   一旦命中缓存就会把明文重新吐回产物里，而这是“看起来加了锁、实际漏了内容”
 *   的静默失败。直接改 public/ 里的最终文件，跟缓存、增量生成都无关。
 *
 * 处理方式：每个上锁的 HTML 保留 <head> 里的元数据，把 head 里的脚本与整个
 * <body> 一起加密成负载，页面上只留锁屏 + 解密脚本。
 *   - 顺带摘掉 Swup（主题的 SPA 切换）：未解锁的下一页永远是一张锁屏外壳，
 *     Swup 拿不到 #swup 容器只会报错，干脆让导航回到整页加载。
 *   - search.xml / atom.xml 是两份公开全文副本，一并清空正文。
 *   - 锁屏页加 noindex：没有收录价值。这里刻意不动 robots.txt——编辑台的
 *     tools/editor/verify-deploy.mjs 会拿线上 robots.txt 与本地产物逐字节比对。
 *   - admin/ 不在门内：在线编辑台自己用 GitHub PAT 登录，加密了反而没法用。
 *
 * 两种范围，由 BLOG_GATE_SCOPE 决定：
 *   - site（默认，fail-closed）：除 admin/ 外每个页面都上锁，RSS/搜索清空全部正文。
 *   - posts（逐篇）：只有 front-matter 写了 `private: true` 的文章上锁（清单由
 *     scripts/gate-private.js 在生成时写出），公开页面原样保留，RSS/搜索只清私密条目。
 *   范围是显式开关而不是“有没有私密文章”推断出来的：否则哪天漏打标记就会静默全站公开。
 *
 * 未设置 BLOG_GATE_PASSWORD 时整脚本跳过（本地开发、PR 校验照旧是明文站点）；
 * 部署流程里有守卫，缺 Secret 直接失败，绝不会把不设防的站点发出去。
 * ------------------------------------------------------------------------- */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const gateCrypto = require('./lib/gate-crypto');

const PAYLOAD_ID = 'einblog-gate-payload';
const PAYLOAD_MARK = `id="${PAYLOAD_ID}"`;
const GATE_CSS_HREF = '/css/site-gate.css';
const GATE_SCRIPT_SRC = '/js/site-gate.js';
const DEFAULT_PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_REPORT_PATH = path.join(__dirname, '..', 'output', 'gate-report.json');
const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'output', 'private-posts.json');
const DEFAULT_SKIP_PREFIXES = ['admin/'];

const SWUP_LIB_RE = /<script\b[^>]*\bsrc="[^"]*Swup[^"]*"[^>]*>\s*<\/script>/gi;
const SWUP_INIT_RE = /<script>\s*window\.swup\s*=\s*new Swup\([\s\S]*?<\/script>/i;
const HEAD_SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
// head 里只留决定明暗模式的那支小脚本：锁屏配色要用它，内容是纯逻辑没有站点文案。
const HEAD_SCRIPT_KEEP_RE = /REDEFINE-THEME-STATUS/;
const SEARCH_CONTENT_RE = /<content\b[^>]*>[\s\S]*?<\/content>/gi;
const FEED_CONTENT_RE = /(<content\b[^>]*>)[\s\S]*?(<\/content>)/gi;

const LOCK_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">'
  + '<path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 1 1 6 0v3Z"/></svg>';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function walkFiles(dir, suffix) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (!suffix || entry.name.endsWith(suffix)) found.push(full);
    }
  }
  return found.sort();
}

/** 按 <html>/<head>/<body> 切开产物，切不动就报错——宁可不发也不发半个明文页面。 */
function splitDocument(html) {
  const htmlTag = html.match(/<html\b[^>]*>/i);
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const bodyTag = html.match(/<body\b[^>]*>/i);
  const bodyEnd = html.lastIndexOf('</body>');
  if (!htmlTag || !head || !bodyTag || bodyEnd < 0) return null;
  return {
    prefix: html.slice(0, htmlTag.index),
    htmlTag: htmlTag[0],
    headInner: head[1],
    bodyTag: bodyTag[0],
    bodyHtml: html.slice(bodyTag.index + bodyTag[0].length, bodyEnd),
  };
}

/**
 * 锁屏上只显示站点名：文章页是「文章标题 | 站点名」，首页是「站点名 - 副标题」。
 * 取不到就退回整串，宁可显示长一点也不要空着。
 */
function siteTitleFrom(headInner) {
  const match = headInner.match(/<title>([\s\S]*?)<\/title>/i);
  if (!match) return '本站';
  const raw = match[1].trim();
  if (raw.includes(' | ')) {
    const parts = raw.split(' | ');
    return parts[parts.length - 1].trim() || raw;
  }
  if (raw.includes(' - ')) {
    const parts = raw.split(' - ');
    return parts[0].trim() || raw;
  }
  return raw;
}

function buildLockScreen(siteTitle) {
  return [
    '<div class="einblog-gate" id="einblog-gate">',
    '<div class="einblog-gate__card">',
    `<span class="einblog-gate__badge">${LOCK_ICON}</span>`,
    `<h1 class="einblog-gate__title">${escapeHtml(siteTitle)}</h1>`,
    '<p class="einblog-gate__hint">本站内容已加密，请输入访问密码</p>',
    '<form class="einblog-gate__form" id="einblog-gate-form">',
    '<input class="einblog-gate__input" id="einblog-gate-input" type="password" name="password" '
      + 'placeholder="访问密码" autocomplete="current-password" aria-label="访问密码" required>',
    '<button class="einblog-gate__submit" id="einblog-gate-submit" type="submit">解锁</button>',
    '</form>',
    '<label class="einblog-gate__remember"><input type="checkbox" id="einblog-gate-remember" checked> 记住 30 天</label>',
    '<p class="einblog-gate__error" id="einblog-gate-error" role="alert"></p>',
    '</div>',
    '</div>',
  ].join('');
}

const GATE_HEAD_TAGS = '<meta name="robots" content="noindex, nofollow">'
  + `<link rel="stylesheet" href="${GATE_CSS_HREF}">`
  + `<script src="${GATE_SCRIPT_SRC}" defer></script>`;

/** 把一页产物改写成“锁屏 + 密文负载”。 */
function gateHtml(html, key, salt, iterations) {
  const parts = splitDocument(html);
  if (!parts) throw new Error('产物结构不认识（找不到 <html>/<head>/<body>）');

  // head 里的 script 留在页面上就是明文泄漏：Hexo 注入的主题配置脚本（window.config /
  // window.theme）里带着站点标题、侧栏公告、页脚文案这些自己写的字。除明暗模式那支小脚本
  // 外全部搬进密文负载，解锁后拼在正文脚本之前，保证 window.theme 先于 main.js 就位。
  const headScripts = [];
  const headInner = parts.headInner.replace(HEAD_SCRIPT_RE, (block) => {
    if (HEAD_SCRIPT_KEEP_RE.test(block)) return block;
    headScripts.push(block);
    return '';
  });

  // Swup：未解锁的下一页只有锁屏外壳，SPA 切换必然拿不到容器，直接摘掉。
  const bodyHtml = parts.bodyHtml
    .replace(SWUP_LIB_RE, '')
    .replace(SWUP_INIT_RE, '');
  const payloadHtml = headScripts.join('') + bodyHtml;

  const payload = gateCrypto.buildPayload(
    JSON.stringify({ v: 1, bodyHtml: payloadHtml }),
    key,
    salt,
    iterations,
  );

  return {
    result: [
      parts.prefix,
      parts.htmlTag,
      '\n<head>',
      headInner,
      GATE_HEAD_TAGS,
      '</head>\n',
      parts.bodyTag,
      buildLockScreen(siteTitleFrom(parts.headInner)),
      `<script type="application/json" ${PAYLOAD_MARK}>`,
      gateCrypto.serializePayload(payload),
      '</script>\n</body>\n</html>\n',
    ].join(''),
    plainText: payloadHtml,
  };
}

/**
 * 清空正文副本。`paths` 为 null 表示整站模式（所有条目都清），
 * 给定文章路径列表时只清这些条目（逐篇模式：公开文章的 RSS/搜索照旧全文）。
 */
function cleanSearchIndex(xml, paths = null) {
  let replaced = 0;
  const result = xml.replace(/<entry>[\s\S]*?<\/entry>/g, (entry) => {
    if (paths && !paths.some((item) => entry.includes(`<url>${item}</url>`))) return entry;
    const next = entry.replace(SEARCH_CONTENT_RE, '<content><![CDATA[]]></content>');
    if (next !== entry) replaced += 1;
    return next;
  });
  return { result, replaced };
}

function cleanFeed(xml, paths = null) {
  let replaced = 0;
  const result = xml.replace(/<entry>[\s\S]*?<\/entry>/g, (entry) => {
    if (paths && !paths.some((item) => entry.includes(item))) return entry;
    const next = entry.replace(FEED_CONTENT_RE, '$1（正文已加密，请到站点输入访问密码查看）$2');
    if (next !== entry) replaced += 1;
    return next;
  });
  return { result, replaced };
}

function readPrivateManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`逐篇模式缺少私密文章清单 ${manifestPath}：请先跑 hexo generate（scripts/gate-private.js 会写它）`);
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  return posts;
}

function runGateBuild(options = {}) {
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const skipPrefixes = options.skipPrefixes || DEFAULT_SKIP_PREFIXES;
  const log = options.log || (() => {});
  const password = options.password !== undefined ? options.password : process.env.BLOG_GATE_PASSWORD;
  const iterations = options.iterations || gateCrypto.KDF_ITERATIONS;
  const scope = options.scope || process.env.BLOG_GATE_SCOPE || 'site';
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;

  if (!password) {
    log('未设置 BLOG_GATE_PASSWORD：跳过加密，产物保持明文（本地开发/PR 校验的正常路径）');
    return { skipped: true };
  }
  if (!['site', 'posts'].includes(scope)) {
    throw new Error(`BLOG_GATE_SCOPE 只能是 site（整站）或 posts（逐篇），收到：${scope}`);
  }
  if (!fs.existsSync(publicDir)) throw new Error(`产物目录不存在：${publicDir}（先跑 hexo generate）`);

  const salt = options.salt || gateCrypto.readSalt();
  const key = gateCrypto.deriveKey(password, salt, iterations);

  const privatePosts = scope === 'posts' ? readPrivateManifest(manifestPath) : [];
  const lockedFiles = new Set(privatePosts.map((item) => item.file));
  // 条目匹配用两种写法：search.xml 的 <url> 带前导斜杠，atom.xml 的 <id>/<link> 是
  // 绝对地址（去掉前导斜杠去匹配更稳，不必知道站点域名）
  const lockedPaths = privatePosts.map((item) => String(item.url || '').replace(/^\/+/, ''));
  const lockedUrls = lockedPaths.map((item) => `/${item}`);
  if (scope === 'posts' && !privatePosts.length) {
    log('警告：逐篇模式下没有任何文章标记 private: true，本次构建会全站公开');
  }

  const htmlFiles = walkFiles(publicDir, '.html');
  if (!htmlFiles.length) throw new Error(`产物里没有 HTML：${publicDir}`);

  const report = { generatedAt: new Date().toISOString(), scope, pages: [], publicPages: [], assets: [], skipped: [] };

  for (const file of htmlFiles) {
    const relative = path.relative(publicDir, file).split(path.sep).join('/');
    if (skipPrefixes.some((prefix) => relative.startsWith(prefix))) {
      report.skipped.push(relative);
      log(`跳过（不在门内）：${relative}`);
      continue;
    }
    if (scope === 'posts' && !lockedFiles.has(relative)) {
      report.publicPages.push(relative);
      continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    if (html.includes(PAYLOAD_MARK)) {
      throw new Error(`${relative} 已经加密过：请先 hexo clean，否则会把密文再加密一次`);
    }
    const { result, plainText } = gateHtml(html, key, salt, iterations);
    fs.writeFileSync(file, result);
    report.pages.push({
      path: relative,
      plainTextSha256: sha256(plainText),
      cipherTextBytes: Buffer.byteLength(result, 'utf8'),
    });
    log(`已加密：${relative}`);
  }

  if (scope === 'posts') {
    for (const item of privatePosts) {
      if (!htmlFiles.some((file) => path.relative(publicDir, file).split(path.sep).join('/') === item.file)) {
        throw new Error(`清单里的私密文章没有对应产物：${item.file}`);
      }
    }
  }

  const searchPath = path.join(publicDir, 'search.xml');
  if (fs.existsSync(searchPath)) {
    const { result, replaced } = cleanSearchIndex(fs.readFileSync(searchPath, 'utf8'), scope === 'posts' ? lockedUrls : null);
    fs.writeFileSync(searchPath, result);
    report.assets.push({ path: 'search.xml', entries: replaced, note: scope === 'posts' ? '清空私密文章条目的正文' : '清空全部正文' });
    log(`已清空搜索索引正文：search.xml（${replaced} 条）`);
  }

  const feedPath = path.join(publicDir, 'atom.xml');
  if (fs.existsSync(feedPath)) {
    const { result, replaced } = cleanFeed(fs.readFileSync(feedPath, 'utf8'), scope === 'posts' ? lockedPaths : null);
    fs.writeFileSync(feedPath, result);
    report.assets.push({ path: 'atom.xml', entries: replaced, note: scope === 'posts' ? '清空私密文章条目的正文' : '清空全部正文' });
    log(`已清空订阅正文：atom.xml（${replaced} 条）`);
  }

  const robotsPath = path.join(publicDir, 'robots.txt');
  if (fs.existsSync(robotsPath)) {
    // 不改写 robots.txt（编辑台的线上比对会逐字节校验它）；锁屏页靠 head 里的
    // noindex 退出收录，效果一样而且不碰别人的文件。
    report.assets.push({ path: 'robots.txt', note: '保持原样：锁屏页改用 noindex' });
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log(scope === 'posts'
    ? `加密完成（逐篇）：上锁 ${report.pages.length} 个页面，公开 ${report.publicPages.length} 个，报告写入 ${reportPath}`
    : `加密完成（整站）：${report.pages.length} 个页面，报告写入 ${reportPath}`);

  return { skipped: false, report };
}

if (require.main === module) {
  try {
    const outcome = runGateBuild({ log: (message) => console.log(`[gate] ${message}`) });
    if (outcome.skipped) process.exit(0);
  } catch (error) {
    console.error(`[gate] 失败：${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  PAYLOAD_ID,
  PAYLOAD_MARK,
  DEFAULT_SKIP_PREFIXES,
  DEFAULT_MANIFEST_PATH,
  escapeHtml,
  sha256,
  walkFiles,
  splitDocument,
  siteTitleFrom,
  buildLockScreen,
  gateHtml,
  cleanSearchIndex,
  cleanFeed,
  readPrivateManifest,
  runGateBuild,
};
