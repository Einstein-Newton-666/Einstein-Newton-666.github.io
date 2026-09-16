const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const doc = require('../source/admin/js/editor-doc.js');

const postsDirectory = path.join(__dirname, '../source/_posts');

/* ------------------------- front-matter 解析 ------------------------- */

test('解析带 front-matter 的文章，键顺序与未知键都保留', () => {
  const source = [
    '---',
    'title: 你好，世界 —— 第一篇日志',
    'date: 2026-08-15 21:00:00',
    'categories: [日志]',
    'tags: [随笔, 第一篇]',
    'mathjax: true',
    'cover: /images/brand/firefly-side.webp',
    'excerpt: 欢迎来到这片记录技术、生活与灵感的私人空间。',
    'custom_plugin_key: keep-me',
    '---',
    '',
    '这是站点的第一篇文章。',
    '',
  ].join('\n');

  const parsed = doc.parseDocument(source);
  assert.equal(parsed.hasFrontMatter, true);
  assert.match(parsed.body, /这是站点的第一篇文章。/);

  const meta = doc.toPlainObject(parsed);
  assert.equal(meta.title, '你好，世界 —— 第一篇日志');
  assert.equal(meta.date, '2026-08-15 21:00:00');
  assert.deepEqual(meta.categories, ['日志']);
  assert.deepEqual(meta.tags, ['随笔', '第一篇']);
  assert.equal(meta.mathjax, true);
  assert.equal(meta.cover, '/images/brand/firefly-side.webp');
  assert.equal(meta.custom_plugin_key, 'keep-me');
  assert.deepEqual(Object.keys(meta), [
    'title', 'date', 'categories', 'tags', 'mathjax', 'cover', 'excerpt', 'custom_plugin_key',
  ]);
});

test('只有 front-matter、正文为空的文章（安装日记的真实形态）可解析', () => {
  const source = [
    '---',
    'title: 小高の飞行器安装日记',
    'date: 2026-09-16 09:00:00',
    'categories: [日志]',
    'tags: [随笔, 飞行器]',
    'mathjax: false',
    'cover: /images/brand/log-gothic-library.webp',
    '---',
    '',
    '',
  ].join('\n');

  const parsed = doc.parseDocument(source);
  assert.equal(parsed.hasFrontMatter, true);
  const meta = doc.toPlainObject(parsed);
  assert.equal(meta.title, '小高の飞行器安装日记');
  assert.equal(meta.mathjax, false);
  assert.equal(parsed.body.trim(), '');
});

test('没有 front-matter 的文件原样当正文处理', () => {
  const parsed = doc.parseDocument('# 只有正文\n\n没有元信息。\n');
  assert.equal(parsed.hasFrontMatter, false);
  assert.equal(parsed.body, '# 只有正文\n\n没有元信息。\n');
});

test('CRLF 与 BOM 的文章能被正确解析', () => {
  const source = '\uFEFF---\r\ntitle: 测试\r\ndate: 2026-01-02 03:04:05\r\n---\r\n\r\n正文\r\n';
  const parsed = doc.parseDocument(source);
  assert.equal(parsed.hasFrontMatter, true);
  assert.equal(parsed.bom, true);
  const meta = doc.toPlainObject(parsed);
  assert.equal(meta.title, '测试');
  assert.match(parsed.body, /正文/);
});

/* ------------------------- 序列化最小化 diff ------------------------- */

