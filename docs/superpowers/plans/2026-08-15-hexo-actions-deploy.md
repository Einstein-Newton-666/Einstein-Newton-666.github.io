# Hexo + GitHub Actions 自动发布 + Redefine 主题 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Hexo 站点的发布从「本地 hexo-deployer-git 推 gh-page 分支」迁移为「push 到 main 后 GitHub Actions 自动构建部署」，同时切换到 Redefine 主题并开启搜索/公式/分类功能。

**Architecture:** `main` 分支只存 Hexo 源文件；`.github/workflows/pages.yml` 在 push 时用官方 pages 动作构建并部署到 GitHub Pages（源设为 "GitHub Actions"）；主题 Redefine 2.9.0 以 npm 包方式安装，配置覆盖写在 `_config.redefine.yml`。

**Tech Stack:** Hexo 7.3.0、hexo-theme-redefine 2.9.0（npm）、hexo-generator-searchdb 1.5.0、hexo-filter-mathjax 0.11.1、Node 20（Actions）。

**与设计文档的差异说明：** 设计文档原写「KaTeX」，经核实 Redefine 官方文档（redefine-docs.ohevan.com/plugins/mathjax），官方支持的公式方案是 `hexo-filter-mathjax`（MathJax 服务端渲染，构建时直接生成公式 HTML，静态托管无运行时依赖）。按设计文档「按 Redefine 官方推荐方案在实施时确定」的约定，采用 MathJax 方案。

**环境注意事项：** 本机 npm 缓存目录（`~/.npm/_cacache`）当前存在 EROFS 只读问题。若任何 `npm` 命令报 `EROFS: read-only file system`，在命令后追加 `--cache "$TMPDIR/npm-cache"` 重试即可。

---

## 执行中发现的情况更新（2026-08-15）

1. 仓库中已存在 `.github/workflows/pages.yml`（2024-08-21 创建，GitHub Pages starter 模式，从未运行过：API 显示 total_count: 0）。Task 7 改为**覆盖**该文件为计划版本，不新增。
2. 本机未安装 `gh` CLI。所有依赖 `gh` 的步骤（Task 7 Step 3、Task 8、Task 10 Step 1）改用公开 API curl 验证（`api.github.com/repos/.../actions/runs` 匿名可访问，60 次/小时限额，注意节流）或线上站点内容验证。
3. 远程已无 `gh-page` 分支（`git ls-remote` 证实），本地 `remotes/.../gh-page` 是过期引用。Task 8 不再有删除分支步骤，改为：push 后观察 Actions 部署结果——若 deploy 成功说明 Pages 源已是 "GitHub Actions"；若 deploy 失败，请用户在仓库 Settings → Pages → Source 手动切换为 "GitHub Actions" 后重跑。另加 `git remote prune` 清理过期引用。
4. 远程名是 `Einstein-Newton-666.github.io`（无 origin）。所有 push 用该名字。
5. 工作树中 `themes/redefine/` 是**已跟踪文件的删除**（用户旧的手工 clone 实验），`themes/reimu/` 是未跟踪目录。Task 2 需把前者删除提交、后者 rm 掉，否则 Hexo 会优先用 `themes/` 下的旧主题而不是 npm 包。
6. `_config.landscape.yml` 的删除是工作树中遗留改动，Task 3 一并提交。

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `package.json` | 修改 | 移除 hexo-deployer-git / hexo-theme-landscape / hexo-renderer-stylus，加入三个新依赖，移除 deploy 脚本 |
| `_config.yml` | 修改 | theme: redefine、post_asset_folder: true、search 配置块、mathjax: true、移除 deploy 段 |
| `_config.redefine.yml` | 新建 | Redefine 主题配置覆盖（站点信息/横幅/导航/搜索/页脚） |
| `source/categories/index.md` | 新建 | 分类页面（template: categories） |
| `source/tags/index.md` | 新建 | 标签页面（template: tags） |
| `source/_posts/welcome/welcome.md` | 新建 | 站点首篇文章（含公式/代码/图片/分类标签） |
| `source/_posts/welcome/logo.svg` | 新建 | 文章配图（验证图片链路） |
| `.github/workflows/pages.yml` | 新建 | GitHub Actions 自动构建部署工作流 |
| `README.md` | 修改 | 记录写作与发布流程 |
| `source/_posts/hello-world.md` | 删除 | 被 welcome 文章替换 |
| `themes/reimu/` | 删除 | 不再使用的主题 |
| `.deploy_git/` | 删除 | 旧部署器产物（在 .gitignore 中，本地残留） |

