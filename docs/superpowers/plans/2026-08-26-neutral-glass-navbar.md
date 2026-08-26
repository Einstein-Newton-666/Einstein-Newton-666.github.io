# 无色玻璃顶部导航栏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全站顶部导航栏从 Redefine 默认橙蓝渐变改为浅色和暗色模式下的中性无色玻璃效果。

**Architecture:** 在现有自定义 CSS 中使用统一的全站选择器覆盖主题生成的背景、边线、阴影和模糊，不修改 `node_modules`。站点构建校验读取最终自定义 CSS，锁定浅色、暗色和无彩色渐变三项契约，再通过真实浏览器验证桌面、手机与内页行为。

**Tech Stack:** Hexo 7.3、Redefine 2.9.0、CSS、Node.js、Playwright CLI

---

### Task 1: 锁定无色玻璃样式契约

**Files:**
- Modify: `test/verify-site.mjs:169-179`
- Test: `test/verify-site.mjs`

- [ ] **Step 1: 写入会失败的构建契约**

在现有导航栏检查前增加以下规则提取与断言：

```js
const neutralNavbarRule = animeCss.match(/html \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(neutralNavbarRule, /background:\s*rgba\(255, 255, 255, \.24\)/, '浅色导航栏未使用无色玻璃背景');
expect(neutralNavbarRule, /backdrop-filter:\s*blur\(10px\) saturate\(115%\)/, '导航栏玻璃模糊参数缺失');
if (/linear-gradient\(/.test(neutralNavbarRule)) {
  failures.push('导航栏仍包含彩色渐变');
}

const darkNeutralNavbarRule = animeCss.match(/html\.dark \.navbar-container\s*\{([^}]*)\}/)?.[1] || '';
expect(darkNeutralNavbarRule, /background:\s*rgba\(12, 18, 24, \.42\)/, '暗色导航栏未使用中性玻璃背景');
```

保留现有内页不得单独覆盖导航栏视觉样式的检查。

- [ ] **Step 2: 运行校验并确认以正确原因失败**

Run:

```bash
npm run build && node test/verify-site.mjs
```

Expected: FAIL，包含 `浅色导航栏未使用无色玻璃背景`、`导航栏玻璃模糊参数缺失` 和 `暗色导航栏未使用中性玻璃背景`。

### Task 2: 实现全站无色玻璃导航栏

**Files:**
- Modify: `source/css/anime-theme.css:41-45`
- Test: `test/verify-site.mjs`

- [ ] **Step 1: 增加浅色全站规则**

在 `.main-content-container` 规则后加入：

```css
html .navbar-container {
  border-bottom: 1px solid rgba(255, 255, 255, .36);
  background: rgba(255, 255, 255, .24);
  box-shadow: none;
  backdrop-filter: blur(10px) saturate(115%);
  -webkit-backdrop-filter: blur(10px) saturate(115%);
}
```

- [ ] **Step 2: 增加暗色覆盖**

紧接浅色规则加入：

```css
html.dark .navbar-container {
  border-bottom-color: rgba(255, 255, 255, .1);
  background: rgba(12, 18, 24, .42);
}
```

保持 `html[data-anime-page] .navbar-container .navbar-item a.active` 活动项规则不变。

- [ ] **Step 3: 运行契约校验并确认通过**

Run:

```bash
npm run build && node test/verify-site.mjs
```

Expected: 输出 `PASS: 站点资源、路由、RSS、字数统计与 MathJax 构建检查通过`。

- [ ] **Step 4: 提交契约与实现**

```bash
git add test/verify-site.mjs source/css/anime-theme.css
git commit -m "样式：改用无色玻璃顶部导航栏"
```

### Task 3: 完整构建与浏览器验收

**Files:**
- No repository file changes

- [ ] **Step 1: 执行干净构建和完整测试**

Run:

```bash
npm run clean && npm test
```

Expected: 9 项单元测试全部通过，Hexo 构建成功，站点校验输出 `PASS`。

- [ ] **Step 2: 检查桌面浅色模式**

启动 `npm run server -- --port 4000`，使用 Playwright CLI 在 `1440x1000` 下打开 `/`、`/categories/` 和 `/2026/08/15/welcome/`。

Expected: 三个页面 `.navbar-container` 的背景均为 `rgba(255, 255, 255, 0.24)`，模糊均为 `blur(10px) saturate(1.15)`，没有渐变、断图、横向溢出或控制台错误。

- [ ] **Step 3: 检查手机与暗色模式**

使用 Playwright CLI 在 `390x844` 检查首页和分类页，并在桌面切换暗色模式。

Expected: 手机导航无重叠，抽屉可打开；暗色导航栏背景为 `rgba(12, 18, 24, 0.42)`；导航文字清晰，页面背景与内容卡片没有变化。

- [ ] **Step 4: 最终检查工作区**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: 没有格式错误；除用户已有的 `.superpowers/` 未跟踪目录外，没有遗漏的代码更改。