test('只改一个字段时，其余行逐字保持原样', () => {
  const source = [
    '---',
    'title: 旧标题',
    'date: 2026-08-15 21:00:00',
    'categories: [日志]',
    'mathjax: true',
    '# 这是注释，必须保留',
    'theme_custom: 123',
    '---',
    '',
    '正文内容',
  ].join('\n');

  const parsed = doc.parseDocument(source);
  const output = doc.serializeDocument(parsed, { title: '新标题' });

  assert.match(output, /^---\ntitle: 新标题\n/);
  assert.match(output, /date: 2026-08-15 21:00:00/);
  assert.match(output, /categories: \[日志\]/);
  assert.match(output, /mathjax: true/);
  assert.match(output, /# 这是注释，必须保留/);
  assert.match(output, /theme_custom: 123/);
  assert.match(output, /\n---\n\n正文内容$/);

  // 未提供的键不应被删除或重排
  const roundTrip = doc.toPlainObject(doc.parseDocument(output));
  assert.deepEqual(Object.keys(roundTrip), ['title', 'date', 'categories', 'mathjax', 'theme_custom']);
  assert.equal(roundTrip.title, '新标题');
  assert.equal(roundTrip.theme_custom, '123');
});

test('不传任何改动时序列化结果与原文一致', () => {
  const source = readFileSync(path.join(postsDirectory, 'welcome.md'), 'utf8');
  const parsed = doc.parseDocument(source);
  const output = doc.serializeDocument(parsed, {});
  assert.equal(output, source);
});

test('新增字段追加在已有字段之后，不打断原有顺序', () => {
  const parsed = doc.parseDocument('---\ntitle: 标题\ndate: 2026-08-15 21:00:00\n---\n\n正文\n');
  const output = doc.serializeDocument(parsed, { title: '标题', updated: '2026-09-16 10:00:00' });
  const meta = doc.toPlainObject(doc.parseDocument(output));
  assert.deepEqual(Object.keys(meta), ['title', 'date', 'updated']);
  assert.equal(meta.updated, '2026-09-16 10:00:00');
});

test('包含冒号或特殊字符的值会被安全引用且可回读', () => {
  const parsed = doc.parseDocument('---\ntitle: 标题\n---\n\n正文\n');
  const cases = [
    '带: 冒号',
    '带 # 井号',
    '  前后有空格  ',
    "含 ' 单引号",
    '含 " 双引号',
    '123',
    'true',
    '[像数组]',
  ];
  for (const value of cases) {
    const output = doc.serializeDocument(parsed, { title: value });
    const meta = doc.toPlainObject(doc.parseDocument(output));
    assert.equal(meta.title, value, `值 ${JSON.stringify(value)} 回读不一致`);
  }
});

test('已知字段按固定顺序补齐（updated 等），未知字段也能写入', () => {
  const parsed = doc.parseDocument('---\ntitle: 标题\n---\n\n正文\n');
  const output = doc.serializeDocument(parsed, {
    excerpt: '摘要',
    mathjax: false,
    tags: ['a', 'b'],
    categories: [],
    date: '2026-09-16 09:00:00',
    title: '标题',
    my_plugin_field: 'x',
  });
  const meta = doc.toPlainObject(doc.parseDocument(output));
  assert.equal(meta.title, '标题');
  assert.deepEqual(meta.tags, ['a', 'b']);
  assert.deepEqual(meta.categories, []);
  assert.equal(meta.mathjax, false);
  assert.equal(meta.my_plugin_field, 'x');

  const keys = Object.keys(meta);
  const order = doc.KEY_ORDER;
  const known = keys.filter((key) => order.includes(key));
  assert.deepEqual(known, [...known].sort((a, b) => order.indexOf(a) - order.indexOf(b)), '已知字段应按规范顺序排列');
  assert.equal(keys[0], 'title');
  assert.ok(keys.indexOf('date') < keys.indexOf('categories'), 'date 应排在 categories 之前');
  assert.equal(keys[keys.length - 1], 'my_plugin_field', '未知字段排在已知字段之后');
});

/* ------------------------- 命名与路径安全 ------------------------- */

test('文件名校验拦截路径穿越与非法字符', () => {
  const bad = ['../evil', 'a/b', 'a\\b', '..', '.', '.hidden', 'a:b', 'a*b', 'a?b', 'con', 'NUL', '', 'x'.repeat(101)];
  for (const slug of bad) {
    assert.equal(doc.validateSlug(slug).ok, false, `应拒绝：${JSON.stringify(slug)}`);
  }
  for (const slug of ['hello-world', '小高の飞行器安装日记', 'post_2026.09', 'a1']) {
    assert.equal(doc.validateSlug(slug).ok, true, `应接受：${JSON.stringify(slug)}`);
  }
});

test('由标题生成文件名时去掉路径分隔符与空白', () => {
  assert.equal(doc.slugify('小高の飞行器安装日记'), '小高の飞行器安装日记');
  assert.equal(doc.slugify('Hello  World'), 'Hello-World');
  assert.equal(doc.slugify('a/b\\c:d'), 'abcd');
  assert.equal(doc.slugify('   '), `post-${doc.formatBeijingDate().slice(0, 10)}`);
});

test('文章路径与资源目录互为同名约定', () => {
  assert.equal(doc.postPath('my-post'), 'source/_posts/my-post.md');
  assert.equal(doc.assetDir('my-post'), 'source/_posts/my-post');
  assert.equal(doc.assetPath('my-post', 'logo.svg'), 'source/_posts/my-post/logo.svg');
  assert.equal(doc.slugFromPath('source/_posts/my-post.md'), 'my-post');
  assert.equal(doc.slugFromPath('source/_posts/my-post/logo.svg'), null);
  assert.equal(doc.isPostPath('source/_posts/my-post.md'), true);
  assert.equal(doc.isPostPath('source/about/index.md'), false);
  assert.equal(doc.isPostPath('source/_posts/nested/deep.md'), false);
});

/* ------------------------- 资源引用与校验 ------------------------- */

test('能提取正文引用的资源文件名，并识别缺失', () => {
  const body = [
    '{% asset_img logo.svg "站点图标" %}',
    '{% asset_img 封面图.webp %}',
    '{% asset_link manual.pdf "手册" %}',
    '{% asset_img logo.svg %}',
  ].join('\n\n');
  assert.deepEqual(doc.referencedAssets(body), ['logo.svg', '封面图.webp', 'manual.pdf']);

  const result = doc.validatePost({
    slug: 'demo',
    meta: { title: '演示', date: '2026-09-16 09:00:00', categories: ['笔记'], mathjax: false },
    body,
    assetFiles: ['logo.svg'],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /封面图\.webp/);
  assert.match(result.errors.join(' '), /manual\.pdf/);
});

test('校验拦截空标题、坏日期与非数组标签', () => {
  const result = doc.validatePost({
    slug: 'demo',
    meta: { title: '   ', date: '2026/09/16', categories: '日志', mathjax: 'yes' },
    body: '正文',
    assetFiles: [],
  });
  assert.equal(result.ok, false);
  const joined = result.errors.join(' ');
  assert.match(joined, /title 不能为空/);
  assert.match(joined, /date/);
  assert.match(joined, /categories 需为数组/);
  assert.match(joined, /mathjax/);
});

test('公式未开启 mathjax、未分类、空正文给出警告而非报错', () => {
  const result = doc.validatePost({
    slug: 'demo',
    meta: { title: '演示', date: '2026-09-16 09:00:00', categories: [], mathjax: false },
    body: '质能方程 $E = mc^2$',
    assetFiles: [],
  });
  assert.equal(result.ok, true);
  const joined = result.warnings.join(' ');
  assert.match(joined, /mathjax/);
  assert.match(joined, /未设置分类/);
});

test('正文为空时给出提醒', () => {
  const result = doc.validatePost({
    slug: 'xiaogao-hikouki-install-diary',
    meta: { title: '小高の飞行器安装日记', date: '2026-09-16 09:00:00', categories: ['日志'], mathjax: false },
    body: '',
    assetFiles: [],
  });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /正文还是空的/);
});

test('封面使用站内路径以外的写法只警告不拦截', () => {
  const result = doc.validatePost({
    slug: 'demo',
    meta: { title: '演示', date: '2026-09-16 09:00:00', categories: ['日志'], mathjax: false, cover: 'https://example.com/a.webp' },
    body: '正文',
    assetFiles: [],
  });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join(' '), /站内路径/);
});

/* ------------------------- 新建文章与其它工具 ------------------------- */

