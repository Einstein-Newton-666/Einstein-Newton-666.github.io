# 博客访问密码（整站加密）实施计划

日期：2026-09-16
关联设计：`docs/superpowers/specs/2026-09-16-blog-access-password-design.md`

## 步骤

1. **加解密约定**：`scripts/lib/gate-crypto.js`（PBKDF2-SHA256 60 万次 + AES-256-GCM，
   认证标签附在密文尾部）。`scripts/gate-salt.txt` 放固定 salt，随仓库提交。
2. **构建期加锁**：`scripts/gate-build.js`
   - 遍历 `public/**/*.html`，跳过 `admin/`，把 `<body>` 加密成负载 + 锁屏外壳；
   - 摘掉 Swup 脚本与 `new Swup(...)` 初始化；head 追加 `site-gate.css` / `site-gate.js`；
   - 清 `search.xml` 正文、替换 `atom.xml` 正文、锁屏页 head 注入 `noindex`（不动 `robots.txt`）；
   - 写 `output/gate-report.json`（逐页明文 sha256），并拒绝二次加密。
   - 未设置 `BLOG_GATE_PASSWORD` 时整脚本跳过。
3. **浏览器端解锁**：`source/js/site-gate.js` + `source/css/site-gate.css`
   - WebCrypto 解密、按序重放脚本、右下角"锁定"按钮、记住 30 天（localStorage/sessionStorage）。
4. **接线**：`package.json` 增加 `gate:build` / `gate:verify` / `e2e:gate`；
   `pages.yml` 增加 Secret 守卫、带密码构建、产物校验三步，并给构建步骤加 `TZ: Asia/Shanghai`；
   `ci.yml` 同样补 `TZ`。
5. **测试**：`test/site-gate-crypto.test.cjs`、`test/gate-build.test.cjs`、`test/verify-gate.mjs`、
   `tools/gate/e2e-gate.mjs`。
6. **文档**：README「访问密码（整站加密）」一节 + 本设计与计划。

## 上线顺序（顺序不能换）

1. 在 GitHub 建 Secret `BLOG_GATE_PASSWORD`（建议 16 位以上随机串）。
2. 提交并推送本次改动，观察 Actions：`npm test`（明文校验）→ 守卫 → `gate:build` → `gate:verify`。
3. 打开线上站点验收：锁屏 → 错密码 → 正确密码 → 站内跳转 → 手机端再来一遍。
4. 之后再把仓库转私有（需 GitHub Pro；转私有不会让站点变私有，只是让 `.md` 原文不再公开）。

## 验收清单

- [ ] `npm test` 在无密码环境下全绿（与改动前一致）
- [ ] `BLOG_GATE_PASSWORD=… npm run gate:build && npm run gate:verify` 通过
- [ ] `npm run e2e:gate` 10 项全过，截图在 `output/gate-e2e/`
- [ ] 部署日志里 `gate:verify` 输出 PASS，线上首页是锁屏
- [ ] 线上正文在页面源码里是密文（右键查看源代码搜不到正文）
- [ ] 手机浏览器同样能解锁，勾选"记住 30 天"后重开浏览器仍免输

## 回滚

- 退回到明文站点：删掉 `pages.yml` 里的守卫与 `gate:build`/`gate:verify` 两步，直接走 `npm test` 的产物即可。
- 密码泄漏或忘记：改 Secret 重新部署；要作废所有已解锁的浏览器，同时更换 salt。
