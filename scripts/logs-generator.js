'use strict';

const pagination = require('hexo-pagination');

function generateLogs(locals) {
  const config = this.config;
  const paginationDir = config.pagination_dir || 'page';
  const perPage = config.category_generator?.per_page ?? 10;
  const orderBy = config.category_generator?.order_by || '-date';
  const category = locals.categories.findOne({ name: '日志' });
  if (!category?.length) return [];
  const posts = category.posts.sort(orderBy);

  return pagination('logs/', posts, {
    perPage,
    layout: ['category', 'archive', 'index'],
    format: `${paginationDir}/%d/`,
    data: {
      category: '日志',
      title: '日志',
    },
  });
}

hexo.extend.generator.register('logs', generateLogs);

module.exports = generateLogs;
