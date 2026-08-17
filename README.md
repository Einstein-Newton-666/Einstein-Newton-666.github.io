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
4. 首页封面放在 `source/images/brand/` 或其他 `source/` 子目录，并在 `cover` 中填写以 `/` 开头的站内路径。
5. 提交并推送到 `main` 分支，GitHub Actions 会自动构建并发布。

本地预览（可选，需 Node）：

```bash
npm ci
npm test
npm run server
```

浏览器打开 `http://localhost:4000/`。关于页位于 `/about/`，Atom 订阅地址为 `/atom.xml`。

## 主题定制

- 主题覆盖配置：`_config.redefine.yml`
- 自定义样式：`source/css/anime-theme.css`
- 首页场景切换：`source/js/anime-theme.js`
- 插画来源记录：`source/images/brand/sources.json`

不要直接修改 `node_modules/hexo-theme-redefine`，依赖更新后这些改动会丢失。
