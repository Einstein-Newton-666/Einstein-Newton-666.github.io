const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gateBuild = require('../scripts/gate-build.js');
const browserGate = require('../source/js/site-gate.js');

const PASSWORD = 'test-password-1234';
const SALT = Buffer.from('0123456789abcdef', 'utf8');
const ITERATIONS = 120000;
const CANARY = '实验室里的安装记录只应该出现在密文里';

function page(title, body) {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    `<head><title>${title} | 测试站点</title><script>window.config = {};</script></head>`,
    `<body><div id="swup"><p>${body}</p></div>`,
    '<script src="https://cdn.example.com/libs/Swup.min.js"></script>',
    '<script src="https://cdn.example.com/libs/SwupScriptsPlugin.min.js"></script>',
    '<script>',
    '    window.swup = new Swup({ containers: ["#swup"] });',
    '</script>',
    '<script src="/js/anime-theme.js"></script>',
    '</body></html>',
    '',
  ].join('\n');
}

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-build-'));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(path.join(publicDir, '2026', '09', '16', 'post'), { recursive: true });
  fs.mkdirSync(path.join(publicDir, 'admin'), { recursive: true });

  fs.writeFileSync(path.join(publicDir, 'index.html'), page('首页', CANARY));
  fs.writeFileSync(path.join(publicDir, '2026', '09', '16', 'post', 'index.html'), page('文章', CANARY));
  fs.writeFileSync(path.join(publicDir, 'admin', 'index.html'), page('编辑台', '编辑台自己用令牌登录'));
  fs.writeFileSync(path.join(publicDir, 'search.xml'),
    '<search><entry><title>文章</title><url>/post/</url>'
    + `<content><![CDATA[<p>${CANARY}</p>]]></content></entry></search>`);
  fs.writeFileSync(path.join(publicDir, 'atom.xml'),
    '<feed><entry><title>文章</title>'
    + `<content type="html">${CANARY}</content></entry></feed>`);
  fs.writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *\nSitemap: https://example.com/sitemap.xml\n');

  return { dir, publicDir, reportPath: path.join(dir, 'output', 'gate-report.json') };
}

function readPayload(file) {
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script type="application\/json" id="einblog-gate-payload">([\s\S]*?)<\/script>/);
  assert.ok(match, `${file} 里没有加密负载`);
  return match[1];
}

test('带密码构建：页面只剩锁屏与密文，正文不再出现在产物里', async () => {
  const site = makeSite();
  const outcome = gateBuild.runGateBuild({
    publicDir: site.publicDir,
    reportPath: site.reportPath,
    password: PASSWORD,
    salt: SALT,
    iterations: ITERATIONS,
  });

  assert.equal(outcome.skipped, false);
  const gated = fs.readFileSync(path.join(site.publicDir, 'index.html'), 'utf8');
  assert.ok(gated.includes('id="einblog-gate-payload"'), '锁屏负载缺失');
  assert.ok(gated.includes('id="einblog-gate-form"'), '锁屏表单缺失');
  assert.ok(gated.includes('/js/site-gate.js') && gated.includes('/css/site-gate.css'), '解锁脚本/样式未注入');
  assert.ok(gated.includes('测试站点'), '锁屏应显示站点标题');
  assert.ok(!gated.includes(CANARY), '明文正文泄漏到了外壳里');

  const payload = browserGate.parsePayload(readPayload(path.join(site.publicDir, 'index.html')));
  const key = await browserGate.deriveKey(PASSWORD, payload);
  const content = await browserGate.decryptPayload(payload, key);

  assert.ok(content.bodyHtml.includes(CANARY), '密文里应该能解出原文');
  assert.ok(!/Swup/.test(content.bodyHtml), 'gated 产物里应摘掉 Swup（SPA 切换拿不到锁屏容器）');
  assert.ok(content.bodyHtml.includes('/js/anime-theme.js'), '其它主题脚本要保留');

  const report = JSON.parse(fs.readFileSync(site.reportPath, 'utf8'));
  assert.equal(report.pages.length, 2, '只应加密非 admin 的页面');
  assert.deepEqual(report.skipped, ['admin/index.html']);
});

