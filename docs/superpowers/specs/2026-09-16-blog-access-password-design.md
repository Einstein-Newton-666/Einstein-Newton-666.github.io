# 博客访问密码（整站加密）设计

日期：2026-09-16
状态：已实施

## 背景

博客托管在 GitHub Pages，纯静态、无服务端，任何"密码"只能跑在访客浏览器里。
仓库公开时 `source/_posts/*.md` 人人可读，`/atom.xml`（`feed.content: true`）与
`/search.xml`（`search.content: true`）又各自是一份公开全文副本——只把页面挡住
等于没挡。

## 目标

1. 未解锁的访客拿到的 HTML 里没有任何正文；全 `public/` 里搜不到文章文本。
2. 访客输一次密码即可正常浏览（站内跳转、刷新不再追问），解锁状态可记住 30 天。
3. 密码不进仓库：只由 GitHub Actions Secret 在构建期注入。
4. 不设密码的构建（本地开发、PR 校验）行为完全不变。
5. 部署流程缺 Secret 时必须失败，而不是发出一份不设防的站点。

## 非目标

- 不做服务端鉴权：要真正的接入层认证应走 Cloudflare Access + 自有域名，与本站代码无关。
- 不加密静态资源：图片、CSS、JS、`sitemap.xml`、文章标题与 URL slug 仍公开。
- 不保护 `/admin/`：编辑台用 GitHub PAT 认证，门闩跳过它。

## 方案

### 加密发生在 `hexo generate` 之后

`scripts/gate-build.js` 直接改写 `public/` 里的最终文件，而不是注册 Hexo 过滤器。
原因：Hexo 把渲染结果缓存在 `db.json`，过滤器只对"变过的文件"重跑；一旦命中缓存，
密文就被明文覆盖回去，属于最难发现的静默失败。改最终产物与缓存、增量生成都无关。

### 页面结构

每个 HTML 保留 `<head>`（站点配置、主题早期脚本、样式、锁屏需要的 CSS/JS 引用都在这里），
`<body>` 整体加密成负载：

```
<head>…原 head…<link site-gate.css><script site-gate.js defer></head>
<body>锁屏 UI<script type="application/json" id="einblog-gate-payload">{v,kdf,cipher,iv,ct}</script></body>
```

负载明文是 `{"v":1,"bodyHtml":"…原始 body…"}`。

### 加解密参数（`scripts/lib/gate-crypto.js`）

- KDF：PBKDF2-HMAC-SHA256，600000 次，16 字节 salt。
- 加密：AES-256-GCM，12 字节 IV，认证标签附在密文尾部（与 WebCrypto 的布局一致）。
- salt 固定存放在 `scripts/gate-salt.txt`：salt 不需要保密，固定下来才能让访客缓存的
  钥匙在重新部署后继续有效。换密码或换 salt 都会作废已解锁的浏览器。

### 解锁（`source/js/site-gate.js`）

浏览器用 WebCrypto 走同一套 KDF 与解密；GCM 认证失败即"密码不对"。成功后把
`body.innerHTML` 换成解密结果，再按原顺序重建 `<script>` 节点（动态插入的脚本默认
`async`，必须显式关掉才能保住主题脚本的执行顺序）。缓存的钥匙：勾选"记住 30 天"写
localStorage，否则写 sessionStorage；右下角"锁定"按钮清掉钥匙并刷新。

### 门内的取舍

- **摘掉 Swup**：主题的 SPA 切换要拿未解锁的下一页，而那一页只有锁屏外壳，缺 `#swup`
  容器只会报错。带密码构建时移除 Swup 脚本与初始化脚本，导航回到整页加载；
  主题的 `lifecycle.js` 对 `window.swup` 缺失是安全的（会等待事件，不抛错）。
- **搜索与 RSS 退化**：`search.xml` 清空 `<content>`（只留标题与链接），`atom.xml` 的
  正文替换为提示语。公开 XML 里留着正文等于绕过了门。
- **锁屏页加 `noindex`**：全网是同一张锁屏，没有收录价值。刻意不改 `robots.txt`——
  编辑台的 `tools/editor/verify-deploy.mjs` 会拿线上 `robots.txt` 与本地构建逐字节比对，
  改写它等于打坏另一条校验链；`<meta name="robots">` 的效果一样且互不干扰。
- **跳过 `admin/`**：编辑台靠 PAT 认证，与门闩无关。

## 验证

- `test/site-gate-crypto.test.cjs`：Node 加密 → 浏览器模块解密往返；错密码、密文被改动
  必须失败；序列化要转义 `<`。
- `test/gate-build.test.cjs`：临时站点跑加密 → 无明文残留、Swup 被摘、`admin/` 未动、
  XML 已清、二次运行报错、结构不认识时报错。
- `test/verify-gate.mjs`（产物校验）：每个页面都是密文外壳；用密码逐个解回并比对构建
  报告里的 sha256；从各页正文里抽取"只属于正文"的长文本片段，在全 `public/` 里反查，
  命中即判泄漏；锁屏页必须带 `noindex`。
- `tools/gate/e2e-gate.mjs`：真浏览器跑锁屏 → 错密码 → 解锁 → 站内跳转 → 刷新 → 锁定。

## 风险与已知限制

- 密码强度决定一切：密文与 salt 都在公开产物里，弱密码可离线暴破。建议 16 位以上随机串。
- 关闭 JS 只能看到锁屏（预期）。
- 非 HTTPS 且非 localhost 的环境没有 `crypto.subtle`，锁屏会提示改用现代浏览器。
- 提醒：把仓库转私有并不能让站点变私有（GitHub 个人号没有私有 Pages），它解决的是
  "GitHub 上能直接读到 .md 原文"这个泄漏口。
