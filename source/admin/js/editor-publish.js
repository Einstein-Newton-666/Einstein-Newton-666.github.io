(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditorPublish = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  /* ------------------------------------------------------------------
   * GitHub 发布客户端：直连 api.github.com，用 Git Data API 做原子提交
   * （文章与配图在同一次提交里落地），发布前比对 HEAD 以避免覆盖他人改动。
   * fetch 可注入，便于在 node --test 里对本地 mock 服务断言请求体。
   * ------------------------------------------------------------------ */

  const API_ROOT = 'https://api.github.com';
  const TOKEN_PATTERN = /(gh[pousr]_[A-Za-z0-9]{4,}|github_pat_[A-Za-z0-9_]{10,})/g;

  function maskToken(text) {
    return String(text ?? '').replace(TOKEN_PATTERN, (match) => `${match.slice(0, 7)}…${match.slice(-4)}`);
  }

  function encodePath(path) {
    return String(path)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function decodeBase64(data) {
    const binary = atob(String(data).replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function createClient(options) {
    const owner = options.owner;
    const repo = options.repo;
    const token = options.token;
    const branch = options.branch || 'main';
    const fetchImpl = options.fetch || globalThis.fetch;
    const apiRoot = options.apiRoot || API_ROOT;

    if (!owner || !repo) throw new Error('缺少 owner 或 repo');
    if (!token) throw new Error('缺少访问令牌');
    if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的 fetch');

    function headers(extra) {
      return Object.assign({
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      }, extra || {});
    }

    function describeFailure(status, body) {
      const message = (body && (body.message || body.error)) || '';
      const details = Array.isArray(body && body.errors)
        ? body.errors.map((item) => item.message || item.code || '').filter(Boolean).join('；')
        : '';
      const suffix = details ? `（${details}）` : '';
      if (status === 401) return `令牌无效或已过期，请重新登录${suffix}`;
      if (status === 403) {
        if (/rate limit/i.test(message)) return `已触发 GitHub 接口限流，请稍后再试${suffix}`;
        return `令牌权限不足，需要该仓库的 Contents 读写权限${suffix}`;
      }
      if (status === 404) return `找不到仓库或路径（请确认仓库名与分支）${suffix}`;
      if (status === 409 || status === 422) return `提交被拒绝，远端可能已有新改动${suffix}`;
      return `GitHub 接口返回 ${status}${message ? `：${message}` : ''}${suffix}`;
    }

    async function request(path, init) {
      const response = await fetchImpl(`${apiRoot}${path}`, Object.assign({}, init, {
        headers: headers(init && init.headers),
      }));
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          body = { message: text.slice(0, 200) };
        }
      }
      if (!response.ok) {
        const error = new Error(maskToken(describeFailure(response.status, body)));
        error.status = response.status;
        error.body = body;
        error.rateLimitRemaining = response.headers?.get?.('x-ratelimit-remaining') ?? null;
        throw error;
      }
      return body;
    }

    /** 读默认分支最新提交，用于冲突检测 */
    async function getHead(ref = branch) {
      const data = await request(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
      return { sha: data.sha, date: data.commit?.committer?.date || '', message: (data.commit?.message || '').split('\n')[0] };
    }

    /** 一次取全仓库树（避免逐文件请求），带 truncated 标记 */
    async function getTree(ref = branch) {
      const data = await request(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      const entries = (data.tree || []).map((item) => ({ path: item.path, type: item.type, size: item.size, sha: item.sha }));
      return { entries, truncated: !!data.truncated };
    }

    async function getFile(path, ref = branch) {
      const data = await request(`/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
      if (Array.isArray(data)) throw new Error(`${path} 是目录，不是文件`);
      if (data.encoding !== 'base64') throw new Error(`${path} 不是可解码的文本文件`);
      return { path, sha: data.sha, content: decodeBase64(data.content) };
    }

    async function getBlob(sha) {
      const data = await request(`/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`);
      if (data.encoding !== 'base64') throw new Error('该文件不是文本，编辑器无法打开');
      return decodeBase64(data.content);
    }

    /** 上传单个 blob，返回其 sha */
    async function createBlob(content) {
      const data = await request(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: encodeBase64(content), encoding: 'base64' }),
      });
      return data.sha;
    }

    /**
     * 原子提交：files 为 {path, content} 数组，deletions 为路径数组。
     * expectedHead 传入时应等于当前远端 HEAD，否则抛冲突错误而不是覆盖。
     */
    async function putFiles(files, commitOptions = {}) {
      const items = Array.isArray(files) ? files : [];
      const deletions = Array.isArray(commitOptions.deletions) ? commitOptions.deletions : [];
      if (!items.length && !deletions.length) throw new Error('没有需要提交的改动');

      const head = await getHead(commitOptions.baseRef || branch);
      if (commitOptions.expectedHead && commitOptions.expectedHead !== head.sha) {
        const error = new Error('远端已有新提交，请先重新载入再保存（本地改动不会丢失）');
        error.code = 'CONFLICT';
        error.remoteSha = head.sha;
        error.expectedHead = commitOptions.expectedHead;
        throw error;
      }

      const tree = [];
      for (const item of items) {
        const sha = await createBlob(item.content);
        tree.push({ path: item.path, mode: '100644', type: 'blob', sha });
      }
      for (const path of deletions) {
        tree.push({ path, mode: '100644', type: 'blob', sha: null });
      }

      // 基于当前 HEAD 的 tree 建新 tree（未列出的路径保持原样，sha:null 表示删除该路径）
      const headCommit = await request(`/repos/${owner}/${repo}/git/commits/${head.sha}`);
      const createdTree = await request(`/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
      });

      const message = commitOptions.message || '内容：更新文章';
      const newCommit = await request(`/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          tree: createdTree.sha,
          parents: [head.sha],
        }),
      });

      await request(`/repos/${owner}/${repo}/git/refs/heads/${encodePath(commitOptions.baseRef || branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: newCommit.sha, force: false }),
      });

      return {
        sha: newCommit.sha,
        previousSha: head.sha,
        htmlUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
        files: items.map((item) => item.path),
        deletions,
      };
    }

    return {
      owner,
      repo,
      branch,
      getHead,
      getTree,
      getFile,
      getBlob,
      createBlob,
      putFiles,
    };
  }

  return { createClient, maskToken, encodePath, encodeBase64, decodeBase64, API_ROOT };
}));