---

## Task 1: 清理仓库

**Files:**
- Modify: `package.json`
- Delete: `.deploy_git/`（本地残留目录）

- [ ] **Step 1: 提交已暂存的 flexblock 主题删除（用户此前会话的遗留暂存）**

```bash
cd /home/gaoyuan/Einstein-Newton-666.github.io
git add -A themes/
git status --short | head -5
```

Expected: 只显示 themes/ 下的 `D` 记录（flexblock 文件）

```bash
git commit -m "chore: remove unused flexblock theme files"
```

- [ ] **Step 2: 从 package.json 移除旧部署相关依赖**

用编辑器修改 [package.json](package.json)，最终内容为：

```json
{
  "name": "hexo-site",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "hexo generate",
    "clean": "hexo clean",
    "server": "hexo server"
  },
  "hexo": {
    "version": "7.3.0"
  },
  "dependencies": {
    "hexo": "^7.3.0",
    "hexo-generator-archive": "^2.0.0",
    "hexo-generator-category": "^2.0.0",
    "hexo-generator-index": "^4.0.0",
    "hexo-generator-tag": "^2.0.0",
    "hexo-renderer-ejs": "^2.0.0",
    "hexo-renderer-marked": "^6.3.0",
    "hexo-server": "^3.0.0"
  }
}
```

变化：移除 `deploy` 脚本；移除 `hexo-deployer-git`、`hexo-theme-landscape`、`hexo-renderer-stylus`。

- [ ] **Step 3: 删除本地 .deploy_git 残留目录**

```bash
rm -rf /home/gaoyuan/Einstein-Newton-666.github.io/.deploy_git
ls -la /home/gaoyuan/Einstein-Newton-666.github.io/ | grep deploy
```

Expected: 无输出（目录已删除，且它在 .gitignore 中不影响 git）

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "chore: remove hexo-deployer-git and unused deps"
```

- [ ] **Step 5: 确认删除废弃的 fix 分支（需用户确认）**

先检查 fix 分支内容与 main 的差异：

```bash
git log main..fix --oneline | head -10
```

**检查点：把差异展示给用户，获得确认后再执行：**

```bash
git branch -D fix
git push origin --delete fix
```

Expected: 本地与远程 fix 分支均删除。若用户选择保留，跳过并继续。

---

## Task 2: 安装 Redefine 主题与搜索、公式插件

**Files:**
- Modify: `package.json`（npm 自动更新）
- Modify: `package-lock.json`（npm 自动更新）

- [ ] **Step 1: 安装三个依赖**

```bash
cd /home/gaoyuan/Einstein-Newton-666.github.io
npm install hexo-theme-redefine@latest hexo-generator-searchdb@latest hexo-filter-mathjax@latest
```

若报 `EROFS: read-only file system`，改为：

```bash
npm install --cache "$TMPDIR/npm-cache" hexo-theme-redefine@latest hexo-generator-searchdb@latest hexo-filter-mathjax@latest
```

- [ ] **Step 2: 验证安装结果**

```bash
npm ls hexo-theme-redefine hexo-generator-searchdb hexo-filter-mathjax
```

Expected: 三个包列出且无 `invalid`/`missing`，版本为 2.9.0 / 1.5.0 / 0.11.1（或更新）。同时 `package.json` 的 dependencies 中出现三项：

```
"hexo-filter-mathjax": "^0.11.1",
"hexo-generator-searchdb": "^1.5.0",
"hexo-theme-redefine": "^2.9.0"
```

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "deps: add redefine theme, searchdb, mathjax plugin"
```

