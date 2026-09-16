# Einstein-Newton-666 的博客

个人日志与技术笔记站点，基于 Hexo + Redefine 主题，由 GitHub Actions 自动部署。站点提供本地搜索、明暗模式、Atom RSS、文章字数与阅读时间，并使用本地托管的二次元插画增强首页视觉。

## 写作与发布

1. 在 `source/_posts/` 下新建文章文件 `my-post.md`：

   ```markdown
   ---
   title: 文章标题
   date: 2026-08-15 21:00:00
   categories: [笔记]
   tags: [标签1, 标签2]
   mathjax: false
   cover: /images/brand/文章封面.webp
   ---

   正文……
   ```

2. 文章内图片放在与文章同名的文件夹 `source/_posts/my-post/` 中，正文用 `{% asset_img 文件名.svg "描述" %}` 引用。
3. 包含公式的文章将 `mathjax` 改为 `true`，公式使用 `$...$`（行内）和 `$$...$$`（整行）。
4. 需要显示“更新于”时在文章头部写 `updated: 2026-09-10 20:00:00`。站点使用 `updated_option: date`，
   只读取 front-matter，不会因为重新部署把全部文章的更新日期刷成构建时间。
5. 首页封面放在 `source/images/brand/` 或其他 `source/` 子目录，并在 `cover` 中填写以 `/` 开头的站内路径。
6. 提交并推送到 `main` 分支，GitHub Actions 会自动构建并发布；PR 也会跑同一套测试。

本地预览（可选，需 Node）：

```bash
npm ci
npm test
npm run server
```

浏览器打开 `http://localhost:4000/`。关于页位于 `/about/`，Atom 订阅地址为 `/atom.xml`，
站点地图为 `/sitemap.xml`（由 `hexo-generator-sitemap` 生成，`_config.yml` 的 `sitemap` 段控制），
`/robots.txt` 与 `/404.html` 分别是 `source/robots.txt` 和 `source/404.md`。
新增页面若不希望被收录，在该页 front-matter 写 `sitemap: false`。

## 在线写作（/admin/）

站点内置一个浏览器编辑台，部署后访问 <https://einstein-newton-666.github.io/admin/> 即可写作，
不需要本地环境，也不依赖任何第三方服务：编辑器直接调用 GitHub API 把改动提交到 `main`，
再由 Actions 自动构建发布。**`/admin/` 不在整站密码门内**（见 `scripts/gate-build.js` 的
`DEFAULT_SKIP_PREFIXES`）：它自己用 GitHub 令牌鉴权，被加密反而无法使用。

### 首次使用：两步拿到令牌

1. 打开 `/admin/`，点 **「① 在 GitHub 上生成令牌（权限已预填）」**。
   这个链接用 GitHub 的模板 URL 参数预填了令牌名称、说明与 `Contents: Read and write` 权限；
   你只需再选 **Only select repositories** 并勾选本博客仓库，然后点 **Generate token**。
2. 把生成的令牌粘贴到 **「② 把生成的令牌粘贴到这里」**，点登录。

手机浏览器同样适用：粘贴一次后浏览器会记住，不必每次登录。

> 为什么不能直接用"用 GitHub 登录"？那需要后台保管 `client_secret` 来换取访问令牌，
> 而本站是 GitHub Pages 上的纯静态站点，没有后台；把密钥放进公开页面等于公开泄漏。
> 令牌权限随时可在 GitHub 上撤销，风险可控。
>
> 若 `github.com` 被你的网络阻断导致上面的按钮打不开，可换手机流量或换网络生成令牌；
> 编辑台本身只要能访问 `api.github.com` 就能用（两者解析的路由不一定相同）。

令牌只保存在浏览器 localStorage，所有请求直接发往 `api.github.com`，不经过本站或任何中间服务。

### 从文章页一键跳到编辑台

每篇文章页右侧的悬浮工具条（与"目录/评论"同一排）有一个**铅笔按钮**，点它会打开
`/admin/?p=<文件名>` 并直接载入这篇文章，不必在列表里翻找。

