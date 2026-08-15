# 设计：Hexo 站点改为 GitHub Actions 自动发布 + Redefine 主题

日期：2026-08-15
状态：已获用户批准（口头确认，待书面复核）

## 背景与现状

目标：用 GitHub Pages（einstein-newton-666.github.io）承载个人日志和技术笔记。

现状问题：

- 站点基于 Hexo 7.3.0，通过 `hexo-deployer-git` 从本地推送到 `gh-page` 分支发布
- 发布依赖本地 Node 环境跑 `hexo g -d`，换电脑无法发文
- 线上站点停留在旧构建：主题是 Redefine 但未配置站点名，浏览器标题显示默认的 "Theme Redefine"；本地 `main` 分支配置的是 reimu 主题，本地与线上不同步
- 提交历史有大量 "debug 1~7" 提交，部署流程调试成本高

## 目标与非目标

目标：

1. push 即上线：任何电脑（含 GitHub 网页直接编辑）都能发布，无需本地构建环境
2. 站点功能满足需求：本地全文搜索、代码高亮、KaTeX 公式、图片、中文界面
3. 仓库干净：`main` 分支只存源文件，构建产物不入库
4. 内容组织：日志与笔记通过分类区分

非目标：

- 不更换静态站点生成器（保留 Hexo）
- 不引入评论系统、外部分析等第三方服务
- 不做多语言站点

## 架构与发布流程

```
写文章(.md) → git push 到 main 分支
  → GitHub Actions 自动构建（hexo generate，约 1~2 分钟）
  → 官方 deploy-pages 动作直接部署到 github.io
```

具体改动：

1. `main` 分支只存 Hexo 源文件（配置、文章、主题），构建产物不入库（现有 .gitignore 已覆盖 db.json / node_modules / public / .deploy*）
2. 新增 `.github/workflows/pages.yml`：
   - 触发：push 到 `main`、手动 `workflow_dispatch`
   - 权限：`contents: read`、`pages: write`、`id-token: write`；环境 `github-pages`
   - 步骤：checkout → setup-node（Node 20，启用 npm 缓存）→ `npm ci` → `hexo generate` → configure-pages → upload-pages-artifact（上传 `public/`）→ deploy-pages
3. GitHub Pages 源切换为 "GitHub Actions"（可在仓库 Settings 手动改，或用 gh CLI/API 设置 build_type: workflow）
4. 删除远程 `gh-page` 分支（执行前与用户确认）
5. 移除 `hexo-deployer-git` 依赖，删除本地 `.deploy_git/` 目录

## 主题与功能配置

1. 主题换成 Redefine：clone 官方仓库 `EvanNotFound/hexo-theme-redefine` 到 `themes/redefine` 并锁定提交版本；`_config.yml` 中 `theme: redefine`
2. 主题配置开启：
   - 本地全文搜索：安装 `hexo-generator-searchdb`，主题配置中启用搜索（含 search.xml 生成）
   - 公式：按 Redefine 官方文档（redefine-docs.ohevan.com/plugins/mathjax）使用 hexo-filter-mathjax（MathJax 服务端渲染，构建期生成公式 HTML），必须实测公式渲染通过
   - 代码高亮：主题内置
   - 语言：zh-CN
3. 修复站点标题：主题配置填写站点名 "Einstein-Newton-666's blogs"（用户确认保留该标题），消除浏览器标签页显示 "Theme Redefine" 的问题
4. 站点信息：作者 Einstein-Newton-666、语言 zh-CN、时区 Asia/Shanghai、url 已正确配置（保持不变）
5. 图片：开启 `post_asset_folder: true`，每篇文章一个同名资源文件夹，正文用相对路径引用图片

## 内容组织与写作流程

文章格式（`source/_posts/` 下每篇一个 .md）：

```markdown
---
title: 文章标题
date: 2026-08-15 20:30:00
categories: [笔记]   # 或 [日志]
tags: [学习, 记录]
---

正文 Markdown
```

写作方式（无需本地环境）：

| 方式 | 场景 |
|---|---|
| 直接创建 .md 文件 + git push | 任何电脑，零环境要求 |
| GitHub 网页上新建文件 | 手机 / 临时改动 |
| 本地 `npx hexo new post "标题"` | 装有 Node 时，自动生成 front-matter 模板 |

发布流程：写 md → commit → push → 1~2 分钟后自动上线。

分类：以「日志」和「笔记」两大类为主，创建 categories 页面作为站内分类入口；标签自由添加。

## 迁移步骤概要

1. 清理仓库：移除 `hexo-deployer-git` 依赖、删除 `.deploy_git/`、删除本地 reimu 主题、删除废弃的 `fix` 分支（分支删除执行前与用户确认）
2. 安装 Redefine 主题（锁定版本）并完成全部配置
3. 添加 `.github/workflows/pages.yml` 工作流
4. GitHub 设置：Pages 源切换为 "GitHub Actions"；删除远程 `gh-page` 分支（与用户确认后）
5. 本地预览验证：`npm ci` + `hexo server`，确认搜索、公式、代码高亮、图片正常
6. 上线验证：push 后检查线上站点，发布一篇含公式、代码块、图片、分类标签的测试文章，验证全链路后保留为站点首篇正式文章（替换现有 hello-world）

## 验证标准

- [ ] push 到 main 后 Actions 构建成功且站点自动更新（无需本地任何命令）
- [ ] 浏览器标签页标题显示 "Einstein-Newton-666's blogs"，而非主题名
- [ ] 站内全文搜索可搜到文章内容
- [ ] 测试文章中的代码块高亮、KaTeX 公式、图片均正常渲染
- [ ] 「日志」「笔记」分类页面可正常浏览
- [ ] 从 GitHub 网页直接编辑一篇文章后站点同步更新
- [ ] 本地不装 hexo-deployer-git 的情况下换目录 clone 仓库可正常 `npm ci && hexo server` 预览（可选验证）

## 风险与回退

- Actions 构建失败风险：回退方式为在 GitHub 上手动运行 workflow 查看日志修复；最坏情况可临时将 Pages 源改回分支模式用旧 `gh-page` 内容兜底（gh-page 删除前先记录其内容有旧构建可恢复）
- 公式渲染风险：若 hexo-filter-mathjax 渲染不生效，按官方文档排查 `mathjax: true` 配置与插件安装状态，本地构建即可验证
- 构建时长 1~2 分钟：属正常范围，不做额外优化（缓存已由 setup-node 内置 npm 缓存覆盖）
