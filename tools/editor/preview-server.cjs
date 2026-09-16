/**
 * 博客编辑台的本地精确预览服务（只读，不写任何文件）
 *
 *   node tools/editor/preview-server.cjs
 *
 * 作用：让线上 /admin/ 编辑器能拿到「与线上一致」的渲染结果 ——
 * 直接用本仓库的 hexo.post.render 跑正文，标签插件（{% asset_img %}）与
 * MathJax 公式都会真实渲染，而不是前端近似模拟。
 *
 * 只监听 127.0.0.1，且只读 source/ 下的文件。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 4001);
const HOST = '127.0.0.1';
const MAX_BODY = 2 * 1024 * 1024;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

let hexoPromise = null;

function loadHexo() {
  if (!hexoPromise) {
    hexoPromise = (async () => {
      const Hexo = require(path.join(ROOT, 'node_modules/hexo'));
      const hexo = new Hexo(ROOT, { silent: true });
      await hexo.init();
      await hexo.load();
      return hexo;
    })().catch((error) => {
      hexoPromise = null;
      throw error;
    });
  }
  return hexoPromise;
}

function corsHeaders() {
  // 线上站点从 https 页面请求本机服务，属于跨源；这里是显式开放的只读接口。
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders()));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 只允许读取 source/ 下的文件，拒绝任何路径穿越 */
function resolveSourceFile(relative) {
  const cleaned = String(relative || '').replace(/^\/+/, '');
  const target = path.resolve(ROOT, 'source', cleaned);
  const sourceRoot = path.resolve(ROOT, 'source');
  if (target !== sourceRoot && !target.startsWith(sourceRoot + path.sep)) return null;
  return target;
}

function warningsFor(markdown, assetFiles) {
  const warnings = [];
  const referenced = [];
  const pattern = /\{%\s*asset_(?:img|link)\s+([^\s%]+)[^%]*%\}/g;
  let match = pattern.exec(String(markdown || ''));
  while (match) {
    referenced.push(match[1].replace(/^['"]|['"]$/g, ''));
    match = pattern.exec(String(markdown || ''));
  }
  const available = new Set((assetFiles || []).map((name) => String(name).toLowerCase()));
  for (const name of referenced) {
    const base = name.split('/').pop();
    if (!available.has(base.toLowerCase())) warnings.push(`引用了不存在的资源：${base}`);
  }
  const dollars = (String(markdown || '').match(/\$/g) || []).length;
  if (dollars % 2 === 1) warnings.push('公式的 $ 数量是奇数，可能有未闭合的公式');
  return warnings;
}

async function renderMarkdown(payload) {
  const hexo = await loadHexo();
  const markdown = String(payload.markdown || '');
  const slug = String(payload.slug || 'preview');
  const assetFiles = Array.isArray(payload.assetFiles) ? payload.assetFiles : [];
  const mathjax = payload.mathjax !== false && /\$/.test(markdown);

  const data = {
    title: String(payload.title || slug),
    date: new Date(),
    slug,
    path: `source/_posts/${slug}.md`,
    source: `_posts/${slug}.md`,
    asset_dir: `source/_posts/${slug}`,
    mathjax,
    content: markdown,
    _content: markdown,
    categories: [],
    tags: [],
  };

  const rendered = await hexo.post.render(data.path, data);

  // 顺带列出该文章目录下已有的配图，供编辑器在预览里换成真实图片
  let files = [];
  try {
    files = await fs.readdir(path.join(ROOT, 'source/_posts', slug));
  } catch (error) {
    files = [];
  }

  return {
    html: rendered.content,
    mathjax,
    files,
    warnings: warningsFor(markdown, assetFiles.concat(files)),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, root: ROOT, service: 'blog-editor-preview' });
    return;
  }

  if (url.pathname === '/api/render' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await readBody(req));
      const started = Date.now();
      const result = await renderMarkdown(payload);
      sendJson(res, 200, Object.assign({ ok: true, ms: Date.now() - started }, result));
    } catch (error) {
      sendJson(res, 200, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (url.pathname === '/api/assets' && req.method === 'GET') {
    const target = resolveSourceFile(url.searchParams.get('path') || '');
    if (!target) {
      sendJson(res, 400, { ok: false, error: '路径不合法' });
      return;
    }
    try {
      const buffer = await fs.readFile(target);
      res.writeHead(200, Object.assign({
        'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      }, corsHeaders()));
      res.end(buffer);
    } catch (error) {
      sendJson(res, 404, { ok: false, error: '找不到该资源' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: `未实现的接口：${req.method} ${url.pathname}` });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。请先关闭占用该端口的程序，或用 PORT=4002 node tools/editor/preview-server.cjs 换个端口。\n`);
    process.exit(1);
  }
  throw error;
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  博客精确预览服务已启动');
    console.log(`  地址：http://${HOST}:${PORT}/api/health`);
    console.log('  在 /admin/ 编辑器的预览面板中选择「精确预览（本机）」即可使用。');
    console.log('  按 Ctrl+C 停止。');
    console.log('');
  });
}

module.exports = { server, renderMarkdown, warningsFor, resolveSourceFile, MIME, PORT };
