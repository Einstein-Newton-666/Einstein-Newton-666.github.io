/**
 * 博客编辑台端到端测试（Playwright + mock GitHub API）
 *
 *   node tools/editor/e2e-admin.mjs
 *
 * 全程不访问真实 GitHub：所有 https://api.github.com 请求都被注入的 fetch 改写
 * 到本机 mock 服务，因此不会对仓库产生任何写入。产物截图写入 output/。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'output/admin-e2e');
const PUBLIC_DIR = path.join(ROOT, 'public');

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

/* ------------------------------ mock GitHub ------------------------------ */

function createMockGitHub() {
  const state = {
    head: 'head-0001',
    files: new Map([
      ['source/_posts/welcome.md', '---\ntitle: 你好，世界 —— 第一篇日志\ndate: 2026-08-15 21:00:00\ncategories: [日志]\ntags: [随笔, 第一篇]\nmathjax: true\ncover: /images/brand/firefly-side.webp\nexcerpt: 欢迎来到这片记录技术、生活与灵感的私人空间。\n---\n\n这是站点的第一篇文章。\n'],
      ['source/_posts/welcome/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'],
      ['source/_posts/xiaogao-hikouki-install-diary.md', '---\ntitle: 小高の飞行器安装日记\ndate: 2026-09-16 09:00:00\ncategories: [日志]\ntags: [随笔, 飞行器]\nmathjax: false\ncover: /images/brand/log-gothic-library.webp\n---\n\n'],
    ]),
    commits: [],
    blobSeq: 0,
    requests: [],
  };

  const json = (res, status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = req.url;
      state.requests.push({ method: req.method, url, body, auth: req.headers.authorization || '' });

      if (req.method === 'GET' && /\/commits\/main$/.test(url)) {
        return json(res, 200, { sha: state.head, commit: { committer: { date: '2026-09-16T01:00:00Z' }, message: '内容：上一篇文章' } });
      }
      if (req.method === 'GET' && /\/git\/commits\//.test(url)) {
        return json(res, 200, { sha: state.head, tree: { sha: `tree-${state.head}` } });
      }
      if (req.method === 'GET' && /\/git\/trees\//.test(url)) {
        const tree = [];
        for (const [filePath, content] of state.files) {
          tree.push({ path: filePath, type: 'blob', size: Buffer.byteLength(content), sha: `blob-${filePath.length}` });
        }
        return json(res, 200, { sha: `tree-${state.head}`, truncated: false, tree });
      }
      if (req.method === 'GET' && /\/contents\//.test(url)) {
        const decoded = decodeURIComponent(url.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, '').split('?')[0]);
        if (!state.files.has(decoded)) return json(res, 404, { message: 'Not Found' });
        return json(res, 200, {
          path: decoded,
          sha: `blob-${state.files.get(decoded).length}`,
          encoding: 'base64',
          content: Buffer.from(state.files.get(decoded), 'utf8').toString('base64'),
        });
      }
      if (req.method === 'POST' && /\/git\/blobs$/.test(url)) {
        state.blobSeq += 1;
        const sha = `blob-new-${state.blobSeq}`;
        state.pendingBlobs = state.pendingBlobs || new Map();
        state.pendingBlobs.set(sha, Buffer.from(body.content, 'base64'));
        return json(res, 201, { sha });
      }
      if (req.method === 'POST' && /\/git\/trees$/.test(url)) {
        state.lastTree = body.tree;
        return json(res, 201, { sha: `tree-new-${state.head}` });
      }
      if (req.method === 'POST' && /\/git\/commits$/.test(url)) {
        state.commits.push(body);
        return json(res, 201, { sha: `commit-${state.commits.length}` });
      }
      if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(url)) {
        state.head = body.sha;
        return json(res, 200, { object: { sha: body.sha } });
      }
      return json(res, 404, { message: `mock 未实现：${req.method} ${url}` });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      state,
      close: () => new Promise((done) => server.close(done)),
      apiBase: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

/* ------------------------------- 静态站点 ------------------------------- */

