/**
 * 访问密码门闩的端到端测试（Playwright + 本机 Edge）
 *
 *   $env:BLOG_GATE_PASSWORD='…'; $env:BLOG_GATE_SCOPE='posts'; npm run gate:build
 *   npm run e2e:gate
 *
 * 前置：先跑过 `npm run gate:build`（产物已加密）。范围从构建报告里读：
 *   - site ：首页就该是锁屏；
 *   - posts：首页必须原样公开，只有清单里的文章是锁屏。
 * 全程只访问本机 public/ 静态服务，断言不依赖 CDN 是否可达。截图写入 output/gate-e2e/。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'output', 'gate-e2e');
const PUBLIC_DIR = path.join(ROOT, 'public');
const REPORT_PATH = path.join(ROOT, 'output', 'gate-report.json');
const MANIFEST_PATH = path.join(ROOT, 'output', 'private-posts.json');
const PASSWORD = process.env.BLOG_GATE_PASSWORD;
const PUBLIC_POST_PATH = '/2026/08/15/welcome/';

const PLAYWRIGHT_CANDIDATES = [
  'C:/Users/Lenovo/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs',
  'C:/Users/Lenovo/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs',
];

const results = [];
function log(step, ok, detail = '') {
  results.push({ step, ok: !!ok, detail: String(detail) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} :: ${step} :: ${detail}\n`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!PASSWORD) {
  console.error('需要 BLOG_GATE_PASSWORD：必须与 gate:build 用的是同一个密码');
  process.exit(1);
}
if (!fs.existsSync(REPORT_PATH)) {
  console.error('缺少 output/gate-report.json：先跑 npm run gate:build');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const scope = report.scope || 'site';
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : { posts: [] };
const privateUrl = scope === 'posts' && manifest.posts.length ? manifest.posts[0].url : null;

if (scope === 'posts' && !privateUrl) {
  console.error('逐篇模式但清单里没有私密文章：先给文章加 private: true 再构建');
  process.exit(1);
}

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (fs.existsSync(candidate)) return (await import(`file:///${candidate.replace(/\\/g, '/')}`)).chromium;
  }
  throw new Error(`找不到 playwright：${PLAYWRIGHT_CANDIDATES.join(' 或 ')}`);
}

function servePublic() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let target = path.join(PUBLIC_DIR, urlPath);
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    } catch {
      res.writeHead(404).end('404');
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404).end('404');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const visible = (page, selector) => page.locator(selector).isVisible().catch(() => false);
const count = (page, selector) => page.locator(selector).count();

const server = await servePublic();
const origin = `http://127.0.0.1:${server.address().port}`;
fs.mkdirSync(OUT, { recursive: true });

const chromium = await loadPlaywright();
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();

try {
  console.log(`\n范围：${scope}${privateUrl ? `，私密文章 ${privateUrl}` : ''}\n`);

  if (scope === 'site') {
    /* 整站模式：首页就该是锁屏 */
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    log('打开首页先看到锁屏', await visible(page, '#einblog-gate'));
    log('锁屏状态下没有主题正文容器', (await count(page, '#swup')) === 0);
    await page.screenshot({ path: path.join(OUT, '01-locked.png') });

    await page.fill('#einblog-gate-input', 'definitely-wrong-password');
    await page.click('#einblog-gate-submit');
    await page.waitForTimeout(1500);
    log('错误密码给出提示', /密码不对/.test((await page.locator('#einblog-gate-error').textContent()) || ''));
    log('错误密码后仍然锁着', (await count(page, '#swup')) === 0);
    await page.screenshot({ path: path.join(OUT, '02-wrong-password.png') });

    await page.fill('#einblog-gate-input', PASSWORD);
    await page.click('#einblog-gate-submit');
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('正确密码解锁首页', (await count(page, '#einblog-gate')) === 0);
    await page.screenshot({ path: path.join(OUT, '03-unlocked.png') });

    await page.goto(`${origin}${PUBLIC_POST_PATH}`, { waitUntil: 'load' });
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('站内跳转免二次输入密码', (await count(page, '#einblog-gate')) === 0);
    log('文章页正文已渲染', (await count(page, '.article-content')) > 0);
    await page.screenshot({ path: path.join(OUT, '04-post.png') });

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('刷新后仍然解锁', (await count(page, '#einblog-gate')) === 0);

    await page.click('#einblog-lock');
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    log('点锁定后回到锁屏', await visible(page, '#einblog-gate'));
    await page.screenshot({ path: path.join(OUT, '05-relocked.png') });
  } else {
    /* 逐篇模式：公开页面必须原样公开 */
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('首页保持公开（没有锁屏）', (await count(page, '#einblog-gate')) === 0);
    log('首页列出私密文章标题', (await count(page, `text=${manifest.posts[0].title}`)) > 0);
    log('首页只显示加密占位摘要', (await count(page, 'text=本文已加密')) > 0);
    await page.screenshot({ path: path.join(OUT, 'posts-01-home-public.png') });

    await page.goto(`${origin}${PUBLIC_POST_PATH}`, { waitUntil: 'load' });
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('公开文章页保持公开', (await count(page, '#einblog-gate')) === 0);
    log('公开文章正文正常渲染', (await count(page, '.article-content')) > 0);

    await page.goto(`${origin}${privateUrl}`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    log('私密文章显示锁屏', await visible(page, '#einblog-gate'));
    log('锁屏下没有正文容器', (await count(page, '#swup')) === 0);
    await page.screenshot({ path: path.join(OUT, 'posts-02-private-locked.png') });

    await page.fill('#einblog-gate-input', 'definitely-wrong-password');
    await page.click('#einblog-gate-submit');
    await page.waitForTimeout(1500);
    log('错误密码给出提示', /密码不对/.test((await page.locator('#einblog-gate-error').textContent()) || ''));

    await page.fill('#einblog-gate-input', PASSWORD);
    await page.click('#einblog-gate-submit');
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('正确密码解锁私密文章', (await count(page, '#einblog-gate')) === 0);
    log('解锁后正文已渲染', (await count(page, '.article-content')) > 0);
    await page.screenshot({ path: path.join(OUT, 'posts-03-private-unlocked.png') });

    await page.goto(`${origin}${privateUrl}`, { waitUntil: 'load' });
    await page.waitForSelector('#swup', { timeout: 20000 });
    log('重访私密文章免二次输入密码', (await count(page, '#einblog-gate')) === 0);

    await page.click('#einblog-lock');
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    log('点锁定后回到锁屏', await visible(page, '#einblog-gate'));
    await page.screenshot({ path: path.join(OUT, 'posts-04-relocked.png') });
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((item) => !item.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} 通过，截图在 output/gate-e2e/\n`);
process.exit(failed.length ? 1 : 0);
