# 博客访问密码（整站 / 逐篇加密）设计

日期：2026-09-16
状态：已实施

## 背景

博客托管在 GitHub Pages，纯静态、无服务端，任何"密码"只能跑在访客浏览器里。
仓库公开时 `source/_posts/*.md` 人人可读，`/atom.xml`（`feed.content: true`）与
`/search.xml`（`search.content: true`）又各自是一份公开全文副本——只把页面挡住
等于没挡。

## 目标

1. 未解锁的访客拿到的 HTML 里没有任何正文；全 `public/` 里搜不到这些正文的文本。
2. 访客输一次密码即可正常浏览（站内跳转、刷新不再追问），解锁状态可记住 30 天。
3. 密码不进仓库：只由 GitHub Actions Secret 在构建期注入。
4. 不设密码的构建（本地开发、PR 校验）行为完全不变。
5. 部署流程缺 Secret 时必须失败，而不是发出一份不设防的站点。
6. 支持两种范围：整站上锁，或只锁 front-matter 标了 `private: true` 的文章（公开博客
   + 少量私密日记）。

## 非目标

- 不做服务端鉴权：要真正的接入层认证应走 Cloudflare Access + 自有域名，与本站代码无关。
- 不加密静态资源：图片、CSS、JS、`sitemap.xml`、文章标题与 URL slug 仍公开。
- 不保护 `/admin/`：编辑台用 GitHub PAT 认证，门闩跳过它。

## 范围（`BLOG_GATE_SCOPE`）

| 值 | 上锁对象 | RSS / 搜索索引 |
|---|---|---|
| `site`（默认，fail-closed） | 除 `admin/` 外每个页面 | 清空全部条目正文 |
| `posts` | 清单里的文章页 | 只清这些条目的正文 |

范围是**显式开关**，不从"有没有私密文章"推断：否则哪天漏打标记就会静默变成全站公开。
逐篇模式的实现要点：

- 文章在 front-matter 写 `private: true`；`scripts/gate-private.js` 在 `after_post_render`
  把它的 `excerpt` 换成占位符——Redefine 的首页卡片是"excerpt 有值就渲染 excerpt，
  否则截断 content"，占位符顺手堵死了"正文被截一段贴到首页"这条泄漏路径。
  改在 `after_post_render` 而不是 `before_generate`：后者拿到的文档是即时水合的副本，
  改写模板读不到（实测摘要照旧为空）。
- 同一脚本在 `before_generate` 用 Hexo 自己算出的 `post.path` 写出清单
  `output/private-posts.json`，构建脚本据此决定哪些产物上锁、清哪些 XML 条目。
- 逐篇模式下标题**按设计保留**（首页/归档/分类/标签仍能看到），只有正文与摘要被保护，
  上锁页面同样带 `noindex`；公开页面不加 `noindex`，照旧可被收录。

## 方案

### 加密发生在 `hexo generate` 之后

`scripts/gate-build.js` 直接改写 `public/` 里的最终文件，而不是注册 Hexo 过滤器。
原因：Hexo 把渲染结果缓存在 `db.json`，过滤器只对"变过的文件"重跑；一旦命中缓存，
密文就被明文覆盖回去，属于最难发现的静默失败。改最终产物与缓存、增量生成都无关。

### 页面结构

每个 HTML 保留 `<head>` 里的元数据（`<title>`、meta、样式与脚本引用），`<body>` 整体加密成负载。
`<head>` 里的 `<script>` 也必须一起进密文——Hexo 注入的主题配置脚本（`window.config` /
`window.theme`）里带着站点标题、侧栏公告、页脚文案这些自己写的字，留在页面上就是明文泄漏。
唯一的例外是决定明暗模式的那支小脚本（`REDEFINE-THEME-STATUS`）：锁屏配色要用它，
内容是纯逻辑不含站点文案，留在 head。搬进负载的 head 脚本在解锁后拼在正文脚本之前执行，
保证 `window.theme` 先于主题 `main.js` 就位。

```
<head>…原 meta/样式… <script 明暗模式> <link site-gate.css><script site-gate.js defer></head>
<body>锁屏 UI<script type="application/json" id="einblog-gate-payload">{v,kdf,cipher,iv,ct}</script></body>
```

负载明文是 `{"v":1,"bodyHtml":"…head 脚本 + 原始 body…"}`。

### 加解密参数（`scripts/lib/gate-crypto.js`）

- KDF：PBKDF2-HMAC-SHA256，600000 次，16 字节 salt。
- 加密：AES-256-GCM，12 字节 IV，认证标签附在密文尾部（与 WebCrypto 的布局一致）。
- salt 固定存放在 `scripts/lib/gate-salt.js`：salt 不需要保密，固定下来才能让访客缓存的
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
- `test/gate-build.test.cjs`：临时站点跑加密（两种范围都测）→ 无明文残留、Swup 被摘、
  `admin/` 未动、XML 按范围清理、二次运行报错、结构不认识/清单缺失/范围写错时报错。
- `test/gate-private.test.cjs`：`private` 标记识别、`post.path` → 产物路径与 URL、
  摘要占位符只覆盖私密文章、清单格式。
- `test/verify-gate.mjs`（产物校验）：按报告里的范围检查——该锁的都是密文外壳，
  逐篇模式下公开页面必须**没有**负载也没有 `noindex`；用密码逐个解回并比对构建报告里的
  sha256；私密正文片段（逐篇模式只取文章正文容器内的文本，避开导航/页脚）在全 `public/`
  里反查，命中即判泄漏。
- `tools/gate/e2e-gate.mjs`：真浏览器按范围跑——整站模式验证首页锁屏与解锁全流程；
  逐篇模式验证首页/公开文章照旧公开、私密文章锁屏 → 错密码 → 解锁 → 重访免输入 → 锁定。

## 风险与已知限制

- 密码强度决定一切：密文与 salt 都在公开产物里，弱密码可离线暴破。建议 16 位以上随机串。
- 关闭 JS 只能看到锁屏（预期）。
- 非 HTTPS 且非 localhost 的环境没有 `crypto.subtle`，锁屏会提示改用现代浏览器。
- 提醒：把仓库转私有并不能让站点变私有（GitHub 个人号没有私有 Pages），它解决的是
  "GitHub 上能直接读到 .md 原文"这个泄漏口。
