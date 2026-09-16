/* global hexo */

'use strict';

/**
 * 给文章页注入一个「编辑」按钮，点了直接跳到编辑台并打开对应文章。
 *
 * 注入时机很关键：整站加密（scripts/gate-build.js）是在 hexo generate 之后读 public/ 的产物、
 * 整页替换成「锁屏 + 密文负载」，所以这里必须用 after_render:html 在生成阶段注入，
 * 注入的内容才会一起进密文、解锁后可见。若改成事后改 public/，按钮会被加密门整个抹掉。
 *
 * 识别方式：文章永久链接是 /:year/:month/:day/:title/（见 _config.yml 的 permalink），
 * 所以路径形如 2026/08/15/welcome/index.html 才注入；其余页面（首页/归档/标签/关于/404）不动。
 */

// 文章页路径：YYYY/MM/DD/slug/index.html（允许反斜杠分隔）
const POST_PATH_RE = /^(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/index\.html$/;

// 样式直接内联在元素上：加密门（gate-build.js）只把 <head> 里的 <script> 搬进密文负载，
// 其余 head 内容（包括 <style>）留在明文里。若把样式写成 <style> 注入，规则本身会明文可见
// （会暴露出这个按钮的存在与样式）。内联则随按钮一起进密文，不产生任何明文痕迹。
const LINK_STYLE = 'display:flex;align-items:center;justify-content:center;'
  + 'width:100%;height:100%;color:inherit;text-decoration:none';

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/** 文章页返回文件名（slug），非文章页返回 null */
function slugFromPagePath(pagePath) {
  const match = POST_PATH_RE.exec(normalizePath(pagePath));
  if (!match) return null;
  const slug = match[4];
  if (!slug || slug === '.' || slug === '..') return null;
  return slug;
}

/** 生成工具条里的「编辑」按钮（与主题的 article-tools-list 同排） */
function buildEditButton(slug) {
  const href = `/admin/?p=${encodeURIComponent(String(slug ?? ''))}`;
  return `<li class="einblog-edit-tool" data-einblog-edit>`
    + `<a href="${href}" style="${LINK_STYLE}" title="编辑这篇文章" aria-label="编辑这篇文章">`
    + '<i class="fa-regular fa-pen-to-square"></i>'
    + '</a></li>';
}

function injectEditLink(html, pagePath) {
  const slug = slugFromPagePath(pagePath);
  if (!slug) return html;
  const markup = String(html || '');
  if (markup.includes('data-einblog-edit')) return html; // 幂等：已注入过
  const listEnd = markup.indexOf('</ul>', markup.indexOf('article-tools-list'));
  if (listEnd === -1) return html; // 主题模板改了或该页没有工具条，保持原样
  return `${markup.slice(0, listEnd)}${buildEditButton(slug)}${markup.slice(listEnd)}`;
}

function injectFromRenderData(html, data) {
  const pagePath = data && data.path ? data.path : '';
  return injectEditLink(html, pagePath);
}

// hexo 只在 Hexo 进程里存在；单元测试直接 require 本文件时没有它，所以要容错，
// 这样 slugFromPagePath / injectEditLink 这些纯函数可以在 node --test 里单独验证。
if (typeof hexo !== 'undefined' && hexo.extend) {
  hexo.extend.filter.register('after_render:html', injectFromRenderData);
}

module.exports = { slugFromPagePath, buildEditButton, injectEditLink, POST_PATH_RE };