实现要点见 `scripts/post-edit-link.js`：

- 用 `after_render:html` 按永久链接路径（`2026/08/15/welcome/index.html`）识别文章页，其余页面不注入。
- **必须在生成阶段注入**：整站加密是构建后读 `public/` 整体替换页面的，事后改 `public/` 会被加密门抹掉。
- 按钮样式**内联在元素上**：加密门只把 `<head>` 里的 `<script>` 搬进密文负载，`<style>` 会留在明文区，
  写成 `<style>` 会让规则本身明文可见（等于暴露这个按钮的存在）。
- 目标文章不存在时，编辑台会提示"没有找到文章 xxx"并留在列表，不会打开空白编辑器。

### 能做什么

- 列出 `source/_posts/` 下的全部文章，新建、编辑、删除（删除需输入文件名二次确认）。
- 编辑 front-matter（标题、日期、分类、标签、封面、摘要、mathjax）：未识别的字段原样保留，
  保存时只重写被改动的行，diff 干净；日期默认按 `Asia/Shanghai` 生成，避免 UTC 构建把路径落到前一天。
- 正文 Markdown 编辑，配图拖拽或 Ctrl+V 粘贴即上传到文章同名文件夹并插入 `{% asset_img %}`；
  图片与正文在同一次提交里落地，不会出现"文章引用了还没上传的图"。
- 实时预览；启动 `npm run preview:admin` 后走 Hexo 真实渲染管线（标签插件与 MathJax 公式与线上一致），
  未启动时自动降级为前端近似渲染，并在预览区标出当前模式。
- 改动自动存本机草稿，刷新或关掉浏览器都不丢。
- 提交前比对远端 HEAD：发现别人已推送时**中止提交**，让你选择保留自己的内容或改用远端版本，不会静默覆盖。
- 移动端适配：窄屏下编辑区与预览用底部标签切换，工具条横向滚动，所有确认走站内弹窗
  （不用 `prompt`/`confirm`，因为浏览器可能屏蔽这类出现在公开页面上的原生弹窗）。

### 本地开发与测试

```bash
npm ci
npm run server        # 本地预览站点，编辑台在 http://localhost:4000/admin/
npm run preview:admin # 可选：精确预览服务（默认 127.0.0.1:4001）
npm run verify:admin  # 编辑台静态一致性校验（不启动浏览器）
npm run e2e:admin     # 编辑台端到端测试（会启动无头 Edge，需先 npm run build）
```

`npm test` 只跑单元测试、构建与站点产物校验，**不包含**编辑台端到端测试：
端到端会拉起真实浏览器，不适合放进 CI 与日常提交。

实现要点：

- 视图注册：`scripts/admin-page.js` 在生成前把 `admin-page.ejs` 注册进主题视图表。
  Hexo 8 已移除 `layout_dir`，站点根目录的 `layout/` 不再被处理，所以不能用站点级 layout 覆盖。
- 页面结构：`source/admin/index.md`（`layout: admin`，`sitemap: false`）+ `admin-page.ejs`，
  刻意不套主题页面模板，编辑器样式与主题样式互不影响。
- 前端模块：`source/admin/js/editor-{doc,publish,toolbar,preview,upload,app}.js`，
  纯静态无构建步骤；`editor-doc` 等模块同时可在 Node 里 require，便于单元测试。
- 不被收录：页面 `<meta name="robots" content="noindex">`、`robots.txt` 的 `Disallow: /admin/`、
  以及 `sitemap: false` 三重处理。

## 访问密码（整站加密）

带密码构建时，`public/` 里每个页面的 `<body>` 都会被 AES-256-GCM 加密成一段密文负载，
访客输入密码后在浏览器里解密渲染；没解锁的人拿到的 HTML 只有一张锁屏，里面没有正文。
`/atom.xml` 与 `/search.xml` 这两份公开全文副本也会一并清空。

### 密码放哪

密码只存在仓库的 Actions Secret 里，名字必须是 `BLOG_GATE_PASSWORD`：
Settings → Secrets and variables → Actions → New repository secret。
仓库里只有 `scripts/gate-salt.txt`（固定 salt，公开，不需要保密；它固定下来是为了让访客
"记住 30 天"的解锁状态在每次重新部署后继续有效）。