---

## Task 3: 配置 _config.yml

**Files:**
- Modify: `_config.yml`

- [ ] **Step 1: 修改主题与文章配置**

在 [_config.yml](_config.yml) 中：

1. `theme: reimu` → `theme: redefine`
2. `post_asset_folder: false` → `post_asset_folder: true`

- [ ] **Step 2: 添加 search 配置块与 mathjax 开关**

在 `_config.yml` 末尾（Deployment 段之前）追加：

```yaml
# Local search (for Redefine navbar search)
search:
  path: search.xml
  field: post
  content: true
  format: html

# Math rendering (hexo-filter-mathjax, see Redefine docs)
mathjax: true
```

- [ ] **Step 3: 删除 Deployment 段**

删除 `_config.yml` 末尾的整段：

```yaml
# Deployment
## Docs: https://hexo.io/docs/one-command-deployment
deploy:
  type: git
  repo: https://github.com/Einstein-Newton-666/Einstein-Newton-666.github.io.git
  branch: 'gh-page'    
  token:
```

（部署改由 GitHub Actions 负责，本地不再需要）

- [ ] **Step 4: 验证配置语法**

```bash
cd /home/gaoyuan/Einstein-Newton-666.github.io
npx hexo config | grep -E 'theme|mathjax' | head -5
```

Expected: 输出包含 `theme: redefine` 和 `mathjax: true`

- [ ] **Step 5: 提交**

```bash
git add _config.yml
git commit -m "config: switch to redefine theme, enable search and mathjax"
```

---

## Task 4: 编写 _config.redefine.yml 主题配置

**Files:**
- Create: `_config.redefine.yml`

- [ ] **Step 1: 创建主题配置文件**

创建 [_config.redefine.yml](_config.redefine.yml)（Hexo 会自动将其与主题自带配置合并），内容：

```yaml
# >>>>>>>>>> 基本信息
info:
  title: Einstein-Newton-666's blogs
  subtitle: 日志与笔记
  author: Einstein-Newton-666
  url: https://einstein-newton-666.github.io/

# >>>>>>>>>> 首页横幅
home_banner:
  enable: true
  style: fixed
  title: Einstein-Newton-666's blogs
  subtitle: 记录学习与生活

# >>>>>>>>>> 导航栏
navbar:
  links:
    Home:
      path: /
      icon: fa-regular fa-house
    Categories:
      path: /categories
      icon: fa-regular fa-folder
    Tags:
      path: /tags
      icon: fa-regular fa-tags
    Archives:
      path: /archives
      icon: fa-regular fa-archive
  search:
    enable: true
    preload: true

# >>>>>>>>>> 页脚
footer:
  runtime: true
  start: 2024/08/21 00:00:00
  statistics: true
```

说明：
- `info.title` 填真实站点名，修复线上浏览器标签页显示 "Theme Redefine" 的问题
- 不写的键（颜色、横幅图片、TOC、版权等）沿用主题默认值，后续想改直接在这里加
- 归档页 `/archives` 由 hexo-generator-archive 自动生成，无需手动创建

- [ ] **Step 2: 验证配置被 Hexo 合并**

```bash
npx hexo config | grep -A2 "title: Einstein" | head -5
```

Expected: 显示 title 为 Einstein-Newton-666's blogs

- [ ] **Step 3: 提交**

```bash
git add _config.redefine.yml
git commit -m "config: add redefine theme overrides"
```

---

## Task 5: 创建分类与标签页面

**Files:**
- Create: `source/categories/index.md`
- Create: `source/tags/index.md`

- [ ] **Step 1: 创建分类页面**

创建 [source/categories/index.md](source/categories/index.md)：

```markdown
---
title: 分类
date: 2026-08-15 12:00:00
template: categories
---
```

