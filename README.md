# Einstein-Newton-666's blogs

个人日志与技术笔记站点，基于 Hexo + Redefine 主题，GitHub Actions 自动部署。

## 写作与发布

1. 在 `source/_posts/` 下新建文章文件 `my-post.md`：

   ```markdown
   ---
   title: 文章标题
   date: 2026-08-15 21:00:00
   categories: [笔记]   # 或 [日志]
   tags: [标签1, 标签2]
   ---

   正文……
   ```

2. 图片放在与文章同名的文件夹 `source/_posts/my-post/` 内（Hexo post_asset_folder 约定），正文用 `{% asset_img 文件名.svg "描述" %}` 引用
3. 公式用 `$...$`（行内）和 `$$...$$`（整行）
4. 提交并推送到 `main` 分支，约 1~2 分钟后自动上线

本地预览（可选，需 Node）：

```bash
npm ci
npx hexo server
```