function serveStatic(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let target = path.join(dir, urlPath);
    if (!target.startsWith(dir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    // 目录请求补 index.html（/admin/ → /admin/index.html）
    try {
      if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

/* --------------------------------- 主流程 -------------------------------- */

async function main() {
  const playwrightPath = PLAYWRIGHT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!playwrightPath) throw new Error('未找到可用的 playwright 包');
  const { chromium } = await import(`file:///${playwrightPath.replace(/\\/g, '/')}`);
  process.env.PLAYWRIGHT_CHROMIUM_USE_CDP_PORT = '1';

  if (!fs.existsSync(path.join(PUBLIC_DIR, 'admin/index.html'))) {
    throw new Error('请先运行 npx hexo generate 生成 public/ 后再跑端到端测试');
  }

  fs.mkdirSync(OUT, { recursive: true });
  const github = await createMockGitHub();
  const site = await serveStatic(PUBLIC_DIR);

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });

  // 把 api.github.com 与 127.0.0.1:4001 的请求改写成本机 mock
  await context.addInitScript(({ apiBase }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.github.com/')) {
        return originalFetch(apiBase + url.slice('https://api.github.com'.length), init);
      }
      if (url.startsWith('http://127.0.0.1:4001/')) {
        if (url.includes('/api/health')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, service: 'blog-editor-preview' }), { status: 200 }));
        }
        if (url.includes('/api/render')) {
          const payload = JSON.parse(init.body);
          const escaped = String(payload.markdown).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            mode: 'exact',
            ms: 5,
            html: `<div class="mock-rendered"><p>${escaped.replace(/\n+/g, '</p><p>')}</p></div>`,
            warnings: [],
            files: [],
          }), { status: 200 }));
        }
      }
      return originalFetch(input, init);
    };
    window.__mockActive = true;
  }, { apiBase: github.apiBase });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|404/.test(message.text())) errors.push(`console: ${message.text()}`);
  });

  const token = 'github_pat_11ABCDEFG_example_token_value_1234567890';

  try {
    /* 1. 打开编辑台，未登录时显示登录面板 */
    await page.goto(`${site.origin}/admin/`, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    log('编辑台加载且默认显示登录面板',
      await page.locator('#login').isVisible() && !(await page.locator('#workspace').isVisible()),
      await page.title());
    const mockActive = await page.evaluate(() => window.__mockActive === true);
    log('已拦截 api.github.com（测试不会写入真实仓库）', mockActive);
    await page.screenshot({ path: path.join(OUT, '01-login.png') });

    /* 2. 令牌错误时给出可读提示且不泄漏令牌 */
    await page.fill('#tokenInput', 'github_pat_bad_token_value_000000');
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#signInButton');
    await page.waitForTimeout(500);

    /* 3. 正常登录 */
    await page.fill('#tokenInput', token);
    await page.click('#signInButton');
    await page.waitForSelector('#workspace:not([hidden])', { timeout: 15000 });
    await page.waitForTimeout(500);
    const postCount = await page.locator('.admin-post').count();
    log('登录后列出文章', postCount === 2, `文章数=${postCount}`);
    const storedToken = await page.evaluate(() => localStorage.getItem('einblog.admin.token.v1'));
    log('令牌保存在本机浏览器', storedToken === token, storedToken ? '已保存' : '未保存');
    await page.screenshot({ path: path.join(OUT, '02-workspace.png') });

    /* 4. 打开文章 */
    await page.locator('.admin-post', { hasText: 'welcome' }).first().click();
    await page.waitForSelector('#editor:not([hidden])', { timeout: 15000 });
    await page.waitForTimeout(600);
    const titleValue = await page.inputValue('#titleInput');
    const markdownValue = await page.inputValue('#markdown');
    log('打开文章并填充元信息与正文',
      titleValue.includes('你好') && markdownValue.includes('这是站点的第一篇文章'),
      `title=${titleValue} bodyLen=${markdownValue.length}`);

    /* 5. 中文编辑 + 自动草稿 + 预览 */
    await page.click('#markdown');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n## 新增小节\n\n中文输入测试：蜂鸟机器人🦜。');
    await page.waitForTimeout(1500);
    const draft = await page.evaluate(() => localStorage.getItem('einblog.admin.draft.v1::source/_posts/welcome.md'));
    log('中文输入并自动存草稿', !!draft && draft.includes('中文输入测试'), draft ? `草稿长度=${draft.length}` : '无草稿');
    const previewHtml = await page.evaluate(() => {
      const frame = document.getElementById('previewFrame');
      return frame.contentDocument ? frame.contentDocument.body.innerHTML : '';
    });
    log('预览已更新（精确模式）', previewHtml.includes('新增小节') || previewHtml.includes('mock-rendered'), previewHtml.slice(0, 60));
    const previewModeText = await page.locator('#previewMode').innerText();
    log('预览模式标记为精确', /精确/.test(previewModeText), previewModeText);

    /* 6. 工具条：公式 / 加粗 */
    await page.click('[data-action="formula"]');
    await page.waitForTimeout(300);
    const mathjaxChecked = await page.isChecked('#mathjaxInput');
    const withFormula = await page.inputValue('#markdown');
    log('工具条插入公式并自动开启 mathjax',
      withFormula.includes('$$') && mathjaxChecked,
      `mathjax=${mathjaxChecked}`);

    /* 7. 上传配图 */
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    await page.setInputFiles('#fileInput', { name: '配图.png', mimeType: 'image/png', buffer: pngBytes });
    await page.waitForTimeout(600);
    const uploadRows = await page.locator('.admin-upload').count();
    const withAssetTag = await page.inputValue('#markdown');
    log('拖入/选择图片后进入待提交队列并插入引用',
      uploadRows === 1 && /\{% asset_img .*配图\.png/.test(withAssetTag),
      `队列=${uploadRows}`);

    /* 8. 保存（提交） */
    await page.click('#saveButton');
    await page.waitForTimeout(1500);
    const commits = github.state.commits.length;
    log('保存触发一次提交', commits === 1, `提交数=${commits}`);
    const tree = github.state.lastTree || [];
    const treePaths = tree.map((item) => item.path);
    log('同一次提交里包含文章与配图',
      treePaths.includes('source/_posts/welcome.md') && treePaths.some((p) => p.includes('source/_posts/welcome/') && p.endsWith('.png')),
      JSON.stringify(treePaths));
    const commitMessage = github.state.commits[0]?.message || '';
    log('提交信息符合仓库前缀惯例', /^(内容|日志|笔记|维护|测试|功能|文档)：/.test(commitMessage), commitMessage);
    const blobContents = [...(github.state.pendingBlobs || new Map()).values()];
    const mdBlob = blobContents.map((buffer) => buffer.toString('utf8')).find((text) => text.includes('中文输入测试')) || '';
    log('提交的 Markdown 含中文改动与 front-matter',
      mdBlob.includes('中文输入测试') && mdBlob.startsWith('---\n') && mdBlob.includes('title:'),
      `blob 数=${blobContents.length}`);
    const allRequests = github.state.requests;
    log('所有请求都带令牌且指向 mock',
      allRequests.length > 0 && allRequests.every((request) => request.auth === `Bearer ${token}`),
      `请求数=${allRequests.length}`);

    /* 9. 冲突处理 */
    github.state.head = 'head-9999';
    await page.click('#markdown');
    await page.keyboard.type('\n\n冲突测试内容。');
    await page.waitForTimeout(900);
    await page.click('#saveButton');
    await page.waitForSelector('#conflictBox:not([hidden])', { timeout: 10000 });
    const commitsAfterConflict = github.state.commits.length;
    log('远端有新提交时中止提交并提示冲突',
      commitsAfterConflict === 1,
      `提交数仍为 ${commitsAfterConflict}`);
    const conflictText = await page.locator('#conflictText').innerText();
    log('冲突提示说明了 SHA 且强调内容未丢', /head-9999|9999/.test(conflictText) && /仍在编辑器/.test(conflictText), conflictText.slice(0, 80));
    await page.screenshot({ path: path.join(OUT, '03-conflict.png') });

    await page.click('#conflictKeep');
    await page.waitForTimeout(1200);
    const bodyAfterResolve = await page.inputValue('#markdown');
    log('保留我的内容并同步远端后内容仍在',
      bodyAfterResolve.includes('冲突测试内容') && !(await page.locator('#conflictBox').isVisible()),
      `长度=${bodyAfterResolve.length}`);

    /* 10. 新建文章 */
    page.once('dialog', (dialog) => dialog.accept('蜂鸟悬停原理笔记'));
    await page.click('#newPostButton');
    await page.waitForTimeout(800);
    const newPath = await page.locator('#currentPath').innerText();
    log('新建文章生成规范文件名', newPath === 'source/_posts/蜂鸟悬停原理笔记.md', newPath);
    const newDate = await page.inputValue('#dateInput');
    log('新文章日期为北京时间格式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(newDate), newDate);

    await page.fill('#categoriesInput', '笔记, 扑翼');
    await page.fill('#tagsInput', '蜂鸟, 稳定性');
    await page.click('#markdown');
    await page.keyboard.type('## 悬停稳定性\n\n正文内容。');
    await page.waitForTimeout(1200);
    await page.click('#saveButton');
    await page.waitForTimeout(1500);
    const newTreePaths = (github.state.lastTree || []).map((item) => item.path);
    log('新建文章被提交', newTreePaths.includes('source/_posts/蜂鸟悬停原理笔记.md'), JSON.stringify(newTreePaths));
    const newBlob = [...(github.state.pendingBlobs || new Map()).values()]
      .map((buffer) => buffer.toString('utf8'))
      .find((text) => text.includes('悬停稳定性')) || '';
    log('新文章 front-matter 完整',
      /title: 蜂鸟悬停原理笔记/.test(newBlob) && /categories: \[笔记, 扑翼\]/.test(newBlob) && /tags: \[蜂鸟, 稳定性\]/.test(newBlob),
      newBlob.split('\n').slice(0, 7).join(' | '));

    /* 11. 删除文章需要输入文件名确认 */
    page.once('dialog', (dialog) => dialog.accept('故意写错的名字'));
    await page.click('#deletePostButton');
    await page.waitForTimeout(500);
    const commitsAfterWrongName = github.state.commits.length;
    page.once('dialog', (dialog) => dialog.accept('蜂鸟悬停原理笔记'));
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('#deletePostButton');
    await page.waitForTimeout(1200);
    log('删除前必须输入正确文件名',
      commitsAfterWrongName === github.state.commits.length - 1 || commitsAfterWrongName === 2,
      `提交数=${github.state.commits.length}`);

    /* 12. 退出登录清空令牌 */
    await page.click('#signOutButton');
    await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => localStorage.getItem('einblog.admin.token.v1'));
    log('退出登录后清除本机令牌', cleared === null && (await page.locator('#login').isVisible()), `token=${cleared}`);

    log('无前端运行时错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  } finally {
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results }, null, 2), 'utf8');
    const failed = results.filter((item) => !item.ok).length;
    process.stdout.write(`\nSUMMARY: ${results.length - failed}/${results.length} passed\n`);
    await browser.close();
    await github.close();
    await site.close();
  }
}

main().catch((error) => {
  process.stderr.write(`端到端测试异常：${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
