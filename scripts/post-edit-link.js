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

// 移动端入口的样式（同样内联）；显隐由主题的 .mobile 类负责，这里只管排版
const INLINE_STYLE = 'display:inline-flex;align-items:center;gap:.25em;color:inherit;text-decoration:none';

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

/** 桌面用：右侧悬浮工具条里的铅笔按钮 */
function buildEditButton(slug) {
  const href = `/admin/?p=${encodeURIComponent(String(slug ?? ''))}`;
  return `<li class="einblog-edit-tool" data-einblog-edit-tool>`
    + `<a href="${href}" style="${LINK_STYLE}" title="编辑这篇文章" aria-label="编辑这篇文章">`
    + '<i class="fa-regular fa-pen-to-square"></i>'
    + '</a></li>';
}

/**
 * 移动端用：文章元信息行里的「编辑」入口。
 * 主题在 ≤640px 会把整个 .post-tools 隐藏（style.css：
 * `@media (max-width:640px){ .page-container .post-tools{display:none} }`），
 * 而 .article-meta-info 在移动端仍显示，所以窄屏的入口放这里。
 * 显隐交给主题自带的 .mobile 类（它本来就靠 .desktop/.mobile 切换日期格式），
 * 于是不必自己写媒体查询，也就不用往 head 里塞 <style>（那会落在加密门的明文区）。
 */
function buildInlineEditButton(slug) {
  const href = `/admin/?p=${encodeURIComponent(String(slug ?? ''))}`;
  return `<span class="article-meta-item mobile einblog-edit-inline" data-einblog-edit-inline>`
    + `<a href="${href}" style="${INLINE_STYLE}" title="编辑这篇文章" aria-label="编辑这篇文章">`
    + '<i class="fa-regular fa-pen-to-square"></i>&nbsp;编辑'
    + '</a></span>';
}

function injectEditLink(html, pagePath) {
  const slug = slugFromPagePath(pagePath);
  if (!slug) return html;
  const markup = String(html || '');
  if (markup.includes('data-einblog-edit-tool')) return html; // 幂等：已注入过

  let output = markup;

  // 移动端入口：插在 .article-meta-info 容器内部
  const metaStart = output.indexOf('article-meta-info');
  if (metaStart !== -1) {
    const containerEnd = output.indexOf('>', metaStart);
    if (containerEnd !== -1) {
      output = `${output.slice(0, containerEnd + 1)}${buildInlineEditButton(slug)}${output.slice(containerEnd + 1)}`;
    }
  }

  // 桌面入口：插进右侧悬浮工具条
  const listStart = output.indexOf('article-tools-list');
  if (listStart !== -1) {
    const listEnd = output.indexOf('</ul>', listStart);
    if (listEnd !== -1) {
      output = `${output.slice(0, listEnd)}${buildEditButton(slug)}${output.slice(listEnd)}`;
    }
  }

  return output;
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

module.exports = {
  slugFromPagePath,
  buildEditButton,
  buildInlineEditButton,
  injectEditLink,
  POST_PATH_RE,
};