- [ ] **Step 2: 创建标签页面**

创建 [source/tags/index.md](source/tags/index.md)：

```markdown
---
title: 标签
date: 2026-08-15 12:00:00
template: tags
---
```

（`template:` front-matter 是 Redefine 官方页面模板机制，见 redefine-docs.ohevan.com/zh/docs/page_templates）

- [ ] **Step 3: 提交**

```bash
git add source/categories/index.md source/tags/index.md
git commit -m "feat: add categories and tags pages"
```

---

## Task 6: 本地构建验证（搜索 / 公式 / 高亮）

**Files:**
- 无（验证任务）

- [ ] **Step 1: 完整构建**

```bash
cd /home/gaoyuan/Einstein-Newton-666.github.io
npx hexo clean && npx hexo generate
```

若 npm 报 EROFS，追加 `--cache "$TMPDIR/npm-cache"` 到 npm 命令。

Expected: 构建成功，无 ERROR；`public/index.html` 生成。

- [ ] **Step 2: 验证搜索索引生成**

```bash
ls -la public/search.xml
```

Expected: 文件存在且非空（内容为文章数据的 XML）

- [ ] **Step 3: 验证首页标题**

```bash
grep -o '<title>[^<]*</title>' public/index.html | head -1
```

Expected: `<title>Einstein-Newton-666's blogs</title>`

- [ ] **Step 4: 启动本地服务器目视检查**

```bash
npx hexo server -p 4000
```

打开浏览器 http://localhost:4000，检查：首页横幅正常、导航栏有 首页/分类/标签/归档 四个链接、右上角有搜索图标。

Expected: 页面正常无报错。检查后 Ctrl+C 停止服务器。

- [ ] **Step 5: 提交（若有构建产物变化无需提交——public/ 在 .gitignore 中）**

```bash
git status --short
```

Expected: 只有 db.json（已被 .gitignore 忽略，实际不显示）之外无意外改动。

---

## Task 7: 添加 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: 创建工作流文件**

创建 [.github/workflows/pages.yml](.github/workflows/pages.yml)：

```yaml
name: Deploy Hexo site to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build site
        run: npx hexo generate

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./public

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 提交并推送（触发首次 Actions 运行）**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: add GitHub Actions pages deploy workflow"
git push origin main
```

Expected: push 成功。此时 Actions 会开始运行，但 Pages 源尚未切换到 Actions，deploy job 会失败（正常现象，Task 8 处理后重跑）。

- [ ] **Step 3: 查看 Actions 运行状态**

```bash
gh run list --limit 3
```

Expected: 看到本次 commit 触发的 workflow run，build job 成功、deploy job 失败（"Deployment failed"或等待）。

---

## Task 8: 切换 Pages 源为 GitHub Actions 并清理 gh-page 分支

**Files:**
- 无（GitHub 设置操作）

- [ ] **Step 1: 检查 gh CLI 认证状态**

```bash
gh auth status
```

Expected: `Logged in to github.com as Einstein-Newton-666`。若未登录：执行 `gh auth login` 完成登录；若用户不想用 gh CLI，跳到 Step 4 手动方式。

- [ ] **Step 2: 本地保存 gh-page 分支副本（回退保障）**

```bash
git fetch origin gh-page:gh-page-backup
git branch | grep gh-page
```

Expected: 显示 `gh-page-backup`（旧构建内容可随时恢复）

- [ ] **Step 3: 通过 API 把 Pages 源切换为 GitHub Actions**

```bash
gh api -X PUT repos/Einstein-Newton-666/Einstein-Newton-666.github.io/pages -f build_type=workflow --jq '.html_url'
```

Expected: 返回 `https://github.com/Einstein-Newton-666/Einstein-Newton-666.github.io`（无报错）。用 `gh api repos/Einstein-Newton-666/Einstein-Newton-666.github.io/pages --jq '.build_type'` 验证返回 `workflow`。

