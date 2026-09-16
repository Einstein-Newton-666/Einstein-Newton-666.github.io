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
再由 Actions 自动构建发布。

### 首次使用：创建访问令牌

1. GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token。
2. Repository access 选 **Only select repositories**，只勾选本博客仓库。
3. Repository permissions → **Contents: Read and write**（唯一必需的权限）。
4. Expiration 建议 ≤ 90 天。退出登录会在本机清除令牌；怀疑泄漏时到 GitHub 直接 Revoke。

令牌只保存在浏览器 localStorage，所有请求直接发往 `api.github.com`，不经过本站或任何中间服务。

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
