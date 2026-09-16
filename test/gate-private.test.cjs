const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gatePrivate = require('../scripts/gate-private.js');

function makePost(overrides) {
  return Object.assign({
    title: '文章',
    path: '2026/09/16/slug/',
    excerpt: '',
  }, overrides);
}

test('private 标记只认 true 与字符串 true', () => {
  assert.equal(gatePrivate.isPrivatePost(makePost({ private: true })), true);
  assert.equal(gatePrivate.isPrivatePost(makePost({ private: 'true' })), true);
  assert.equal(gatePrivate.isPrivatePost(makePost({ private: false })), false);
  assert.equal(gatePrivate.isPrivatePost(makePost({ private: 'false' })), false);
  assert.equal(gatePrivate.isPrivatePost(makePost({})), false);
  assert.equal(gatePrivate.isPrivatePost(null), false);
});

test('产物路径与 URL 由 Hexo 的 post.path 推导', () => {
  assert.equal(gatePrivate.postOutputFile('2026/09/16/slug/'), '2026/09/16/slug/index.html');
  assert.equal(gatePrivate.postOutputFile('about/index.html'), 'about/index.html');
  assert.equal(gatePrivate.postOutputFile(''), '');
  assert.equal(gatePrivate.postUrl('2026/09/16/slug/'), '/2026/09/16/slug/');
  assert.equal(gatePrivate.postUrl('/2026/09/16/slug/'), '/2026/09/16/slug/');
  assert.equal(gatePrivate.postUrl(''), '/');
});

test('私密文章的摘要被占位符覆盖，公开文章一个字不动', () => {
  const privatePost = makePost({ private: true, excerpt: '作者自己写的摘要' });
  const publicPost = makePost({ excerpt: '公开文章自己的摘要' });

  assert.equal(gatePrivate.applyPrivateExcerpt(privatePost), true);
  assert.equal(privatePost.excerpt, gatePrivate.PLACEHOLDER, '私密文章摘要必须被占位符覆盖');
  assert.equal(gatePrivate.applyPrivateExcerpt(publicPost), false);
  assert.equal(publicPost.excerpt, '公开文章自己的摘要', '公开文章的摘要不该被碰');
});

test('清单只收 private 标记的文章', () => {
  const manifest = gatePrivate.collectPrivatePosts([
    makePost({ title: '小高の飞行器安装日记', path: '2026/09/16/slug/', private: true }),
    makePost({ title: '公开文章', path: '2026/08/15/welcome/' }),
  ]);

  assert.deepEqual(manifest, [{
    file: '2026/09/16/slug/index.html',
    url: '/2026/09/16/slug/',
    title: '小高の飞行器安装日记',
  }]);
});

test('清单写盘格式稳定，供 gate:build 读取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-private-'));
  const filePath = path.join(dir, 'output', 'private-posts.json');
  const manifest = [{ file: 'a/index.html', url: '/a/', title: 'A' }];

  gatePrivate.writeManifest(manifest, filePath);

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(parsed.posts, manifest);
  assert.ok(parsed.generatedAt, '应带生成时间，便于排查线上是哪次构建');
});