**先建 Secret 再推代码**：`pages.yml` 里有守卫，缺 Secret 直接失败——宁可这次不发，
也不会把不设防的站点传上 Pages（线上保持上一次的产物）。

### 构建与预览

```bash
npm run gate:build    # hexo clean + generate + 整体加密（读 BLOG_GATE_PASSWORD）
npm run gate:verify   # 校验密文产物：解不回原文、漏明文、漏页面都算失败
npm run e2e:gate      # 端到端：锁屏 → 错密码 → 解锁 → 站内跳转 → 锁定（需先 gate:build）
```

不带 `BLOG_GATE_PASSWORD` 时，`npm test` 与 `npm run server` 照旧是明文站点，
本地开发和 PR 校验不受影响。

### 实现要点

- `scripts/gate-build.js` 在 `hexo generate` **之后**直接改写 `public/`。写成 Hexo 过滤器会
  命中 db.json 的渲染缓存，把明文重新吐回产物里——那种"看着加了锁、其实漏内容"的静默失败
  比不加锁更危险。
- 加解密约定集中在 `scripts/lib/gate-crypto.js`；浏览器端 `source/js/site-gate.js` 用同一套参数
  （PBKDF2-SHA256 60 万次 + AES-256-GCM，认证标签附在密文尾部）。`test/site-gate-crypto.test.cjs`
  跑「Node 加密 → 浏览器模块解密」的往返，两边参数一旦漂移立刻红灯。
- `<head>` 里的主题配置脚本也一起进密文：`window.theme` 带着站点标题、侧栏公告、页脚文案这些
  自己写的字，留在页面上就是明文泄漏。只留决定明暗模式的那支小脚本（锁屏配色要用，内容是
  纯逻辑不含站点文案）；搬进负载的脚本解锁后排在正文脚本之前，`window.theme` 先于主题 JS 就位。
- 解锁后缓存的是**派生钥匙**而不是密码：勾选"记住 30 天"写 localStorage，否则写 sessionStorage。
- `admin/` 不在门内：编辑台自己用 GitHub PAT 登录，加密了反而没法用。
- 带密码构建会摘掉 Swup：未解锁的下一页只有锁屏外壳，SPA 切换拿不到 `#swup` 容器。
- 站内搜索与 RSS 退化成只显示标题（正文留在公开 XML 里等于没加密）。
- 锁屏页带 `noindex`，不会被搜索引擎收录；`robots.txt` 保持原样不动——
  `tools/editor/verify-deploy.mjs` 要拿线上它与本地构建逐字节比对。
- 图片、CSS、JS、`sitemap.xml`、文章标题与 URL 仍是公开的：静态资源没法加密，
  别把带隐私的照片放进站点。

### 换密码 / 忘记密码

改掉 Secret 里的 `BLOG_GATE_PASSWORD` 重新部署即可，代码不用动；访客浏览器里缓存的旧钥匙
会自然失效。要一次性作废所有已解锁的浏览器，连同 `scripts/gate-salt.txt` 一起换。

## 主题定制

- 主题覆盖配置：`_config.redefine.yml`
- 自定义样式：`source/css/anime-theme.css`
- 首页场景切换：`source/js/anime-theme.js`
- 首页横幅分时预加载：`scripts/hero-preload.js`（用 `after_render:html` 过滤器只注入到首页，
  内页没有横幅，注入会白下 213–925KB）
- 站点地图模板：`sitemap_template.xml`（首页/标签/分类条目不写会随部署跳动的 `lastmod`）
- 插画来源记录：`source/images/brand/sources.json`

CI 分两个流程：`.github/workflows/ci.yml` 只在 PR 上跑只读校验，
`.github/workflows/pages.yml` 负责 main 的构建与发布（持有 `pages: write`，不要给它加 `pull_request` 触发）。

不要直接修改 `node_modules/hexo-theme-redefine`，依赖更新后这些改动会丢失。
