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
