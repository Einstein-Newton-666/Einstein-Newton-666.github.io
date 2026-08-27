const test = require('node:test');
const assert = require('node:assert/strict');

test('独立日志路由只包含“日志”分类文章', () => {
  const registrations = new Map();
  global.hexo = {
    extend: {
      generator: {
        register(name, generator) {
          registrations.set(name, generator);
        },
      },
    },
  };

  const modulePath = require.resolve('../scripts/logs-generator.js');
  delete require.cache[modulePath];
  require(modulePath);

  const logPost = { title: '日志文章' };
  const notePost = { title: '技术笔记' };
  const logPosts = [logPost];
  const locals = {
    posts: {
      sort() {
        return [logPost, notePost];
      },
    },
    categories: {
      findOne(query) {
        assert.deepEqual(query, { name: '日志' });
        return {
          length: logPosts.length,
          posts: {
            sort(orderBy) {
              assert.equal(orderBy, '-date');
              return logPosts;
            },
          },
        };
      },
    },
  };

  const routes = registrations.get('logs').call({
    config: {
      category_generator: { per_page: 10, order_by: '-date' },
      pagination_dir: 'page',
    },
  }, locals);

  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, 'logs/');
  assert.deepEqual(routes[0].data.posts, [logPost]);
  assert.equal(routes[0].data.category, '日志');

  delete global.hexo;
});