test('新建文章字段顺序与 scaffolds/post.md 一致', () => {
  const source = doc.createPostSource({ title: '新文章', date: '2026-09-16 09:00:00', categories: ['笔记'], tags: ['标签'] });
  const keys = doc.parseBlockLines(doc.parseDocument(source).frontMatterRaw).filter((entry) => entry.key).map((entry) => entry.key);
  assert.deepEqual(keys, ['title', 'date', 'categories', 'tags', 'mathjax', 'cover']);

  const scaffold = readFileSync(path.join(__dirname, '../scaffolds/post.md'), 'utf8');
  const scaffoldKeys = doc.parseBlockLines(doc.parseDocument(scaffold.replace('{{ title }}', 'x').replace('{{ date }}', 'y')).frontMatterRaw)
    .filter((entry) => entry.key)
    .map((entry) => entry.key);
  assert.deepEqual(keys, scaffoldKeys);
});

test('北京时间格式化与 _config.yml 的 timezone 一致', () => {
  const formatted = doc.formatBeijingDate(new Date('2026-09-16T01:30:00Z'));
  assert.equal(formatted, '2026-09-16 09:30:00');
});

test('字数统计把中日韩字符与英文单词分别计数，阅读时间至少 1 分钟', () => {
  assert.equal(doc.wordCount('你好世界 hello world'), 4 + 2);
  assert.equal(doc.wordCount('![图片](a.png) `code`'), 1);
  assert.equal(doc.readingMinutes(0), 1);
  assert.equal(doc.readingMinutes(900), 3);
});

test('图片类型与 MIME 对应，重名自动加后缀', () => {
  assert.equal(doc.isImageName('a.WEBP'), true);
  assert.equal(doc.isImageName('a.pdf'), false);
  assert.equal(doc.extensionForMime('image/jpeg'), 'jpg');
  assert.equal(doc.extensionForMime('application/pdf'), null);
  assert.equal(doc.uniqueAssetName('logo.svg', ['logo.svg']), 'logo-2.svg');
  assert.equal(doc.uniqueAssetName('logo.svg', ['logo.svg', 'logo-2.svg']), 'logo-3.svg');
  assert.equal(doc.uniqueAssetName('logo.svg', ['other.svg']), 'logo.svg');
  assert.equal(doc.uniqueAssetName('无扩展名', ['无扩展名']), '无扩展名-2');
});