test('admin/ 不在门内：编辑台照旧是明文页面', () => {
  const site = makeSite();
  gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: PASSWORD, salt: SALT, iterations: ITERATIONS });

  const admin = fs.readFileSync(path.join(site.publicDir, 'admin', 'index.html'), 'utf8');
  assert.ok(admin.includes('编辑台自己用令牌登录'));
  assert.ok(!admin.includes('einblog-gate-payload'));
});

test('公开全文副本被清空，锁屏页带 noindex 且不动 robots.txt', () => {
  const site = makeSite();
  const robotsBefore = fs.readFileSync(path.join(site.publicDir, 'robots.txt'), 'utf8');
  gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: PASSWORD, salt: SALT, iterations: ITERATIONS });

  const search = fs.readFileSync(path.join(site.publicDir, 'search.xml'), 'utf8');
  assert.ok(!search.includes(CANARY), 'search.xml 里还有正文');
  assert.ok(search.includes('<title>文章</title>'), 'search.xml 应保留标题');

  const feed = fs.readFileSync(path.join(site.publicDir, 'atom.xml'), 'utf8');
  assert.ok(!feed.includes(CANARY), 'atom.xml 里还有正文');
  assert.ok(feed.includes('type="html"'), 'atom.xml 的 content 标签属性应保留');

  const gated = fs.readFileSync(path.join(site.publicDir, 'index.html'), 'utf8');
  assert.ok(gated.includes('<meta name="robots" content="noindex, nofollow">'), '锁屏页应带 noindex');

  // robots.txt 归编辑台的线上逐字节比对管，门闩不许碰它
  assert.equal(fs.readFileSync(path.join(site.publicDir, 'robots.txt'), 'utf8'), robotsBefore);
});

test('重复执行会挡住二次加密', () => {
  const site = makeSite();
  gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: PASSWORD, salt: SALT, iterations: ITERATIONS });

  assert.throws(
    () => gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: PASSWORD, salt: SALT, iterations: ITERATIONS }),
    /已经加密过/,
  );
});

test('报告里的明文哈希与解出来的正文一致', async () => {
  const site = makeSite();
  gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: PASSWORD, salt: SALT, iterations: ITERATIONS });

  const report = JSON.parse(fs.readFileSync(site.reportPath, 'utf8'));
  for (const entry of report.pages) {
    const payload = browserGate.parsePayload(readPayload(path.join(site.publicDir, entry.path)));
    const key = await browserGate.deriveKey(PASSWORD, payload);
    const content = await browserGate.decryptPayload(payload, key);
    assert.equal(gateBuild.sha256(content.bodyHtml), entry.plainTextSha256, `${entry.path} 的哈希对不上`);
  }
});

test('没有密码时整脚本跳过，产物保持明文', () => {
  const site = makeSite();
  const outcome = gateBuild.runGateBuild({ publicDir: site.publicDir, reportPath: site.reportPath, password: '' });

  assert.equal(outcome.skipped, true);
  assert.ok(fs.readFileSync(path.join(site.publicDir, 'index.html'), 'utf8').includes(CANARY));
  assert.ok(!fs.existsSync(site.reportPath), '跳过时不应写报告');
});

test('产物结构不认识时报错，不静默放过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-build-bad-'));
  fs.writeFileSync(path.join(dir, 'broken.html'), '<p>没有 html 骨架</p>');

  assert.throws(
    () => gateBuild.runGateBuild({ publicDir: dir, reportPath: path.join(dir, 'report.json'), password: PASSWORD, salt: SALT, iterations: ITERATIONS }),
    /结构不认识/,
  );
});
