(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditorUpload = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  /* ------------------------------------------------------------------
   * 配图处理：把拖入 / 粘贴 / 选择的图片转成可提交的文本内容。
   * 图片以原文（二进制）字节读出并转 base64，交给 Git Data API 作为 blob 提交。
   * ------------------------------------------------------------------ */

  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  function releaseUrl(item) {
    if (!item || !item.objectUrl) return;
    try {
      URL.revokeObjectURL(item.objectUrl);
    } catch (error) {
      /* 忽略 */
    }
    item.objectUrl = '';
  }

  async function readAsBase64(file) {
    const buffer = await file.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }

  /** 浏览器没有 crypto.subtle 时退化为大小+名称判断 */
  async function digestOf(bytes) {
    try {
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      return `len-${bytes.length}`;
    }
  }

  /**
   * 校验一批待上传文件。
   * @returns {{accepted: Array, rejected: Array<{name: string, reason: string}>}}
   */
  function validateFiles(files) {
    const accepted = [];
    const rejected = [];
    let total = 0;

    for (const file of files) {
      const name = String(file.name || 'image.png');
      const type = String(file.type || '').toLowerCase();
      const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      const isImageType = type.startsWith('image/');
      const isImageExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(extension);
      if (!isImageType && !isImageExt) {
        rejected.push({ name, reason: '只支持图片文件（png / jpg / webp / gif / svg / avif）' });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push({ name, reason: `超过单张 10MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` });
        continue;
      }
      total += file.size;
      if (total > MAX_TOTAL_BYTES) {
        rejected.push({ name, reason: '本次上传总量超过 40MB，请分批上传' });
        continue;
      }
      accepted.push({ file, name, type, extension, size: file.size });
    }
    return { accepted, rejected };
  }

  function createQueue(options = {}) {
    const doc = options.doc;
    const items = [];

    function existingNames() {
      return items.map((item) => item.name);
    }

    function add(files, context = {}) {
      // 仓库里已有的同名配图也要参与去重（context.existingNames 由调用方从远端树取来）。
      // 只拿队列内部的名字去重的话，拖一张与远端同名的图会直接覆盖它：正文里所有
      // 旧引用、以及别处引用这张图的页面，会在下一次构建后瞬间换成另一张图。
      const taken = () => Array.from(new Set([...(context.existingNames || []), ...existingNames()]));
      const { accepted, rejected } = validateFiles(Array.from(files || []));
      const pushed = [];
      for (const entry of accepted) {
        const name = doc.uniqueAssetName(entry.name, taken());
        const item = {
          name,
          originalName: entry.name,
          size: entry.size,
          type: entry.type,
          slug: context.slug,
          file: entry.file,
          status: 'pending',
        };
        // 提交前也能在预览里看到真图：生成本地 object URL
        try {
          item.objectUrl = URL.createObjectURL(entry.file);
        } catch (error) {
          item.objectUrl = '';
        }
        items.push(item);
        pushed.push(item);
      }
      return { pushed, rejected };
    }

    function remove(name) {
      const index = items.findIndex((item) => item.name === name);
      if (index !== -1) {
        releaseUrl(items[index]);
        items.splice(index, 1);
      }
    }

    function clear() {
      for (const item of items) releaseUrl(item);
      items.length = 0;
    }

    function list() {
      return items.slice();
    }

    function names() {
      return items.map((item) => item.name);
    }

    /** 文件名 → 本地预览地址，供预览重写图片 src */
    function previewSources() {
      const map = {};
      for (const item of items) {
        if (item.objectUrl) map[item.name] = item.objectUrl;
      }
      return map;
    }

    /** 生成待提交文件列表；同一文件名只读一次 */
    async function toCommitFiles() {
      const files = [];
      const seen = new Set();
      for (const item of items) {
        if (item.status === 'committed') continue;
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const digest = await digestOf(bytes);
        const duplicate = files.find((entry) => entry.digest === digest);
        if (duplicate) {
          item.status = 'duplicate';
          item.duplicateOf = duplicate.path;
          continue;
        }
        const path = doc.assetPath(item.slug, item.name);
        if (seen.has(path)) continue;
        seen.add(path);
        // content 已经是 base64 文本，用 encoding 明确标出来：提交层必须原样透传，
        // 不能再编一次（见 editor-publish.js 的 createBlob）。
        files.push({ path, content: bytesToBase64(bytes), encoding: 'base64', digest, name: item.name, item });
      }
      return files;
    }

    function markCommitted() {
      for (const item of items) {
        if (item.status === 'pending') item.status = 'committed';
        releaseUrl(item);
      }
    }

    return { add, remove, clear, list, names, previewSources, toCommitFiles, markCommitted, existingNames };
  }

  return { createQueue, validateFiles, bytesToBase64, readAsBase64, digestOf, releaseUrl, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
}));
