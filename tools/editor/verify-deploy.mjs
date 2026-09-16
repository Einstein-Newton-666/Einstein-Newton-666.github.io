/**
 * 线上产物与本地产物的字节级一致性比对
 *
 *   node tools/editor/verify-deploy.mjs [baseUrl]
 *
 * 用 Node 的 fetch 取原始字节做 SHA-256 比对（PowerShell 的 Invoke-WebRequest
 * 会把响应当字符串处理，中文内容会因此算错哈希）。纯 HTTP，不启动浏览器。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASE = (process.argv[2] || 'https://einstein-newton-666.github.io').replace(/\/+$/, '');

const TARGETS = [
  ['/admin/', 'public/admin/index.html'],
  ['/admin/js/editor-app.js', 'public/admin/js/editor-app.js'],
  ['/admin/js/editor-doc.js', 'public/admin/js/editor-doc.js'],
  ['/admin/js/editor-publish.js', 'public/admin/js/editor-publish.js'],
  ['/admin/js/editor-toolbar.js', 'public/admin/js/editor-toolbar.js'],
  ['/admin/js/editor-preview.js', 'public/admin/js/editor-preview.js'],
  ['/admin/js/editor-upload.js', 'public/admin/js/editor-upload.js'],
  ['/css/admin-editor.css', 'public/css/admin-editor.css'],
  ['/robots.txt', 'public/robots.txt'],
];

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function fetchWithRetry(url, attempts = 3) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const buffer = Buffer.from(await response.arrayBuffer());
      return { status: response.status, buffer };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * i));
    }
  }
  throw lastError;
}

const failures = [];
console.log(`\n比对目标：${BASE}\n`);

for (const [urlPath, localRelative] of TARGETS) {
  const localPath = path.join(ROOT, localRelative);
  if (!fs.existsSync(localPath)) {
    failures.push(`本地缺少 ${localRelative}`);
    continue;
  }
  const localBuffer = fs.readFileSync(localPath);
  try {
    const { status, buffer } = await fetchWithRetry(`${BASE}${urlPath}`);
    const same = sha(localBuffer) === sha(buffer);
    if (status !== 200) failures.push(`${urlPath} 返回 HTTP ${status}`);
    else if (!same) failures.push(`${urlPath} 内容与本地构建不一致（本地 ${localBuffer.length} 字节 / 线上 ${buffer.length} 字节）`);
    console.log(`  ${same && status === 200 ? '✓' : '✗'} ${urlPath.padEnd(30)} HTTP ${status}  ${String(buffer.length).padStart(6)} 字节  ${same ? '一致' : '不一致'}`);
  } catch (error) {
    failures.push(`${urlPath} 请求失败：${error.message}`);
    console.log(`  ✗ ${urlPath.padEnd(30)} 请求失败：${error.message}`);
  }
}

console.log('');
if (failures.length) {
  for (const message of failures) console.error(`  ✗ ${message}`);
  console.error(`\nFAIL: ${failures.length} 项线上校验未通过\n`);
  process.exit(1);
}
console.log(`PASS: ${TARGETS.length} 个线上文件与本地构建逐字节一致\n`);
