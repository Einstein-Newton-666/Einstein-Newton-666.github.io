/* global hexo */

'use strict';

/* ---------------------------------------------------------------------------
 * 私密文章（front-matter 写 `private: true`）在 Hexo 侧的登记。
 *
 * 1. `after_post_render`：把摘要换成占位符。
 *    Redefine 的首页卡片逻辑是「post.excerpt 有值 → 渲染它，否则 → 截断 post.content」
 *    （见主题 layout/pages/home/home-content.ejs），所以只要 excerpt 非空，正文就不会
 *    被截一段贴到首页上。改在 after_post_render 而不是 before_generate：后者拿到的
 *    文档是即时水合的副本，改写不会被模板看到（实测摘要照旧为空、首页照样回落到正文）；
 *    而 after_post_render 的值会随渲染结果一起写回数据库，模板一定读得到。
 *    不标记私密的文章一个字都不动：它们的 excerpt 由渲染流程按 front-matter / `<!-- more -->`
 *    重新算，本来就不会残留旧值。
 *
 * 2. `before_generate`：把「哪些产物文件要上锁、对应哪个 URL」写成清单
 *    output/private-posts.json，交给生成之后的 scripts/gate-build.js 用。这里用 Hexo
 *    自己算出的 post.path，避免在构建脚本里重新实现一遍永久链接规则（连时区差异都得复刻）。
 * ------------------------------------------------------------------------- */

const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDER = '🔒 本文已加密，需要访问密码';
const MANIFEST_PATH = path.join(__dirname, '..', 'output', 'private-posts.json');

function isPrivatePost(post) {
  if (!post) return false;
  return post.private === true || post.private === 'true';
}

/** 私密文章的列表卡片只能显示占位符：作者自己写过的摘要也一并覆盖，宁可少显示也不漏内容。 */
function applyPrivateExcerpt(post) {
  if (!isPrivatePost(post)) return false;
  post.excerpt = PLACEHOLDER;
  return true;
}

/** Hexo 的 post.path 形如 `2026/09/16/slug/`（pretty_urls 关掉了 trailing_index）。 */
function postOutputFile(postPath) {
  const value = String(postPath || '');
  if (!value) return '';
  return value.endsWith('/') ? `${value}index.html` : value;
}

function postUrl(postPath) {
  const value = String(postPath || '');
  if (!value) return '/';
  return `/${value.replace(/^\/+/, '')}`;
}

function collectPrivatePosts(posts) {
  const manifest = [];
  posts.forEach((post) => {
    if (!isPrivatePost(post)) return;
    const outputFile = postOutputFile(post.path);
    if (!outputFile) return;
    manifest.push({ file: outputFile, url: postUrl(post.path), title: String(post.title || '') });
  });
  return manifest;
}

function writeManifest(manifest, filePath = MANIFEST_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), posts: manifest }, null, 2)}\n`);
  return filePath;
}

function onAfterPostRender(data) {
  applyPrivateExcerpt(data);
}

function onBeforeGenerate() {
  try {
    const posts = [];
    this.locals.get('posts').forEach((post) => posts.push(post));
    const manifest = collectPrivatePosts(posts);
    writeManifest(manifest);
    hexo.log.info('私密文章清单：%d 篇%s', manifest.length, manifest.length ? `（${manifest.map((item) => item.title).join('、')}）` : '');
  } catch (error) {
    hexo.log.error('生成私密文章清单失败：%s', error.message);
  }
}

if (typeof hexo !== 'undefined' && hexo.extend && hexo.extend.filter) {
  hexo.extend.filter.register('after_post_render', onAfterPostRender);
  hexo.extend.filter.register('before_generate', onBeforeGenerate, 1);
}

module.exports = {
  PLACEHOLDER,
  MANIFEST_PATH,
  isPrivatePost,
  applyPrivateExcerpt,
  postOutputFile,
  postUrl,
  collectPrivatePosts,
  writeManifest,
};