手动方式（Step 4，仅当 Step 1/3 走不通时）：
- 浏览器打开仓库 → Settings → Pages → Build and deployment → Source 选择 "GitHub Actions" → Save

- [ ] **Step 5: 重新运行工作流**

```bash
gh workflow run pages.yml
```

Expected: 新的 run 启动，build 和 deploy 两个 job 都成功。用 `gh run watch <run-id>` 观察直到完成。

- [ ] **Step 6: 验证线上站点更新（此时还是 hello-world 内容）**

```bash
curl -s -m 15 https://einstein-newton-666.github.io/ | grep -o '<title>[^<]*</title>' | head -1
```

Expected: `<title>Einstein-Newton-666's blogs</title>`（标题修复生效，说明 Actions 部署成功）

- [ ] **Step 7: 删除远程 gh-page 分支（需用户确认）**

**检查点：向用户展示 Step 6 验证结果，确认站点由 Actions 正常部署后执行：**

```bash
git push origin --delete gh-page
git branch -D gh-page-backup   # 确认线上一切正常后再清理本地备份
```

Expected: 远程 gh-page 删除成功；此时仓库 Settings → Pages 显示 "Your site is live"。

---

## Task 9: 首篇文章（含公式 / 代码 / 图片 / 分类）

**Files:**
- Create: `source/_posts/welcome/welcome.md`
- Create: `source/_posts/welcome/logo.svg`
- Delete: `source/_posts/hello-world.md`
- Modify: `README.md`

- [ ] **Step 1: 创建文章配图**

创建 [source/_posts/welcome/logo.svg](source/_posts/welcome/logo.svg)：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="16" fill="#A31F34"/>
  <text x="60" y="74" font-size="52" text-anchor="middle" fill="#fff" font-family="sans-serif">E</text>
</svg>
```

- [ ] **Step 2: 创建首篇文章**

创建 [source/_posts/welcome/welcome.md](source/_posts/welcome/welcome.md)（文件名与文件夹同名，post_asset_folder 自动关联）：

```markdown
---
title: 你好，世界 —— 第一篇日志
date: 2026-08-15 21:00:00
categories: [日志]
tags: [随笔, 第一篇]
---

这是站点的第一篇文章，用于验证各类功能。

## 图片

{% asset_img logo.svg "站点图标" %}

## 代码

```javascript
function greet(name) {
  console.log(`你好，${name}！`);
}

greet('世界');
```

## 公式

质能方程 $E = mc^2$，以及定积分：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## 关于本站

