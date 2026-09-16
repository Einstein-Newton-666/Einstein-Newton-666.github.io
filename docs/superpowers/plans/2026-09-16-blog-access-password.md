# 博客访问密码（整站 / 逐篇加密）实施计划

日期：2026-09-16
关联设计：`docs/superpowers/specs/2026-09-16-blog-access-password-design.md`

## 步骤

1. **加解密约定**：`scripts/lib/gate-crypto.js`（PBKDF2-SHA256 60 万次 + AES-256-GCM，
   认证标签附在密文尾部）。`scripts/lib/gate-salt.js` 放固定 salt，随仓库提交
   （放 `lib/` 而不是 `scripts/` 根目录：Hexo 会把 `scripts/` 下每个文件当脚本加载）。
2. **构建期加锁**：`scripts/gate-build.js`
   - 按 `BLOG_GATE_SCOPE` 选范围：`site`=除 `admin/` 外全部页面，`posts`=清单里的文章；
   - 上锁页面把 `<body>` 与 head 里的配置脚本一起加密成负载 + 锁屏外壳；
   - 摘掉 Swup 脚本与 `new Swup(...)` 初始化；head 追加 `site-gate.css` / `site-gate.js`；
   - 清 `search.xml` 正文、替换 `atom.xml` 正文（按范围：全部条目或只清单条目）、
     锁屏页 head 注入 `noindex`（不动 `robots.txt`）；
   - 写 `output/gate-report.json`（含范围、逐页明文 sha256、公开页面清单），拒绝二次加密。
   - 未设置 `BLOG_GATE_PASSWORD` 时整脚本跳过。
3. **私密标记**：`scripts/gate-private.js`
   - `after_post_render` 把 `private: true` 文章的摘要换成占位符；
   - `before_generate` 写出 `output/private-posts.json` 清单（用 Hexo 算出的 `post.path`）。
4. **浏览器端解锁**：`source/js/site-gate.js` + `source/css/site-gate.css`
   - WebCrypto 解密、按序重放脚本、右下角"锁定"按钮、记住 30 天（localStorage/sessionStorage）。
5. **接线**：`package.json` 增加 `gate:build` / `gate:verify` / `e2e:gate`；
   `pages.yml` 增加 Secret 守卫、带密码构建（`BLOG_GATE_SCOPE=posts`）、产物校验三步，
   并给构建步骤加 `TZ: Asia/Shanghai`；`ci.yml` 同样补 `TZ`。
6. **测试**：`test/site-gate-crypto.test.cjs`、`test/gate-build.test.cjs`、
   `test/gate-private.test.cjs`、`test/verify-gate.mjs`、`tools/gate/e2e-gate.mjs`。
7. **文档**：README「访问密码（整站 / 逐篇加密）」一节 + 本设计与计划。

## 上线顺序（顺序不能换）

1. 在 GitHub 建 Secret `BLOG_GATE_PASSWORD`（建议 16 位以上随机串）。
2. 提交并推送本次改动，观察 Actions：`npm test`（明文校验）→ 守卫 → `gate:build` → `gate:verify`。
3. 打开线上站点验收：公开页面照旧、私密文章要密码；手机端再来一遍。
4. 之后再把仓库转私有（需 GitHub Pro；转私有不会让站点变私有，只是让 `.md` 原文不再公开）。

## 验收清单

- [ ] `npm test` 在无密码环境下全绿（与改动前一致，且不受 `BLOG_GATE_SCOPE` 影响）
- [ ] `BLOG_GATE_SCOPE=posts BLOG_GATE_PASSWORD=… npm run gate:build && npm run gate:verify` 通过
- [ ] `npm run e2e:gate` 全过，截图在 `output/gate-e2e/`
- [ ] 部署日志里 `gate:verify` 输出 PASS，线上首页公开、私密文章是锁屏
- [ ] 私密文章正文在页面源码里是密文，首页只显示「🔒 本文已加密，需要访问密码」
- [ ] 手机浏览器同样能解锁，勾选"记住 30 天"后重开浏览器仍免输

## 回滚

- 退回到公开站点：把 `private: true` 去掉（或 `BLOG_GATE_SCOPE` 下掉守卫与 gate 步骤）。
- 退回到整站上锁：把 `pages.yml` 里的 `BLOG_GATE_SCOPE` 改成 `site`（或删掉该行）。
- 密码泄漏或忘记：改 Secret 重新部署；要作废所有已解锁的浏览器，同时更换 salt。
