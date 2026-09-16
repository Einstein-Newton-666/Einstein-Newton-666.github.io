/* global hexo */

'use strict';

/**
 * 注册博客编辑台的 admin 视图。
 *
 * 为什么不用 Hexo 的站点级 layout/ 覆盖：Hexo 8 已移除 layout_dir，
 * 站点根目录下的 layout/ 不再被处理（实测 hexo.theme.getView('admin') 为空）。
 * 这里改为在生成前把 EJS 模板直接注册进主题视图表，
 * 于是 source/admin/index.md 的 `layout: admin` 就能解析到它。
 *
 * 注意：视图只在内存中注册，不会写进 public/，也不改动 node_modules 里的主题。
 */

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.join(__dirname, '..', 'admin-page.ejs');
const VIEW_NAME = 'admin';

function registerAdminView() {
  if (!hexo.theme || typeof hexo.theme.setView !== 'function') return;
  // 已经注册过就不重复注册（hexo server 会多次触发生成）
  if (hexo.theme.getView(VIEW_NAME)) return;
  try {
    const content = fs.readFileSync(TEMPLATE, 'utf8');
    hexo.theme.setView(`${VIEW_NAME}.ejs`, content);
    hexo.log.debug('已注册编辑台视图：layout: %s', VIEW_NAME);
  } catch (error) {
    hexo.log.error('注册编辑台视图失败：%s', error.message);
  }
}

// before_generate 在主题文件处理完成之后、路由生成之前触发，
// 此时注册不会被 theme.process() 覆盖。
hexo.extend.filter.register('before_generate', registerAdminView, 1);