这里将记录我的学习笔记和生活日志。写作流程见 [README](https://github.com/Einstein-Newton-666/Einstein-Newton-666.github.io#readme)。
```

- [ ] **Step 3: 删除 hello-world**

```bash
rm source/_posts/hello-world.md
```

- [ ] **Step 4: 更新 README 记录写作流程**

替换 [README.md](README.md) 内容为：

```markdown
# Einstein-Newton-666's blogs

个人日志与技术笔记站点，基于 Hexo + Redefine 主题，GitHub Actions 自动部署。

## 写作与发布

1. 在 `source/_posts/` 下新建文章文件夹（如 `my-post/`），内含 `my-post.md`：

   ```markdown
   ---
   title: 文章标题
   date: 2026-08-15 21:00:00
   categories: [笔记]   # 或 [日志]
   tags: [标签1, 标签2]
   ---

   正文……
   ```

2. 图片放在文章文件夹内，正文用 `{% asset_img 文件名.svg "描述" %}` 引用
3. 公式用 `$...$`（行内）和 `$$...$$`（整行）
4. 提交并推送到 `main` 分支，约 1~2 分钟后自动上线

本地预览（可选，需 Node）：

```bash
npm ci
npx hexo server
```
```

- [ ] **Step 5: 本地构建验证新文章**

```bash
npx hexo clean && npx hexo generate
ls public/2026/08/15/welcome/index.html
```

Expected: 文件存在。

- [ ] **Step 6: 验证公式渲染为静态 HTML**

```bash
grep -c 'mjx-container\|MathJax' public/2026/08/15/welcome/index.html
```

Expected: 数字 ≥ 1（hexo-filter-mathjax 已把公式转为 HTML）。若为 0，检查 `_config.yml` 中 `mathjax: true` 是否存在、`npm ls hexo-filter-mathjax` 是否正常，修复后重跑本步。

- [ ] **Step 7: 验证代码高亮**

```bash
grep -c 'hljs' public/2026/08/15/welcome/index.html
```

Expected: 数字 ≥ 1（代码块带高亮 class）

- [ ] **Step 8: 验证图片与分类**

```bash
ls public/2026/08/15/welcome/logo.svg && ls public/categories/日志/ 2>/dev/null | head -3
```

Expected: logo.svg 存在；分类目录 `categories/日志/` 存在（生成该分类的 index 页面）

- [ ] **Step 9: 提交并推送**

```bash
git add -A source/ README.md
git commit -m "feat: add welcome post with math, code, image and categories"
git push origin main
```

---

## Task 10: 端到端上线验证

**Files:**
- 无（验证任务）

- [ ] **Step 1: 等待 Actions 构建完成**

```bash
gh run list --limit 1
```

Expected: 最新 run 状态为 completed 且 ✓。

- [ ] **Step 2: 验证线上文章**

```bash
curl -s -m 15 https://einstein-newton-666.github.io/2026/08/15/welcome/ | grep -c 'mjx-container\|hljs\|logo.svg'
```

Expected: 数字 ≥ 1（线上文章含公式/高亮/图片）

- [ ] **Step 3: 验证线上搜索索引**

```bash
curl -s -m 15 https://einstein-newton-666.github.io/search.xml | head -c 200
```

Expected: 返回 XML 内容（含 welcome 文章数据），非 404

- [ ] **Step 4: 验证线上分类页与导航**

```bash
curl -s -o /dev/null -w '%{http_code}' https://einstein-newton-666.github.io/categories/
curl -s -o /dev/null -w '%{http_code}' https://einstein-newton-666.github.io/tags/
curl -s -o /dev/null -w '%{http_code}' https://einstein-newton-666.github.io/archives/
```

Expected: 三行均为 200

- [ ] **Step 5: 浏览器目视检查（手动）**

打开 https://einstein-newton-666.github.io/ 检查：
1. 浏览器标签页标题是 "Einstein-Newton-666's blogs"
2. 首页文章列表显示第一篇日志
3. 右上角搜索框能搜到 "第一篇"
4. 文章页公式、代码高亮、图片渲染正常
5. 分类页能看到「日志」分类

- [ ] **Step 6: GitHub 网页直接编辑测试（可选）**

在 GitHub 网页上打开 `source/_posts/welcome/welcome.md` → 编辑（如改一个词）→ Commit 到 main。等待 1~2 分钟后刷新站点确认内容更新。

Expected: 站点内容更新——证明「GitHub 网页发文」链路可用。

- [ ] **Step 7: 收尾提交（如有）**

```bash
git status --short && git log --oneline -12
```

Expected: 工作区干净，提交历史清晰（每步一个 commit，无 debug 命名提交）。

---

## 完成后检查清单（对应设计文档验证标准）

- [ ] push 到 main 后 Actions 构建成功且站点自动更新（Task 10 Step 1-2）
- [ ] 浏览器标签页标题显示 "Einstein-Newton-666's blogs"（Task 8 Step 6 / Task 10 Step 5）
- [ ] 站内全文搜索可搜到文章内容（Task 10 Step 3+5）
- [ ] 测试文章代码高亮、公式、图片正常（Task 9 Step 6-8 + Task 10 Step 5）
- [ ] 「日志」「笔记」分类页面可浏览（Task 10 Step 4-5）
- [ ] GitHub 网页直接编辑后站点更新（Task 10 Step 6，可选）
- [ ] 本地无 hexo-deployer-git 也可构建预览（Task 9 Step 5）
