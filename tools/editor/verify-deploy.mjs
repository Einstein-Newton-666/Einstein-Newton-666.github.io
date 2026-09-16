/**
 * 部署后验证：确认线上同时具备「加密门」与「新版编辑台」
 *
 *   node tools/editor/verify-deploy.mjs [baseUrl]
 *
 * 纯 HTTP，不启动浏览器。
 */
const BASE = (process.argv[2] || 'https://einstein-newton-666.github.io').replace(/\/+$/, '');

async function fetchText(path, attempts = 4) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const response = await fetch(`${BASE}${path}`, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
      const text = await response.text();
      return { status: response.status, text };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * i));
    }
  }
  throw lastError;
}

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

console.log(`\n验证目标：${BASE}\n`);

// 1. 编辑台：应包含令牌预填链接，且不含加密门代码
const admin = await fetchText('/admin/');
record('编辑台可访问', admin.status === 200, `HTTP ${admin.status}`);
record('编辑台含令牌预填链接（本次新功能）', /id="tokenLink"/.test(admin.text));
record('编辑台仍为明文（未被加密门处理）', /id="signInButton"/.test(admin.text) && !/einblog-gate|site-gate/.test(admin.text));
record('编辑台含移动端标签切换', /id="tabPreview"/.test(admin.text));

// 2. 首页：应已被加密门处理（能反证 BLOG_GATE_PASSWORD 配置正确）
const home = await fetchText('/');
record('首页可访问', home.status === 200, `HTTP ${home.status}`);
const gated = /einblog-gate|site-gate/.test(home.text);
record('首页已套用加密门（证明 Secret 配置成功）', gated);
// 注意：站点 description / og:description 属于站点元信息，加密门不处理（也不需要）。
// 这里只断言「文章内容」没有以明文出现。
const contentLeaks = ['这是站点的第一篇文章', '你好，世界', '小高の飞行器安装日记'].filter((marker) => home.text.includes(marker));
record('首页不含文章内容明文', contentLeaks.length === 0, contentLeaks.length ? `泄漏：${contentLeaks.join('、')}` : '');

// 3. 文章页也应加密
const post = await fetchText('/2026/08/15/welcome/');
record('文章页已加密', /einblog-gate|site-gate/.test(post.text) && !/这是站点的第一篇文章/.test(post.text));

// 4. 收录控制
const robots = await fetchText('/robots.txt');
record('robots 仍禁止收录 /admin/', /Disallow:\s*\/admin\//.test(robots.text));

console.log('');
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`结果：${checks.length - failed.length}/${checks.length} 通过`);
  for (const item of failed) console.error(`  ✗ ${item.name}`);
  console.log('\n若「首页已套用加密门」失败：多半是 BLOG_GATE_PASSWORD Secret 没配好，或 Actions 仍在构建中。');
  console.log(`可到 https://github.com/Einstein-Newton-666/Einstein-Newton-666.github.io/actions 查看日志。\n`);
  process.exit(1);
}
console.log(`结果：全部 ${checks.length} 项通过 —— 加密门与新版编辑台均已上线\n`);
