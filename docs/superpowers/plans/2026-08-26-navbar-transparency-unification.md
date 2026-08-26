# 顶部导航栏透明度统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让首页与所有内页的顶部导航栏统一继承 Redefine 2.9.0 官方透明度、模糊和阴影样式。

**Architecture:** 删除自定义 CSS 中仅针对内页导航栏的视觉覆盖，保留活动导航项颜色以及页面背景和内容卡片样式。通过构建契约禁止这些覆盖重新出现，并用真实浏览器比较首页与内页导航栏的计算样式。

**Tech Stack:** Hexo 7.3、Redefine 2.9.0、CSS、Node.js、Playwright CLI

---

### Task 1: 锁定导航栏继承契约

**Files:**
- Modify: `test/verify-site.mjs`
- Test: `test/verify-site.mjs`

- [ ] **Step 1: 写入会失败的源码契约**

在读取 `animeCss` 后增加检查，禁止内页选择器继续声明导航栏背景、模糊、阴影或边框：

```js
const innerNavbarRule = animeCss.match(/html\[data-anime-page\] \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
if (/\b(?:background|backdrop-filter|box-shadow|border(?:-bottom)?)\s*:/.test(innerNavbarRule)) {
  failures.push('内页导航栏仍覆盖 Redefine 官方透明样式');
}

const darkInnerNavbarRule = animeCss.match(/html\.dark\[data-anime-page\] \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
if (/\b(?:background|backdrop-filter|box-shadow|border(?:-bottom)?)\s*:/.test(darkInnerNavbarRule)) {
  failures.push('暗色内页导航栏仍覆盖 Redefine 官方透明样式');
}
```

同时删除原有两个要求内页导航栏使用 `rgba(247, 250, 249, .82)` 和 `rgba(17, 26, 33, .84)` 的断言。

- [ ] **Step 2: 运行站点校验并确认失败原因正确**

Run: `npm run build && node test/verify-site.mjs`

Expected: FAIL，包含 `内页导航栏仍覆盖 Redefine 官方透明样式` 和 `暗色内页导航栏仍覆盖 Redefine 官方透明样式`。

### Task 2: 让内页继承官方导航栏样式

**Files:**
- Modify: `source/css/anime-theme.css:44-51`
- Modify: `source/css/anime-theme.css:84-88`
- Test: `test/verify-site.mjs`

- [ ] **Step 1: 删除浅色内页导航栏视觉覆盖**

从 `html[data-anime-page] .navbar-container` 删除整个规则块：

```css
html[data-anime-page] .navbar-container {
  border-bottom: 1px solid rgba(255, 255, 255, .58);
  background: rgba(247, 250, 249, .82);
  box-shadow: 0 8px 24px rgba(22, 43, 51, .08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
```

- [ ] **Step 2: 删除暗色内页导航栏视觉覆盖**

从 `html.dark[data-anime-page] .navbar-container` 删除整个规则块：

```css
html.dark[data-anime-page] .navbar-container {
  border-bottom-color: rgba(255, 255, 255, .08);
  background: rgba(17, 26, 33, .84);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .2);
}
```

保留以下活动项颜色规则：

```css
html[data-anime-page] .navbar-container .navbar-item a.active {
  color: var(--anime-teal);
}
```

- [ ] **Step 3: 运行完整测试**

Run: `npm run clean && npm test`

Expected: 单元测试全部通过，Hexo 构建成功，`verify-site.mjs` 输出 `PASS`。

- [ ] **Step 4: 提交代码**

```bash
git add source/css/anime-theme.css test/verify-site.mjs
git commit -m "样式：统一全站顶部导航栏透明度"
```

### Task 3: 浏览器验收并推送

**Files:**
- No repository file changes

- [ ] **Step 1: 启动本地站点并检查桌面浅色模式**

Run: `npm run server`

使用 Playwright CLI 在 `1440x1000`、DPR 1 下依次打开 `/`、`/categories/` 和 `/2026/08/15/welcome/`，读取 `.navbar-container` 的 `backgroundImage`、`backdropFilter` 和 `boxShadow`。

Expected: 三个页面均为 Redefine 生成的同一双色渐变、`blur(10px)` 和同一主题阴影；没有失效图片、控制台错误或横向溢出。

- [ ] **Step 2: 检查移动端和暗色模式**

使用 Playwright CLI 检查 `390x844` 移动端以及 `1440x1000` 暗色模式。

Expected: 首页、分类页和文章页顶部导航栏计算样式一致；移动端抽屉打开正常；页面背景遮罩与内容卡片保持原有样式。

- [ ] **Step 3: 最终验证并推送**

Run:

```bash
npm test
git diff --check
git status --short --branch
git push Einstein-Newton-666.github.io main
```

Expected: 测试通过、没有未提交文件，远程 `main` 更新到本地 `HEAD`，本次 GitHub Actions 构建成功。
