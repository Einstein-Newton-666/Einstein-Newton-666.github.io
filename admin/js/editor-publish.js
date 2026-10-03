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
  const DEFAULT_TIMEOUT_MS = 20000;
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
    // 每个请求的超时。没有它的话，手机网络连不上 api.github.com 时 fetch 可以永不返回，
    // 那个全屏的「处理中…」遮罩就永远盖在页面上，什么也点不了 —— 用户看到的就是「卡住了」。
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

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

    /** 带超时的 fetch：超时/网络错误都转成可读错误，绝不留下永远转圈的等待。
     *
     *  这里必须用 Promise.race 兜底，而不是只调 controller.abort()：
     *  abort 只是「请求对方取消」，如果 fetch 实现不理会 signal（或网络栈卡在某个
     *  中间状态），底层 promise 仍然可能永不 settle，于是调用方永远等下去 ——
     *  表现就是全屏「处理中…」遮罩一直盖着，什么也点不了。 */
    async function fetchWithTimeout(url, init) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const seconds = Math.max(1, Math.round(timeoutMs / 1000));
      const timeoutError = () => {
        const failure = new Error(`请求超时（${seconds} 秒没有响应）。多半是当前网络连不上 api.github.com —— `
          + '换 Wi-Fi / 换流量，或确认没有被网络屏蔽，然后重试');
        failure.code = 'TIMEOUT';
        return failure;
      };
      if (!(timeoutMs > 0)) {
        return fetchImpl(url, Object.assign({}, init, { signal: controller ? controller.signal : undefined }));
      }

      // 只留一个定时器，并且「先认定超时、再取消底层请求」。
      // 顺序不能反，也不能另外再挂一个 abort 定时器：它们同时到点，而 abort() 会让
      // fetch 立刻以 AbortError 结束，race 就被那个 AbortError 抢先，下面那句
      // 「请求超时…换 Wi-Fi / 换流量」的提示永远弹不出来 —— 用户看到的只是
      // 「网络请求没有发出去」，把「联系不上服务端」误报成「请求没发出去」，
      // 于是反复重试、重新登录，而这条错误恰恰最需要给出换网络的指引。
      let rejectTimer = null;
      const deadline = new Promise((resolve, reject) => {
        rejectTimer = setTimeout(() => {
          reject(timeoutError());
          if (controller) controller.abort();
        }, timeoutMs);
      });

      try {
        return await Promise.race([
          fetchImpl(url, Object.assign({}, init, { signal: controller ? controller.signal : undefined })),
          deadline,
        ]);
      } catch (error) {
        if (error && error.code === 'TIMEOUT') throw error;
        const failure = new Error(`网络请求没有发出去：${(error && error.message) || error}`);
        failure.code = 'NETWORK';
        throw failure;
      } finally {
        if (rejectTimer) clearTimeout(rejectTimer);
      }
    }

    async function request(path, init) {
      const response = await fetchWithTimeout(`${apiRoot}${path}`, Object.assign({}, init, {
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

    /**
     * 上传单个 blob，返回其 sha。
     *
     * encoding='text'（默认）表示 content 是文本，这里按 UTF-8 编成 base64；
     * encoding='base64' 表示调用方交来的已经是 base64 文本（配图就是这种），原样转发。
     * 二者混用是静默的灾难：把已经是 base64 的内容再编一遍，仓库里存下的就是
     * 「图片的 base64 文本」而不是图片字节，线上所有配图都是破图，而提交本身是成功的。
     */
    async function createBlob(content, encoding = 'text') {
      const body = encoding === 'base64'
        ? { content: String(content), encoding: 'base64' }
        : { content: encodeBase64(content), encoding: 'base64' };
      const data = await request(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return data.sha;
    }

    /**
     * 原子提交：files 为 {path, content, encoding?} 数组，deletions 为路径数组。
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
        const sha = await createBlob(item.content, item.encoding);
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

  return { createClient, maskToken, encodePath, encodeBase64, decodeBase64, API_ROOT, DEFAULT_TIMEOUT_MS };
}));
