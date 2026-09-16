# GitHub 仓库私有化操作清单

日期：2026-09-16
背景：博客的访问密码只能挡住**网站访客**；只要仓库公开，`source/_posts/*.md` 的原文
任何人都能在 GitHub 上直接读。这份清单是给仓库所有者自己操作的三种做法。

## 先搞清楚现状

**事实一：GitHub 的可见性是仓库级的，分支没有独立开关。**
社区的原话：*a repository is either public or private, you can't make only one branch
public and the others private*（[discussion #131435](https://github.com/orgs/community/discussions/131435)）。
公开仓库里以下内容全部公开：所有分支、全部提交历史、Issue、PR、Wiki、Actions 日志。
分支保护规则（rulesets / branch protection）管的是"谁能写"，不是"谁能读"。

**事实二：转私有不会让站点变私有。**
GitHub Pages 从私有仓库发布需要 GitHub Pro（免费版只有公开仓库能发 Pages）；
但发布出来的站点**依然是公开站点**——"私有 Pages 可见性"只属于
[Enterprise Cloud 的组织项目站](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)。
所以转私有解决的是"源码不再公开"，站点本身仍然靠密码门。

**事实三：历史上已经有什么。**
《小高の飛行器安装日记》的 `.md` 已经推送到公开仓库（正文当时是空的，泄漏的只有标题）。
一旦往公开仓库推过真正的内容，那段文字就会永久留在提交历史、fork 与缓存里。

**自查命令**（看某篇私密文章是否进过公开历史）：

```bash
git log --oneline --all -- source/_posts/xiaogao-hikouki-install-diary.md
```

---

## 方案 A：整个仓库转私有（最省事，需要 Pro）

**前提**：GitHub Pro（$4/月）。学生先试免费：[github.com/settings/education/benefits](https://github.com/settings/education/benefits)。

1. 拿到 Pro 后，进 **Settings → Billing** 确认账户已显示 Pro。
2. **先验证 Pages 还能正常发**：仓库 → Actions → *Deploy Hexo site to GitHub Pages* → Run workflow，
   确认这次运行是绿的（此时仓库仍是公开的，属于"改动前的健康基线"）。
3. 仓库 → **Settings → General → Danger Zone → Change visibility → Make private**，
   按提示输入仓库名确认。
4. 立刻再跑一次部署（同上 Run workflow），确认流程没有因为私有化而失败。
5. 验收：
   - 退出登录（或用隐身窗口）打开 `https://github.com/Einstein-Newton-666/Einstein-Newton-666.github.io/blob/main/source/_posts/welcome.md` → 应当 404。
   - `https://einstein-newton-666.github.io/` 正常打开，首页公开、私密文章是锁屏。
   - Actions 分钟数开始计入免费额度（私有仓库 2000 分钟/月；本仓库一次部署约 3–4 分钟）。
6. 风险：**Pro 到期后私有仓库的 Pages 会停**。届时要续费，或把仓库转回公开（那会把所有源码重新公开）。

---

## 方案 B：源码放私有仓库，构建产物推到公开的 Pages 仓库（免费）—— **已完成（2026-09-16）**

思路：`<owner>.github.io` 这个仓库只放**构建产物**，源码搬到私有仓库里构建后推过去。
公开仓库里就只有 HTML/CSS/图片（私密文章是密文），没有任何 `.md`。

### 迁移结果（均已验证）

| 项 | 结果 |
|---|---|
| 私有源码仓库 `einblog-source` | 已建（私有），含全部历史、`main`/`sample/visual-polish`/标签 `archive/fix-2024` |
| Secret（建在私有仓库） | `BLOG_GATE_PASSWORD`、`PAGES_DEPLOY_TOKEN` 已配 |
| `publish.yml` 首次运行 | 成功，公开仓库出现 `pages` 分支（298 个文件） |
| `pages` 分支内容 | `.md` 文件 0 个、无 `source/`、带 `.nojekyll`、首页公开、私密文章为密文 + noindex |
| 公开仓库 Pages 发布源 | 已切到 `Deploy from a branch → pages / (root)`，线上 `/.nojekyll` 返回 200 可佐证 |
| 线上回归 | HTTP 全绿 + 真实浏览器 8/8（首页公开、占位摘要、公开文章正常、私密文章锁屏 → 错密码被拒 → 正确密码解锁） |
| 本地 git 远端 | `origin` = `einblog-source`（`main` 已跟踪），公开仓库留作 `Einstein-Newton-666.github.io` remote 供 CI 推送 |

### 还剩一步收尾（可选，按需做）

- ~~公开仓库默认分支改 `pages` 并删掉 `main`~~ **已完成**：默认分支已切到 `pages`，`main` 已删除
  （旧的 `blob/main/source/_posts/*.md` 现在返回 404）。旧提交不可达，但 GitHub 可能仍保留一段时间；
  要彻底干净就删库重建（同名 URL 不变，会有几分钟下线）。
- 源码仓库里的 `.github/workflows/pages.yml` 现在空转（`if` 要求运行在公开部署仓库里）。
  留着它是有意的：万一要切回 GitHub Actions 发布方式，它是现成模板；确认稳定后可删。

### 迁移步骤（留存备查）

**你操作（GitHub 网页）**

1. 新建**私有**仓库 `einblog-source`（不要勾选初始化 README / .gitignore / license）。
2. 让本地能推它：Settings → Developer settings → **Fine-grained tokens** → 编辑现有 token，
   Repository access 里把 `einblog-source` 勾上（权限 **Contents: Read and write**）；
   或者新建一个同样权限的 token。
3. 在**私有源码仓库** `einblog-source` 里加两个 Secret（Settings → Secrets and variables → Actions）：
   - `BLOG_GATE_PASSWORD`：与现在同一个访问密码；
   - `PAGES_DEPLOY_TOKEN`：细粒度 PAT，只勾公开的 `Einstein-Newton-666.github.io`，
     权限 **Contents: Read and write**。
4. 公开仓库 **Settings → Pages** 改成 **Deploy from a branch → pages / (root)**。

**本地命令（已执行）**

```bash
git remote add source https://github.com/Einstein-Newton-666/einblog-source.git
git push source main && git push source sample/visual-polish && git push source archive/fix-2024
git remote rename source origin
git branch --set-upstream-to=origin/main main
```

### 验收清单

- [x] 公开仓库 `Einstein-Newton-666.github.io` 里只有 `index.html`、`css/`、`js/`、`images/`、
      `atom.xml`、`sitemap.xml`、`robots.txt`、`admin/` 与密文页面，**没有 `source/`、没有 `.md`**
- [x] 公开仓库的 `pages` 分支只有一条 deploy 提交
- [x] 线上站点正常：首页公开、私密文章锁屏、输密码可解锁（浏览器 8/8）
- [x] `publish.yml` 跑通（产物成功推到公开仓库）
- [x] 本地 `git push` 已指向私有源码仓库

### 已知取舍

- 在线编辑台 `/admin/` 的仓库输入框要改成 `Einstein-Newton-666/einblog-source`、PAT 换成有该
  私有仓库写权限的（浏览器会记住填过的仓库名，改一次就行）。它的默认值仍写在
  `admin-page.ejs` / `editor-app.js` 里，等编辑台那边的改动稳定后可以顺手改掉。
- 私有仓库的 Actions 消耗免费额度（2000 分钟/月）。
- 公开仓库的旧历史（`main` 分支）在删除分支后不可达，但 GitHub 仍可能保留一段时间；
  在意的话就删库重建。
- 迁移期间如果往公开仓库推了文章，`pages.yml` 照旧发布（不受影响）；迁完之后所有开发都在
  私有源码仓库里做。

---

## 方案 C：只把私密文章放进一个私有小仓库（免费，改动最小）

思路：公开仓库保持现状，只把**私密文章**的 markdown 挪到一个私有仓库；
构建时用令牌把它拉进来注入 `source/_posts/`，跑完就在这次构建里生效。
公开仓库从此只剩公开文章。

### 1. 建私有内容仓库

新建私有仓库 `einblog-private`，目录结构和博客一致：

```
source/_posts/xiaogao-hikouki-install-diary.md      # front-matter 里保留 private: true
source/_posts/xiaogao-hikouki-install-diary/xxx.png # 文章配图（如有）
```

### 2. 给博客仓库加一个只读凭证

推荐细粒度 PAT（不用配 SSH）：

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token。
2. Repository access 只勾 `einblog-private`；Permissions → **Contents: Read-only**。
3. 博客仓库 → Settings → Secrets and variables → Actions → New repository secret，
   名字 `PRIVATE_POSTS_TOKEN`，值填这个 token。

### 3. 改部署流程（我可以代做）

在 `.github/workflows/pages.yml` 的 `npm test` **之前**插入两步：

```yaml
      - name: Checkout private posts
        uses: actions/checkout@v7
        with:
          repository: Einstein-Newton-666/einblog-private
          token: ${{ secrets.PRIVATE_POSTS_TOKEN }}
          path: .private-posts
          persist-credentials: false

      - name: Inject private posts
        run: |
          mkdir -p source/_posts
          cp -R .private-posts/source/_posts/. source/_posts/
```

`BLOG_GATE_SCOPE` 保持 `posts` 不变：注入进来的文章带着 `private: true`，
会被 `scripts/gate-private.js` 自动登记并上锁。

### 4. 把公开仓库里的私密文章清出去

```bash
git rm -r --cached source/_posts/xiaogao-hikouki-install-diary.md
git commit -m "内容：私密文章迁至私有仓库，公开仓库不再保留原文"
git push
```

同时在 `.gitignore` 加一行 `.private-posts/`（CI 注入用的临时目录）。

### 5. 本地开发

私有仓库 clone 到 `local-private/`（与 `local-originals/` 一样不提交），用一个脚本复制进来：

```bash
git clone https://github.com/Einstein-Newton-666/einblog-private.git local-private
cp -R local-private/source/_posts/. source/_posts/     # 本地预览用，别提交
```

预览完把复制进来的文件删掉，或者干脆只在写私密文章时这么做。

### 6. 验收

- 公开仓库：`source/_posts/` 里没有私密文章的 `.md`；`git log --all -- <路径>` 只剩迁移前的旧提交。
- 线上：首页照旧公开，私密文章是锁屏；`view-source:` 里正文是密文。
- Actions 日志里只出现文件名，不打印正文（现有脚本就是这样）。

### 7. 已知取舍

- `/admin/` 编辑台一次只能连一个仓库：编辑私密文章时把仓库框填 `Einstein-Newton-666/einblog-private`
  并换上对应的 PAT；编辑公开文章再切回来。
- 公开仓库的**历史**里仍留着迁移前的私密文章（当前只有标题，正文为空）。
  要连历史一起抹掉：`git filter-repo --path <文件> --invert-paths` 后强推，
  并接受"已经公开过的内容无法保证收回"。

---

## 方案对照

| | 花钱 | 改动量 | 公开仓库里还剩什么 | 适合 |
|---|---|---|---|---|
| A 整仓私有 | Pro（学生可能免费） | 10 分钟 | 什么都不剩（整个仓库不可见） | 以后想随便写，一次解决 |
| B 源码私有 + 产物推公开 | 免费 | 大（拆仓库 + 改部署） | 只有构建产物，无源码 | 想要 A 的效果但不想付费 |
| C 私密文章另放 | 免费 | 中（一个 Secret + 两行 workflow） | 只剩公开文章的源码 | 私密文章不多、想保留公开仓库现状 |
| D 不改 | 0 | 0 | 全部源码 | 只在意网站访客 |

## 我这边能代做的部分

- **C**：workflow 注入步骤、`.gitignore`、迁移命令、README 说明，全部可以直接做，你只需建私有仓库 + PAT 并把 token 填进 Secret。
- **B**：两个 workflow 的改写我可以做，但"删掉公开仓库重建"这一步必须你手动，且会有几分钟下线。
- **A**：改设置必须你本人操作，我负责改完后的部署复验与线上验收。