test('asset_img 标签生成时去掉会破坏语法或引发 XSS 的字符', () => {
  assert.equal(doc.assetImageTag('logo.svg'), '{% asset_img logo.svg %}');
  assert.equal(doc.assetImageTag('logo.svg', '站点图标'), '{% asset_img logo.svg "站点图标" %}');
  assert.equal(doc.assetImageTag('a"b.svg', 'x" onload="alert(1)'), '{% asset_img ab.svg "x onload=alert(1)" %}');

  const dangerous = doc.assetImageTag('a"b.svg', 'x" onload="alert(1)');
  assert.equal((dangerous.match(/"/g) || []).length, 2, '描述里不能出现多余的引号');
  assert.doesNotMatch(dangerous, /onload="/, '不能拼出可执行的属性');
  assert.match(dangerous, /^\{% asset_img \S+ "[^"]*" %\}$/, '标签结构必须合法');
  assert.equal(doc.assetImageTag('sp ace.png'), '{% asset_img sp-ace.png %}');
});

test('文章地址按 permalink 规则生成', () => {
  assert.equal(
    doc.permalinkFor({ date: '2026-08-15 21:00:00', slug: 'welcome' }, 'https://einstein-newton-666.github.io/'),
    'https://einstein-newton-666.github.io/2026/08/15/welcome/',
  );
  assert.equal(doc.permalinkFor({ date: '2026-08-15 21:00:00', slug: '中文标题' }, ''), '/2026/08/15/%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98/');
  assert.equal(doc.permalinkFor({ date: '', slug: 'welcome' }, ''), '');
});

/* ------------------------- 发布客户端（对拍 mock GitHub API） ------------------------- */

const http = require('node:http');
const publish = require('../source/admin/js/editor-publish.js');

function startMockGitHub(state) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = req.url;
      calls.push({ method: req.method, url, body, authorization: req.headers.authorization });
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'GET' && /\/commits\/main$/.test(url)) {
        return send(200, { sha: state.headSha, commit: { committer: { date: '2026-09-16T01:00:00Z' }, message: state.headMessage || '内容：上一篇文章\n\n说明' } });
      }
      if (req.method === 'GET' && /\/git\/commits\//.test(url)) {
        return send(200, { sha: state.headSha, tree: { sha: state.treeSha } });
      }
      if (req.method === 'GET' && /\/git\/trees\//.test(url)) {
        return send(200, { sha: state.treeSha, truncated: false, tree: state.tree || [] });
      }
      if (req.method === 'GET' && /\/contents\//.test(url)) {
        const entry = state.tree.find((item) => url.includes(item.path.split('/').map(encodeURIComponent).join('/')));
        if (!entry) return send(404, { message: 'Not Found' });
        return send(200, { path: entry.path, sha: entry.sha, encoding: 'base64', content: Buffer.from(state.files[entry.path], 'utf8').toString('base64') });
      }
      if (req.method === 'GET' && /\/git\/blobs\//.test(url)) {
        const sha = url.split('/').pop();
        const entry = state.tree.find((item) => item.sha === sha);
        if (!entry) return send(404, { message: 'Not Found' });
        return send(200, { sha, encoding: 'base64', content: Buffer.from(state.files[entry.path], 'utf8').toString('base64') });
      }
      if (req.method === 'POST' && /\/git\/blobs$/.test(url)) {
        state.blobCount += 1;
        const sha = `blob-${state.blobCount}`;
        state.blobs.set(sha, Buffer.from(body.content, 'base64'));
        return send(201, { sha });
      }
      if (req.method === 'POST' && /\/git\/trees$/.test(url)) {
        state.lastTree = body.tree;
        return send(201, { sha: `tree-${state.headSha}` });
      }
      if (req.method === 'POST' && /\/git\/commits$/.test(url)) {
        state.commits.push(body);
        return send(201, { sha: 'commit-new-1' });
      }
      if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(url)) {
        if (state.rejectRefUpdate) return send(422, { message: 'Update is not a fast forward' });
        return send(200, { object: { sha: body.sha } });
      }
      return send(404, { message: `mock 未实现：${req.method} ${url}` });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      calls,
      server,
      apiRoot: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

const baseState = (overrides = {}) => Object.assign({
  headSha: 'head-aaa',
  treeSha: 'tree-aaa',
  tree: [{ path: 'source/_posts/welcome.md', type: 'blob', sha: 'blob-welcome' }],
  files: { 'source/_posts/welcome.md': '---\ntitle: 欢迎\n---\n\n正文\n' },
  blobs: new Map(),
  blobCount: 0,
  commits: [],
  treeShaNew: 'tree-new',
  headMessage: '内容：上一篇文章\n\n说明',
}, overrides);

test('读取仓库头提交与文件内容（含中文路径）', async () => {
  const state = baseState();
  const mock = await startMockGitHub(state);
  try {
    const client = publish.createClient({ owner: 'me', repo: 'blog', token: 'ghp_example0000000000000000000000000000', fetch, apiRoot: mock.apiRoot });
    const head = await client.getHead();
    assert.equal(head.sha, 'head-aaa');
    assert.equal(head.message, '内容：上一篇文章');

    const file = await client.getFile('source/_posts/welcome.md');
    assert.match(file.content, /正文/);

    const tree = await client.getTree();
    assert.equal(tree.entries.length, 1);
    assert.equal(tree.truncated, false);
  } finally {
    await mock.close();
  }
});

test('提交文章与图片走一次原子提交：blob → tree → commit → 更新 ref', async () => {
  const state = baseState();
  const mock = await startMockGitHub(state);
  try {
    const client = publish.createClient({ owner: 'me', repo: 'blog', token: 'ghp_example0000000000000000000000000000', fetch, apiRoot: mock.apiRoot });
    const result = await client.putFiles(
      [
        { path: 'source/_posts/新文章.md', content: '---\ntitle: 新文章\n---\n\n正文\n' },
        { path: 'source/_posts/新文章/图.webp', content: 'BINARY-ISH' },
      ],
      { message: '日志：新增《新文章》', expectedHead: 'head-aaa' },
    );

    assert.equal(result.sha, 'commit-new-1');
    assert.equal(result.previousSha, 'head-aaa');
    assert.deepEqual(result.files, ['source/_posts/新文章.md', 'source/_posts/新文章/图.webp']);

    const blobCalls = mock.calls.filter((call) => call.method === 'POST' && /\/git\/blobs$/.test(call.url));
    assert.equal(blobCalls.length, 2, '每份内容一个 blob');
    assert.equal(Buffer.from(blobCalls[0].body.content, 'base64').toString('utf8'), '---\ntitle: 新文章\n---\n\n正文\n');
    assert.equal(blobCalls[0].body.encoding, 'base64');

    const treeCall = mock.calls.find((call) => call.method === 'POST' && /\/git\/trees$/.test(call.url));
    assert.equal(treeCall.body.base_tree, 'tree-aaa', '必须基于 HEAD 的 tree，避免覆盖其它改动');
    assert.deepEqual(treeCall.body.tree.map((item) => item.path), ['source/_posts/新文章.md', 'source/_posts/新文章/图.webp']);

    const commitCall = mock.calls.find((call) => call.method === 'POST' && /\/git\/commits$/.test(call.url));
    assert.equal(commitCall.body.message, '日志：新增《新文章》');
    assert.deepEqual(commitCall.body.parents, ['head-aaa']);

    const refCall = mock.calls.find((call) => call.method === 'PATCH');
    assert.equal(refCall.body.sha, 'commit-new-1');
    assert.equal(refCall.body.force, false, '不允许强推');
    assert.match(refCall.url, /\/git\/refs\/heads\/main$/);

    assert.ok(mock.calls.every((call) => call.authorization === 'Bearer ghp_example0000000000000000000000000000'));
  } finally {
    await mock.close();
  }
});

test('删除文章用 sha:null 表达，与正文改动合并到同一棵 tree', async () => {
  const state = baseState();
  const mock = await startMockGitHub(state);
  try {
    const client = publish.createClient({ owner: 'me', repo: 'blog', token: 'ghp_example0000000000000000000000000000', fetch, apiRoot: mock.apiRoot });
    await client.putFiles(
      [{ path: 'source/_posts/keep.md', content: 'x' }],
      { message: '维护：删除文章', deletions: ['source/_posts/old.md', 'source/_posts/old/图.png'], expectedHead: 'head-aaa' },
    );
    const treeCall = mock.calls.find((call) => call.method === 'POST' && /\/git\/trees$/.test(call.url));
    const removed = treeCall.body.tree.filter((item) => item.sha === null).map((item) => item.path);
    assert.deepEqual(removed, ['source/_posts/old.md', 'source/_posts/old/图.png']);
  } finally {
    await mock.close();
  }
});

test('远端 HEAD 变化时报冲突并且不写任何东西', async () => {
  const state = baseState({ headSha: 'head-bbb' });
  const mock = await startMockGitHub(state);
  try {
    const client = publish.createClient({ owner: 'me', repo: 'blog', token: 'ghp_example0000000000000000000000000000', fetch, apiRoot: mock.apiRoot });
    await assert.rejects(
      () => client.putFiles([{ path: 'source/_posts/a.md', content: 'x' }], { expectedHead: 'head-aaa' }),
      (error) => {
        assert.equal(error.code, 'CONFLICT');
        assert.equal(error.remoteSha, 'head-bbb');
        assert.match(error.message, /远端已有新提交/);
        return true;
      },
    );
    assert.equal(mock.calls.filter((call) => call.method === 'POST').length, 0, '冲突时不得发出任何写请求');
    assert.equal(mock.calls.filter((call) => call.method === 'PATCH').length, 0);
  } finally {
    await mock.close();
  }
});

test('令牌失效、权限不足、限流都有可读提示且不泄漏令牌', async () => {
  const state = baseState();
  const mock = await startMockGitHub(state);
  try {
    const token = 'ghp_secretsecretsecretsecretsecret1234';
    const client = publish.createClient({ owner: 'me', repo: 'blog', token, fetch, apiRoot: mock.apiRoot });
    state.headSha = 'head-aaa';

    const originalFetch = globalThis.fetch;
    const fakeFetch = (url, init) => {
      const status = Number(init?.headers?.['X-Test-Status'] || 0);
      if (status) {
        return Promise.resolve(new Response(JSON.stringify(status === 403 ? { message: 'API rate limit exceeded' } : { message: 'Bad credentials' }), { status }));
      }
      return originalFetch(url, init);
    };
    const limited = publish.createClient({ owner: 'me', repo: 'blog', token, fetch: fakeFetch, apiRoot: mock.apiRoot });
    limited.getHead = client.getHead;

    for (const [status, pattern] of [[401, /令牌无效或已过期/], [403, /限流|权限/]]) {
      const failing = publish.createClient({
        owner: 'me',
        repo: 'blog',
        token,
        apiRoot: mock.apiRoot,
        fetch: () => Promise.resolve(new Response(JSON.stringify(status === 403 ? { message: 'API rate limit exceeded for user' } : { message: 'Bad credentials' }), { status })),
      });
      await assert.rejects(() => failing.getHead(), (error) => {
        assert.match(error.message, pattern);
        assert.doesNotMatch(error.message, /ghp_secretsecretsecretsecretsecret1234/, '错误信息中不得出现完整令牌');
        return true;
      });
    }
  } finally {
    await mock.close();
  }
});

test('令牌脱敏保留可辨识前缀与后缀', () => {
  const masked = publish.maskToken('请求失败：token ghp_abcdefghijklmnopqrstuvwxyz012345 无效');
  assert.doesNotMatch(masked, /ghp_abcdefghijklmnopqrstuvwxyz012345/);
  assert.match(masked, /ghp_abc…2345/);
  assert.equal(publish.maskToken('没有令牌'), '没有令牌');
});

test('中文路径按段编码，路径穿越在文档层已被拒绝（此处验证编码行为）', () => {
  assert.equal(publish.encodePath('source/_posts/新文章/图 1.png'), 'source/_posts/%E6%96%B0%E6%96%87%E7%AB%A0/%E5%9B%BE%201.png');
  assert.equal(publish.encodeBase64('中文'), Buffer.from('中文', 'utf8').toString('base64'));
  assert.equal(publish.decodeBase64(Buffer.from('中文', 'utf8').toString('base64')), '中文');
  assert.equal(publish.decodeBase64(publish.encodeBase64('emoji 🦜 与公式 $E=mc^2$')), 'emoji 🦜 与公式 $E=mc^2$');
});


/* ------------------------- 工具条变换 ------------------------- */

const toolbar = require('../source/admin/js/editor-toolbar.js');

const run = (text, start, end, action, payload) => toolbar.applyTransform(text, start, end, action, payload);

test('加粗包裹选区，再次执行取消包裹', () => {
  const first = run('这是重点内容', 2, 4, 'bold');
  assert.equal(first.text, '这是**重点**内容');
  assert.equal(first.text.slice(first.selectionStart, first.selectionEnd), '重点');

  const second = run(first.text, first.selectionStart, first.selectionEnd, 'bold');
  assert.equal(second.text, '这是重点内容');
});

test('没有选区时加粗插入成对标记并把光标放到中间', () => {
  const result = run('abc', 3, 3, 'bold');
  assert.equal(result.text, 'abc****');
  assert.equal(result.selectionStart, 5);
  assert.equal(result.selectionEnd, 5);
});

test('标题在 H2 与正文之间切换，不叠加井号', () => {
  const h2 = run('小标题', 0, 0, 'heading', { level: 2 });
  assert.equal(h2.text, '## 小标题');
  const h3 = run(h2.text, 0, 0, 'heading', { level: 3 });
  assert.equal(h3.text, '### 小标题');
  const plain = run(h3.text, 0, 0, 'heading', { level: 3 });
  assert.equal(plain.text, '小标题');
});

test('列表整块切换，保留缩进且不重复加标记', () => {
  const source = '第一行\n  第二行';
  const bulleted = run(source, 0, source.length, 'bullet');
  assert.equal(bulleted.text, '- 第一行\n  - 第二行');
  const unbullted = run(bulleted.text, 0, bulleted.text.length, 'bullet');
  assert.equal(unbullted.text, '第一行\n  第二行');
  const ordered = run(source, 0, source.length, 'ordered');
  assert.equal(ordered.text, '1. 第一行\n  2. 第二行');
});

test('引用块整块切换', () => {
  const quoted = run('甲\n乙', 0, 3, 'quote');
  assert.equal(quoted.text, '> 甲\n> 乙');
  const unquoted = run(quoted.text, 0, quoted.text.length, 'quote');
  assert.equal(unquoted.text, '甲\n乙');
});

test('代码围栏成对插入与移除', () => {
  const fenced = run('const a = 1;', 0, 12, 'fence', { language: 'js' });
  assert.equal(fenced.text, '```js\nconst a = 1;\n```');
  const unfenced = run(fenced.text, 0, fenced.text.length, 'fence');
  assert.equal(unfenced.text, 'const a = 1;');
});

test('链接用选中文字做锚文本', () => {
  const result = run('见 官方文档 说明', 2, 6, 'link', { url: 'https://hexo.io' });
  assert.equal(result.text, '见 [官方文档](https://hexo.io) 说明');
  assert.equal(result.text.slice(result.selectionStart, result.selectionEnd), '官方文档');
});

test('块级插入自动补空行，避免粘在上一段后面', () => {
  const result = run('正文一段', 4, 4, 'block', { snippet: '$$\nE = mc^2\n$$' });
  assert.match(result.text, /正文一段\n\n\$\$\nE = mc\^2\n\$\$\n$/);
  const atStart = run('', 0, 0, 'block', { snippet: '{% asset_img a.png %}' });
  assert.equal(atStart.text, '{% asset_img a.png %}\n');
});

test('Tab 缩进与 Shift+Tab 反缩进（单行与多行）', () => {
  const single = run('abc', 1, 1, 'indent');
  assert.equal(single.text, '  abc');
  const multi = run('甲\n乙', 0, 3, 'indent');
  assert.equal(multi.text, '  甲\n  乙');
  const back = run(multi.text, 0, multi.text.length, 'outdent');
  assert.equal(back.text, '甲\n乙');
});

test('插入表格生成表头、分隔行与数据行', () => {
  const result = run('', 0, 0, 'table', { rows: 4, columns: 3 });
  const lines = result.text.trim().split('\n');
  assert.equal(lines.length, 4, 'rows=4 应为表头 + 分隔 + 2 行数据');
  assert.match(lines[0], /^\| 列1 \| 列2 \| 列3 \|$/);
  assert.match(lines[1], /^\| --- \| --- \| --- \|$/);
});

test('越界选区不会抛错（防御性）', () => {
  const result = run('短文本', 100, 200, 'bold');
  assert.equal(result.text, '短文本****');
});

/* ------------------------- 预览 ------------------------- */

const preview = require('../source/admin/js/editor-preview.js');

test('降级预览渲染标题、列表、代码与配图占位', () => {
  const html = preview.renderFallback([
    '## 标题',
    '',
    '- 甲',
    '- 乙',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '{% asset_img logo.svg "站点图标" %}',
    '',
    '**粗体** 与 `代码`',
  ].join('\n'));

  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<ul>\s*<li>甲<\/li>\s*<li>乙<\/li>\s*<\/ul>/);
  assert.match(html, /<pre class="preview-code"><code data-language="js">const a = 1;<\/code><\/pre>/);
  assert.match(html, /［配图：logo\.svg（站点图标）］/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
});

test('降级预览转义 HTML，避免把正文当标签执行', () => {
  const html = preview.renderFallback('<script>alert(1)</script> 与 <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(preview.escapeHtml('a"b\'c<d>&'), 'a&quot;b&#39;c&lt;d&gt;&amp;');
});

test('精确预览不可用时降级并记录原因，可用时返回真实渲染', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/api/health')) return { ok: true, json: async () => ({ ok: true, service: 'blog-editor-preview' }) };
    if (url.includes('/api/render')) {
      return { ok: true, json: async () => ({ ok: true, html: '<p>真实渲染</p>', warnings: ['引用了不存在的资源：x.png'], ms: 12 }) };
    }
    throw new Error(`未预期的请求 ${url}`);
  };
  try {
    const controller = preview.createController({ endpoint: 'http://127.0.0.1:4001' });
    controller.setMode('exact');
    const health = await controller.checkExact();
    assert.equal(health.ok, true);
    assert.equal(health.service, 'blog-editor-preview');

    const exact = await controller.render({ markdown: '正文', slug: 'demo' });
    assert.equal(exact.mode, 'exact');
    assert.equal(exact.html, '<p>真实渲染</p>');
    assert.deepEqual(exact.warnings, ['引用了不存在的资源：x.png']);
    const renderCall = calls.find((call) => call.url.includes('/api/render'));
    assert.equal(JSON.parse(renderCall.init.body).slug, 'demo');

    globalThis.fetch = async () => { throw new Error('连接被拒绝'); };
    const broken = preview.createController({ endpoint: 'http://127.0.0.1:4001' });
    broken.setMode('exact');
    const fallback = await broken.render({ markdown: '**粗**', slug: 'demo' });
    assert.equal(fallback.mode, 'fallback');
    assert.match(fallback.html, /<strong>粗<\/strong>/);
    assert.match(fallback.error, /连接被拒绝/);
    assert.equal(broken.getMode(), 'fallback');

    const healthFail = await broken.checkExact();
    assert.equal(healthFail.ok, false);
    assert.match(healthFail.error, /未检测到本机预览服务|连接被拒绝/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ------------------- 完整链路（不走浏览器默认 fetch） ------------------- */

test('完整链路：默认 fetch + 登录 → 列文章 → 读文章 → 校验 → 提交', async () => {
  const state = baseState({
    tree: [
      { path: 'source/_posts/welcome.md', type: 'blob', sha: 'blob-welcome' },
      { path: 'source/_posts/welcome/logo.svg', type: 'blob', sha: 'blob-logo' },
    ],
  });
  const mock = await startMockGitHub(state);
  try {
    // 刻意不传 fetch：走模块默认的 globalThis.fetch，与浏览器里是同一条路径
    const client = publish.createClient({
      owner: 'Einstein-Newton-666',
      repo: 'Einstein-Newton-666.github.io',
      token: 'github_pat_11ABCDEFG_example_token_value_1234567890',
      apiRoot: mock.apiRoot,
    });

    const head = await client.getHead();
    assert.equal(head.sha, 'head-aaa', '登录第一步：读取远端 HEAD');

    const tree = await client.getTree();
    const posts = tree.entries.filter((entry) => doc.isPostPath(entry.path));
    assert.deepEqual(posts.map((post) => doc.slugFromPath(post.path)), ['welcome'], '第二步：列出文章');

    const file = await client.getFile('source/_posts/welcome.md');
    const parsed = doc.parseDocument(file.content);
    const meta = doc.toPlainObject(parsed);
    assert.equal(meta.title, '欢迎', '第三步：读取并解析 front-matter');

    const assetFiles = tree.entries
      .filter((entry) => entry.path.startsWith('source/_posts/welcome/'))
      .map((entry) => entry.path.split('/').pop());
    const check = doc.validatePost({ slug: 'welcome', meta, body: parsed.body, assetFiles });
    assert.equal(check.ok, true, `第四步：保存前校验（${check.errors.join('；')}）`);

    const result = await client.putFiles(
      [{ path: 'source/_posts/welcome.md', content: doc.serializeDocument(parsed, Object.assign({}, meta, { title: '欢迎（已改）' })) }],
      { message: '内容：更新《欢迎》', expectedHead: head.sha },
    );
    assert.equal(result.sha, 'commit-new-1', '第五步：提交');
    assert.equal(state.commits.length, 1);
    const submitted = Buffer.from([...state.blobs.values()][0], 'base64').toString('utf8');
    assert.match(submitted, /title: 欢迎（已改）/, '提交内容应包含改动后的标题');
    assert.match(submitted, /^---\n/, '提交内容应保留 front-matter');
  } finally {
    await mock.close();
  }
});

/* ------------------- 令牌创建链接（预填参数） ------------------- */

test('令牌创建链接预填名称、说明与 Contents 写权限', () => {
  const url = doc.tokenCreateUrl('Einstein-Newton-666/Einstein-Newton-666.github.io');
  assert.ok(url.startsWith('https://github.com/settings/personal-access-tokens/new?'), url);
  const query = new URLSearchParams(url.split('?')[1]);
  assert.match(query.get('name'), /博客编辑台/);
  assert.match(query.get('description'), /Contents/);
  assert.equal(query.get('contents'), 'write', '必须预选 Contents 写权限，否则编辑器无法提交');
  assert.doesNotMatch(url, /[^\x00-\x7F]/, 'URL 必须全为 ASCII（中文需编码）');
  assert.doesNotMatch(query.get('name'), /\s/, 'name 中的空格应被编码为 +');
});

test('令牌创建链接带仓库提示与有效期说明，但不含任何令牌或密钥', () => {
  const url = doc.tokenCreateUrl('me/blog');
  const query = new URLSearchParams(url.split('?')[1]);
  assert.match(query.get('description'), /me\/blog/, '说明里应写明目标仓库，便于日后辨认');
  assert.match(query.get('description'), /90/);
  assert.doesNotMatch(url, /gh[pousr]_|github_pat_/, '链接里绝不能出现令牌');
  assert.ok(!/client_secret|access_token/.test(url), '链接里不能出现任何密钥字段');
});

test('仓库名异常时链接仍然合法，不抛错', () => {
  for (const input of ['', null, undefined, 'no-slash', 'a/b/c', '  me/blog  ']) {
    const url = doc.tokenCreateUrl(input);
    assert.ok(url.startsWith('https://github.com/'), `${JSON.stringify(input)} → ${url}`);
    const query = new URLSearchParams(url.split('?')[1]);
    assert.equal(query.get('contents'), 'write');
  }
});

test('HTTPS 页面不默认尝试 http://127.0.0.1 的精确预览（避免混合内容被拦）', () => {
  const httpEndpoint = 'http://127.0.0.1:4001';
  const httpsEndpoint = 'https://127.0.0.1:4001';

  // 线上 /admin/ 是 https，混合内容会被浏览器拦截，必须默认降级
  assert.equal(preview.shouldAttemptExact('https:', httpEndpoint), false);
  // 同源 https 的本地服务（自签证书）允许尝试
  assert.equal(preview.shouldAttemptExact('https:', httpsEndpoint), true);
  // 本地开发是 http，允许尝试
  assert.equal(preview.shouldAttemptExact('http:', httpEndpoint), true);
  // 用 file:// 直接打开编辑器时也允许尝试
  assert.equal(preview.shouldAttemptExact('file:', httpEndpoint), true);
  assert.equal(preview.shouldAttemptExact(undefined, httpEndpoint), true);
});

/* ------------------- 文章页「编辑」按钮的注入 ------------------- */

const postEditLink = require('../scripts/post-edit-link.js');

test('识别文章页并从 URL 取出文件名（支持编码与反斜杠路径）', () => {
  assert.equal(postEditLink.slugFromPagePath('2026/08/15/welcome/index.html'), 'welcome');
  assert.equal(postEditLink.slugFromPagePath('2026/09/16/xiaogao-hikouki-install-diary/index.html'), 'xiaogao-hikouki-install-diary');
  assert.equal(postEditLink.slugFromPagePath('2026/09/16/小高の飞行器安装日记/index.html'), '小高の飞行器安装日记');
  assert.equal(postEditLink.slugFromPagePath('2026\\09\\16\\中文标题\\index.html'), '中文标题');
  // 非文章页
  for (const path of ['index.html', 'about/index.html', 'archives/2026/index.html', 'tags/index.html', 'admin/index.html', '404.html']) {
    assert.equal(postEditLink.slugFromPagePath(path), null, `不应识别为文章：${path}`);
  }
});

test('编辑按钮链接指向编辑台并带上文件名', () => {
  const button = postEditLink.buildEditButton('welcome');
  assert.match(button, /href="\/admin\/\?p=welcome"/);
  assert.match(button, /aria-label="编辑这篇文章"/);
  assert.match(button, /fa-pen-to-square/);
  assert.match(button, /data-einblog-edit/, '需要可识别的标记，便于校验与幂等注入');

  // 中文与需转义字符要编码，且不能破坏属性结构
  const tricky = postEditLink.buildEditButton('a"b<c>&d 中文');
  assert.match(tricky, /^<li class="einblog-edit-tool"[^>]*><a [^>]*><i [^>]*><\/i><\/a><\/li>$/, '标签结构必须完整');
  assert.match(tricky, /%22|%3C|%26|%20/, '特殊字符必须被 URL 编码');
  const href = tricky.match(/href="([^"]+)"/)[1];
  assert.doesNotMatch(href, /[<>"&\s]/, 'href 里不应残留需要转义的字符');
  assert.match(href, /^\/admin\/\?p=/, `href 应指向编辑台：${href}`);
});

test('编辑按钮样式内联，避免样式规则落在加密门的明文区', () => {
  const button = postEditLink.buildEditButton('welcome');
  assert.match(button, /<a href="[^"]*" style="[^"]*"[^>]*>/, '样式必须内联在 a 上');
  assert.doesNotMatch(button, /<style/, '按钮片段里不应带 <style>');
});

test('只给文章页注入按钮，且重复注入是幂等的', () => {
  const postPage = [
    '<html><head><title>t</title></head><body>',
    '<div class="post-tools-container"><ul class="article-tools-list">',
    '<li class="right-bottom-tools page-aside-toggle"><i class="fa-regular fa-outdent"></i></li>',
    '</ul></div>',
    '</body></html>',
  ].join('');
  const injected = postEditLink.injectEditLink(postPage, '2026/08/15/welcome/index.html');
  assert.match(injected, /\/admin\/\?p=welcome/);
  assert.match(injected, /data-einblog-edit/);
  assert.doesNotMatch(injected, /data-einblog-edit-style|<style/, '注入不应往 head 里塞 <style>（会明文泄漏）');
  // 注入两次结果一致
  assert.equal(postEditLink.injectEditLink(injected, '2026/08/15/welcome/index.html'), injected);

  // 非文章页原样返回
  const about = '<html><head></head><body><p>关于</p></body></html>';
  assert.equal(postEditLink.injectEditLink(about, 'about/index.html'), about);

  // 没有工具列表时不动页面（例如自定义了模板）
  const noList = '<html><head></head><body><p>正文</p></body></html>';
  assert.equal(postEditLink.injectEditLink(noList, '2026/08/15/welcome/index.html'), noList);
});

test('编辑台会读取文章页带过来的 ?p= 参数并自动打开该文章', () => {
  const appSource = readFileSync(path.join(__dirname, '../source/admin/js/editor-app.js'), 'utf8');
  assert.match(appSource, /function readRequestedSlug\(\)/, '缺少 ?p= 解析函数');
  assert.match(appSource, /params\.get\('p'\)/, '应从查询串读取 p');
  assert.match(appSource, /await openPendingPost\(\)/, '登录并载入列表后应自动打开目标文章');
  assert.match(appSource, /state\.pendingSlug = readRequestedSlug\(\)/, '启动时应记录待打开的文件名');
  assert.match(appSource, /没有找到文章/, '目标不存在时应给出可读提示');
  assert.match(appSource, /history\?\.replaceState/, '打开后应清掉查询串，避免刷新重复触发');
});

/* ------------------------- 模块装配守卫 ------------------------- */

test('编辑器模块都能在 node 中 require 且导出预期接口', () => {
  const modules = {
    '../source/admin/js/editor-doc.js': ['parseDocument', 'serializeDocument', 'validatePost'],
    '../source/admin/js/editor-publish.js': ['createClient', 'maskToken'],
    '../source/admin/js/editor-toolbar.js': ['applyTransform', 'setAssetImageWidth'],
    '../source/admin/js/editor-preview.js': ['createController', 'renderFallback', 'rewriteAssetSources'],
    '../source/admin/js/editor-upload.js': ['createQueue', 'validateFiles'],
  };
  for (const [modulePath, expected] of Object.entries(modules)) {
    const loaded = require(modulePath);
    for (const key of expected) {
      assert.equal(typeof loaded[key], 'function', `${modulePath} 缺少 ${key}`);
    }
  }
  const app = require('../source/admin/js/editor-app.js');
  assert.equal(typeof app, 'object');
  assert.equal(typeof app.save, 'function');
});

test('admin 模块不得引用工厂作用域外的 root（浏览器里会 ReferenceError）', () => {
  const directory = path.join(__dirname, '../source/admin/js');
  // editor-app.js 的工厂显式接收 root 形参，属于合法用法
  const allowsRootParameter = new Set(['editor-app.js']);
  for (const file of require('node:fs').readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(path.join(directory, file), 'utf8');
    const body = source
      .replace(/^\(function \(root, factory\) \{[\s\S]*?function \([^)]*\) \{\n/, '')
      .replace(/\}\(typeof globalThis === 'undefined' \? this : globalThis\)\);\s*$/, '');
    const offenders = body.match(/(?<![\w.$])root\.\w+/g) || [];
    if (allowsRootParameter.has(file)) {
      // 允许 root.xxx，但必须确实把 root 作为工厂形参传入
      assert.match(source, /\}\(typeof globalThis === 'undefined' \? this : globalThis, function \(root\) \{/,
        `${file} 使用了 root 但没有把它作为工厂形参传入`);
      continue;
    }
    assert.deepEqual(offenders, [], `${file} 里出现工厂作用域外的 root 引用：${offenders.join(', ')}`);
  }
});

test('预览资源地址重写只替换对应文件名，不动外链', () => {
  const html = '<img src="/welcome/logo.svg"><img src="https://cdn.example.com/a.png"><img src="b/图 1.png">';
  const rewritten = preview.rewriteAssetSources(html, { 'logo.svg': 'blob:local-1' }, 'http://127.0.0.1:4001/api/assets?path=_posts%2Fwelcome%2F');
  assert.match(rewritten, /src="blob:local-1"/);
  assert.match(rewritten, /src="https:\/\/cdn\.example\.com\/a\.png"/, '外链必须原样保留');
  assert.match(rewritten, /src="http:\/\/127\.0\.0\.1:4001\/api\/assets\?path=_posts%2Fwelcome%2F\/%E5%9B%BE%201\.png"/);
});

/* ------------------------- 与真实仓库文章对拍 ------------------------- */

test('仓库现有文章都能解析且校验通过', () => {
  const files = require('node:fs').readdirSync(postsDirectory).filter((name) => name.endsWith('.md'));
  assert.ok(files.length >= 2, '应至少有两篇文章');
  for (const file of files) {
    const source = readFileSync(path.join(postsDirectory, file), 'utf8');
    const parsed = doc.parseDocument(source);
    assert.equal(parsed.hasFrontMatter, true, `${file} 缺少 front-matter`);
    const meta = doc.toPlainObject(parsed);
    const slug = file.replace(/\.md$/, '');
    const assetFiles = [];
    const assetDirectory = path.join(postsDirectory, slug);
    if (require('node:fs').existsSync(assetDirectory)) {
      assetFiles.push(...require('node:fs').readdirSync(assetDirectory));
    }
    const result = doc.validatePost({ slug, meta, body: parsed.body, assetFiles });
    assert.equal(result.ok, true, `${file} 校验失败：${result.errors.join('；')}`);
    assert.equal(
      doc.serializeDocument(parsed, {}),
      source.replace(/^\uFEFF/, ''),
      `${file} 空改动序列化后与原文不一致`,
    );
  }
});
