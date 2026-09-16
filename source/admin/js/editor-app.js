(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AdminEditor = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  'use strict';

  const doc = root.EditorDoc;
  const publish = root.EditorPublish;
  const toolbar = root.EditorToolbar;
  const previewLib = root.EditorPreview;
  const upload = root.EditorUpload;

  const STORAGE_KEYS = {
    token: 'einblog.admin.token.v1',
    repo: 'einblog.admin.repo.v1',
    draft: (path) => `einblog.admin.draft.v1::${path}`,
  };
  const DEFAULT_REPO = 'Einstein-Newton-666/Einstein-Newton-666.github.io';

  const state = {
    client: null,
    repo: null,
    head: null,
    posts: [],
    current: null,
    conflict: null,
    listFilter: '',
  };

  const el = {};
  const preview = previewLib.createController();

  function $(id) {
    return document.getElementById(id);
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (error) { return false; }
  }

  function dropStore(key) {
    try { localStorage.removeItem(key); } catch (error) { /* 忽略 */ }
  }

  function toast(message, kind = 'info') {
    const node = document.createElement('div');
    node.className = `admin-toast admin-toast--${kind}`;
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(() => node.classList.add('admin-toast--out'), 4200);
    setTimeout(() => node.remove(), 4800);
  }

  function setStatus(text, kind = '') {
    el.statusText.textContent = text;
    el.statusText.className = `admin-status__text${kind ? ` admin-status__text--${kind}` : ''}`;
  }

  function busy(on, text = '') {
    el.busy.hidden = !on;
    if (text) el.busyText.textContent = text;
  }

  /* ------------------------------ 站内弹窗 ------------------------------
   * 不用 window.prompt / confirm：移动端体验差、可能被浏览器拦截，
   * 而本站是会被反复登录的公开页面，原生弹窗更容易被屏蔽。
   * -------------------------------------------------------------------- */

  function closeModal() {
    el.modal.hidden = true;
    el.modalError.textContent = '';
    el.modalFieldWrap.hidden = true;
    el.modalInput.value = '';
    el.modalOk.classList.remove('admin-btn--danger');
    el.modalExtra.hidden = true;
    if (state.modalResolve) {
      const resolve = state.modalResolve;
      state.modalResolve = null;
      state.modalValidate = null;
      resolve(null);
    }
  }

  /**
   * @param {{title: string, text?: string, okText?: string, danger?: boolean,
   *          extraText?: string,
   *          field?: {label: string, placeholder?: string, value?: string,
   *                   validate?: (value: string) => (string|null)}}} options
   * @returns {Promise<string|true|null>} 取消 null；主按钮 true/输入值；extraText 按钮 true
   */
  function openModal(options) {
    return new Promise((resolve) => {
      if (state.modalResolve) closeModal();
      state.modalResolve = resolve;
      state.modalValidate = options.field?.validate || null;
      el.modalTitle.textContent = options.title;
      el.modalText.innerHTML = options.text || '';
      el.modalText.hidden = !options.text;
      el.modalOk.textContent = options.okText || '确定';
      el.modalOk.classList.toggle('admin-btn--danger', !!options.danger);
      el.modalExtra.hidden = !options.extraText;
      if (options.extraText) el.modalExtra.textContent = options.extraText;
      if (options.field) {
        el.modalFieldWrap.hidden = false;
        el.modalFieldLabel.textContent = options.field.label;
        el.modalInput.placeholder = options.field.placeholder || '';
        el.modalInput.value = options.field.value || '';
      } else {
        el.modalFieldWrap.hidden = true;
        el.modalInput.value = '';
      }
      el.modalError.textContent = '';
      el.modal.hidden = false;
      setTimeout(() => (options.field ? el.modalInput.focus() : el.modalOk.focus()), 30);
    });
  }

  function acceptModal(primary = true) {
    if (!state.modalResolve) return;
    if (primary && state.modalValidate) {
      const message = state.modalValidate(el.modalInput.value);
      if (message) {
        el.modalError.textContent = message;
        return;
      }
    }
    const resolve = state.modalResolve;
    const value = primary ? (el.modalFieldWrap.hidden ? true : el.modalInput.value) : true;
    state.modalResolve = null;
    state.modalValidate = null;
    el.modal.hidden = true;
    resolve(value);
  }

  /* ------------------------------ 登录 ------------------------------ */

  function splitRepo(value) {
    const cleaned = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  async function signIn() {
    const repoInput = el.repoInput.value.trim() || DEFAULT_REPO;
    const token = el.tokenInput.value.trim();
    const parsed = splitRepo(repoInput);
    if (!parsed) {
      el.loginError.textContent = '仓库要写成 owner/repo 的形式';
      return;
    }
    if (!token) {
      el.loginError.textContent = '请填写 GitHub 访问令牌';
      return;
    }
    el.loginError.textContent = '';
    busy(true, '正在验证令牌…');
    try {
      const client = publish.createClient({ owner: parsed.owner, repo: parsed.repo, token });
      const head = await client.getHead();
      state.client = client;
      state.repo = { owner: parsed.owner, repo: parsed.repo, full: `${parsed.owner}/${parsed.repo}` };
      state.head = head;
      writeStore(STORAGE_KEYS.token, token);
      writeStore(STORAGE_KEYS.repo, repoInput);
      el.tokenInput.value = '';
      el.login.hidden = true;
      el.workspace.hidden = false;
      el.repoLabel.textContent = state.repo.full;
      el.headLabel.textContent = head.sha.slice(0, 7);
      await loadPosts();
      toast(`已连接 ${state.repo.full}`, 'ok');
    } catch (error) {
      el.loginError.textContent = publish.maskToken(error.message);
    } finally {
      busy(false);
    }
  }

  function signOut() {
    dropStore(STORAGE_KEYS.token);
    state.client = null;
    state.posts = [];
    state.current = null;
    el.workspace.hidden = true;
    el.login.hidden = false;
    el.loginError.textContent = '';
    el.repoInput.value = readStore(STORAGE_KEYS.repo) || DEFAULT_REPO;
    el.tokenInput.focus();
  }

  function forgetToken() {
    dropStore(STORAGE_KEYS.token);
    el.tokenInput.value = '';
    el.loginError.textContent = '已清除本机保存的令牌';
  }

  /* ------------------------------ 文章列表 ------------------------------ */

  async function loadPosts() {
    busy(true, '正在读取文章列表…');
    try {
      const tree = await state.client.getTree();
      state.head = await state.client.getHead();
      el.headLabel.textContent = state.head.sha.slice(0, 7);
      const posts = tree.entries
        .filter((entry) => entry.type === 'blob' && doc.isPostPath(entry.path))
        .map((entry) => ({
          path: entry.path,
          slug: doc.slugFromPath(entry.path),
          sha: entry.sha,
          size: entry.size || 0,
        }));
      const assetCount = new Map();
      for (const entry of tree.entries) {
        const match = entry.path.match(/^source\/_posts\/([^/]+)\/.+$/);
        if (match && entry.type === 'blob') assetCount.set(match[1], (assetCount.get(match[1]) || 0) + 1);
      }
      state.posts = posts.map((post) => Object.assign(post, { assets: assetCount.get(post.slug) || 0 }));
      renderPostList();
      if (tree.truncated) toast('仓库文件过多，列表可能不完整', 'warn');
      // 从文章页的「编辑」按钮进来时，直接打开对应文章
      await openPendingPost();
    } catch (error) {
      toast(publish.maskToken(error.message), 'error');
    } finally {
      busy(false);
    }
  }

  /** 文章页「编辑」按钮带过来的 ?p=文件名 */
  function readRequestedSlug() {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const slug = (params.get('p') || '').trim();
    return slug || '';
  }

  function clearRequestedSlug() {
    try {
      globalThis.history?.replaceState(null, '', globalThis.location.pathname);
    } catch (error) {
      /* 某些环境下不允许改写地址，忽略即可 */
    }
  }

  async function openPendingPost() {
    if (!state.pendingSlug) return;
    const slug = state.pendingSlug;
    state.pendingSlug = '';
    clearRequestedSlug();

    if (!state.posts.some((post) => post.slug === slug)) {
      toast(`没有找到文章 ${slug}，请从左侧列表选择`, 'warn');
      return;
    }
    const check = doc.validateSlug(slug);
    if (!check.ok) {
      toast(`文件名不合法：${check.reason}`, 'error');
      return;
    }
    const post = state.posts.find((item) => item.slug === slug);
    if (post) await openPost(post.path);
  }

  function renderPostList() {
    const keyword = state.listFilter.trim().toLowerCase();
    const visible = state.posts.filter((post) => !keyword || post.slug.toLowerCase().includes(keyword));
    el.postList.textContent = '';
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-sidebar__empty';
      empty.textContent = state.posts.length ? '没有匹配的文章' : '仓库里还没有文章';
      el.postList.appendChild(empty);
      return;
    }
    for (const post of visible) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `admin-post${state.current && state.current.path === post.path ? ' admin-post--active' : ''}`;
      const title = document.createElement('span');
      title.className = 'admin-post__title';
      title.textContent = post.slug;
      const meta = document.createElement('span');
      meta.className = 'admin-post__meta';
      meta.textContent = `${post.assets} 个资源 · ${(post.size / 1024).toFixed(1)}KB`;
      item.append(title, meta);
      item.addEventListener('click', () => openPost(post.path));
      el.postList.appendChild(item);
    }
  }

  /* ------------------------------ 打开 / 新建 ------------------------------ */

  async function openPost(path) {
    if (state.current && state.current.dirty) {
      saveDraft();
      const proceed = await openModal({
        title: '切换文章？',
        text: `《${state.current.meta.title || state.current.slug}》有未发布的改动，已存入本机草稿，之后可以恢复。`,
        okText: '切换',
      });
      if (proceed === null) return;
    }
    clearTimeout(draftTimer);
    busy(true, '正在读取文章…');
    try {
      const file = await state.client.getFile(path);
      const parsed = doc.parseDocument(file.content);
      const meta = doc.toPlainObject(parsed);
      const slug = doc.slugFromPath(path) || path;
      state.current = {
        path,
        slug,
        sha: file.sha,
        baseHead: state.head ? state.head.sha : '',
        meta,
        body: parsed.body,
        dirty: false,
        newPost: false,
        localAssets: [],
        remoteAssets: await listRemoteAssets(slug),
      };
      state.conflict = null;
      state.uploadQueue.clear();
      fillEditor();
      renderPostList();
      await updatePreview();
      await restoreDraftIfAny();
      setStatus(`已打开 ${path}`);
    } catch (error) {
      toast(publish.maskToken(error.message), 'error');
    } finally {
      busy(false);
    }
  }

  /** 列出仓库里该文章的配图文件名 */
  async function listRemoteAssets(slug) {
    try {
      const tree = await state.client.getTree();
      const prefix = `${doc.assetDir(slug)}/`;
      return tree.entries
        .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
        .map((entry) => entry.path.slice(prefix.length));
    } catch (error) {
      return [];
    }
  }

  /** 已存在的配图名 = 仓库里的 + 本次新加还没提交的 */
  function knownAssetNames() {
    const current = state.current;
    if (!current) return [];
    const local = state.uploadQueue ? state.uploadQueue.names() : [];
    return Array.from(new Set([...(current.remoteAssets || []), ...local]));
  }

  function fillEditor() {
    const current = state.current;
    el.editor.hidden = false;
    el.editor.disabled = false;
    el.metaForm.hidden = false;
    el.placeholder.hidden = true;
    el.markdown.value = current.body;
    el.titleInput.value = current.meta.title || current.slug;
    el.dateInput.value = String(current.meta.date || doc.formatBeijingDate()).slice(0, 19);
    el.categoriesInput.value = Array.isArray(current.meta.categories) ? current.meta.categories.join(', ') : '';
    el.tagsInput.value = Array.isArray(current.meta.tags) ? current.meta.tags.join(', ') : '';
    el.mathjaxInput.checked = current.meta.mathjax === true;
    el.coverInput.value = current.meta.cover || '';
    el.excerptInput.value = current.meta.excerpt || '';
    el.currentPath.textContent = current.path;
    el.publishLink.hidden = true;
    renderUploads();
    updateStatusBar();
  }

  function collectMeta() {
    const current = state.current || {};
    const parseList = (value) => String(value || '')
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return Object.assign({}, current.meta, {
      title: el.titleInput.value.trim(),
      date: el.dateInput.value.trim(),
      categories: parseList(el.categoriesInput.value),
      tags: parseList(el.tagsInput.value),
      mathjax: el.mathjaxInput.checked,
      cover: el.coverInput.value.trim(),
      excerpt: el.excerptInput.value.trim(),
    });
  }

  function buildSource() {
    const parsed = doc.parseDocument(el.markdown.value);
    return doc.serializeDocument({ hasFrontMatter: true, frontMatterRaw: '', body: parsed.body }, collectMeta());
  }

  function markDirty() {
    if (!state.current) return;
    state.current.dirty = true;
    state.current.meta = collectMeta();
    state.current.body = el.markdown.value;
    setStatus('有未发布的改动');
    saveDraftSoon();
    updateStatusBar();
  }

  let draftTimer = null;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 900);
  }

  function saveDraft() {
    if (!state.current) return;
    const payload = {
      meta: collectMeta(),
      body: el.markdown.value,
      sha: state.current.sha,
      baseHead: state.current.baseHead,
      savedAt: new Date().toISOString(),
    };
    writeStore(STORAGE_KEYS.draft(state.current.path), JSON.stringify(payload));
    setStatus('草稿已存在本机浏览器');
  }

  function clearDraft(path) {
    dropStore(STORAGE_KEYS.draft(path));
  }

  async function restoreDraftIfAny() {
    if (!state.current) return;
    const raw = readStore(STORAGE_KEYS.draft(state.current.path));
    if (!raw) return;
    let payload = null;
    try { payload = JSON.parse(raw); } catch (error) { return; }
    if (!payload || typeof payload.body !== 'string') return;
    const sameAsRemote = payload.body === state.current.body
      && JSON.stringify(payload.meta) === JSON.stringify(state.current.meta);
    if (sameAsRemote) {
      clearDraft(state.current.path);
      return;
    }
    const when = payload.savedAt ? new Date(payload.savedAt).toLocaleString('zh-CN') : '此前';
    const restore = await openModal({
      title: '发现本机草稿',
      text: `${when} 在这台设备的浏览器里存过一份改动。要恢复吗？<br>选“取消”会保留远端版本，草稿不会被删除。`,
      okText: '恢复草稿',
    });
    if (restore === null) return;
    state.current.meta = payload.meta || state.current.meta;
    state.current.body = payload.body;
    if (payload.baseHead) state.current.baseHead = payload.baseHead;
    state.current.dirty = true;
    fillEditor();
    updatePreview();
    toast('已恢复本地草稿', 'ok');
  }

  /* ------------------------------ 预览 ------------------------------ */

  async function updatePreview() {
    if (!state.current) return;
    const sources = state.uploadQueue ? state.uploadQueue.previewSources() : {};
    const options = {
      slug: state.current.slug,
      title: el.titleInput.value.trim(),
      markdown: el.markdown.value,
      mathjax: el.mathjaxInput.checked,
      assetFiles: knownAssetNames(),
      sources,
    };
    const result = await preview.render(options);
    el.previewFrame.srcdoc = wrapPreview(result.html, state.current.meta);
    renderWarnings(result.warnings || [], result);
    const isExact = result.mode === 'exact';
    el.previewMode.textContent = isExact ? '精确（hexo 管线）' : '近似（前端渲染）';
    el.previewMode.className = `admin-badge${isExact ? ' admin-badge--ok' : ' admin-badge--warn'}`;
    if (isExact && Array.isArray(result.files)) {
      state.current.remoteAssets = Array.from(new Set([...(state.current.remoteAssets || []), ...result.files]));
    }
  }

  function wrapPreview(html, meta) {
    const title = (meta && meta.title) || '';
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{margin:0;padding:18px 20px;font-family:-apple-system,'Segoe UI','Noto Sans SC',sans-serif;line-height:1.8;color:#202124;background:#fff;overflow-x:hidden}
      h1,h2,h3{line-height:1.35}
      pre{background:#f6f8fa;border-radius:8px;padding:12px;overflow:auto}
      code{font-family:Consolas,Monaco,monospace;font-size:13px}
      img{max-width:100%;height:auto}
      blockquote{border-left:4px solid #dadce0;margin:12px 0;padding:4px 14px;color:#5f6368}
      table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}
      td,th{border:1px solid #dadce0;padding:6px 10px}
      .preview-asset{background:#fff8e1;border-radius:6px;padding:8px 12px;color:#8a6d3b}
      .preview-title{margin:0 0 14px;font-size:22px;border-bottom:2px solid #1a73e8;padding-bottom:8px}
      mjx-container{max-width:100%;overflow-x:auto;overflow-y:hidden}
      mjx-container[display="true"]{display:block;margin:10px 0}
    </style></head><body>${title ? `<h1 class="preview-title">${previewLib.escapeHtml(title)}</h1>` : ''}${html}</body></html>`;
  }

  function renderWarnings(list, result) {
    el.warnings.textContent = '';
    const all = list.slice();
    if (state.current) {
      const check = doc.validatePost({
        slug: state.current.slug,
        meta: collectMeta(),
        body: el.markdown.value,
        assetFiles: knownAssetNames(),
      });
      all.push(...check.errors.map((text) => `错误：${text}`));
      all.push(...check.warnings);
    }
    if (result && result.error) all.push(`精确预览不可用：${result.error}`);
    const unique = Array.from(new Set(all));
    el.warnings.hidden = unique.length === 0;
    for (const text of unique) {
      const item = document.createElement('li');
      item.textContent = text;
      if (text.startsWith('错误：')) item.className = 'admin-warning--error';
      el.warnings.appendChild(item);
    }
  }

  function updateStatusBar() {
    const body = el.markdown.value;
    const count = doc.wordCount(body);
    el.wordCount.textContent = `${count} 字 · 约 ${doc.readingMinutes(count)} 分钟`;
    const current = state.current;
    if (current) {
      const permalink = doc.permalinkFor({ date: el.dateInput.value, slug: current.slug }, 'https://einstein-newton-666.github.io');
      el.permalink.textContent = permalink ? `线上地址 ${permalink}` : '';
    }
  }

  /* ------------------------------ 保存 / 发布 ------------------------------ */

  function currentFiles(uploadedFiles) {
    const files = [{
      path: state.current.path,
      content: buildSource(),
    }];
    for (const file of uploadedFiles || []) files.push({ path: file.path, content: file.content });
    return files;
  }

  async function save({ publishNow = false } = {}) {
    if (!state.current) return;
    const check = doc.validatePost({
      slug: state.current.slug,
      meta: collectMeta(),
      body: el.markdown.value,
      assetFiles: knownAssetNames(),
    });
    if (!check.ok) {
      toast(`无法保存：${check.errors[0]}`, 'error');
      renderWarnings([], null);
      return;
    }
    const uploadedFiles = await state.uploadQueue.toCommitFiles();
    const action = state.current.newPost ? '新增' : '更新';
    const message = el.commitMessage.value.trim() || `内容：${action}《${el.titleInput.value.trim() || state.current.slug}》`;

    busy(true, publishNow ? '正在提交并触发部署…' : '正在提交…');
    try {
      const result = await state.client.putFiles(currentFiles(uploadedFiles), {
        message,
        expectedHead: state.current.baseHead || undefined,
      });
      state.uploadQueue.markCommitted();
      state.current.sha = '';
      state.current.baseHead = result.sha;
      state.current.dirty = false;
      state.current.newPost = false;
      clearDraft(state.current.path);
      el.publishLink.hidden = false;
      el.publishLink.href = result.htmlUrl;
      el.publishLink.textContent = `已提交 ${result.sha.slice(0, 7)}`;
      setStatus('已提交到 main 分支');
      toast('提交成功，GitHub Actions 会自动构建并发布', 'ok');
      state.head = { sha: result.sha };
      el.headLabel.textContent = result.sha.slice(0, 7);
      await loadPosts();
      renderUploads();
    } catch (error) {
      if (error.code === 'CONFLICT') {
        state.conflict = error;
        showConflict(error);
      } else {
        toast(publish.maskToken(error.message), 'error');
      }
    } finally {
      busy(false);
    }
  }

  function showConflict(error) {
    el.conflictBox.hidden = false;
    el.conflictText.textContent = `远端 main 已更新到 ${String(error.remoteSha).slice(0, 7)}（你打开文章时是 ${String(error.expectedHead).slice(0, 7)}）。为避免覆盖别人的改动，本次提交已中止，你的内容仍在编辑器里。`;
  }

  async function resolveConflictKeepMine() {
    if (!state.current) return;
    busy(true, '正在同步远端最新版本…');
    try {
      const file = await state.client.getFile(state.current.path);
      const parsed = doc.parseDocument(file.content);
      state.current.meta = Object.assign(doc.toPlainObject(parsed), collectMeta());
      state.current.baseHead = (await state.client.getHead()).sha;
      state.current.sha = file.sha;
      fillEditor();
      state.conflict = null;
      el.conflictBox.hidden = true;
      toast('已同步远端版本，可重新提交（你的内容已保留）', 'ok');
    } catch (error) {
      toast(publish.maskToken(error.message), 'error');
    } finally {
      busy(false);
    }
  }

  async function resolveConflictTakeRemote() {
    if (!state.current) return;
    const path = state.current.path;
    clearDraft(path);
    el.conflictBox.hidden = true;
    state.conflict = null;
    await openPost(path);
    toast('已放弃本地改动，载入远端版本', 'ok');
  }

  async function createPost() {
    const title = await openModal({
      title: '新建文章',
      text: '文件名会由标题自动生成，也可以自己改。创建后填写正文，点「保存并发布」即会上线。',
      okText: '创建',
      field: { label: '文章标题', placeholder: '例如：蜂鸟悬停稳定性笔记' },
    });
    if (title === null || !String(title).trim()) return;
    if (state.current && state.current.dirty) saveDraft();
    clearTimeout(draftTimer);
    const cleanTitle = String(title).trim();
    const slug = doc.slugify(cleanTitle);
    const check = doc.validateSlug(slug);
    if (!check.ok) {
      toast(`文件名不可用：${check.reason}`, 'error');
      return;
    }
    if (state.posts.some((post) => post.slug === slug)) {
      toast(`已存在同名文章：${slug}`, 'error');
      return;
    }
    state.current = {
      path: doc.postPath(slug),
      slug,
      sha: '',
      baseHead: state.head ? state.head.sha : '',
      meta: { title: cleanTitle, date: doc.formatBeijingDate(), categories: [], tags: [], mathjax: false, cover: '' },
      body: '',
      dirty: true,
      newPost: true,
      localAssets: [],
      remoteAssets: await listRemoteAssets(slug),
    };
    state.uploadQueue.clear();
    fillEditor();
    renderPostList();
    el.markdown.focus();
    await updatePreview();
    toast('已创建草稿：填好正文后点「保存并发布」', 'ok');
  }

  async function removePost() {
    if (!state.current || state.current.newPost) return;
    const current = state.current;
    const label = current.meta.title || current.slug;
    const answer = await openModal({
      title: '删除文章',
      text: `将删除 <code>${current.path}</code>，此操作会立即提交到 main 分支。<br>请输入文件名 <code>${current.slug}</code> 以确认。`,
      okText: '删除',
      danger: true,
      field: {
        label: '文件名',
        placeholder: current.slug,
        validate: (value) => (String(value).trim() === current.slug ? null : '文件名不一致，已取消删除'),
      },
    });
    if (answer === null) return;
    const assetChoice = await openModal({
      title: '文章里的配图怎么办？',
      text: `这篇文章的资源文件夹是 <code>${doc.assetDir(current.slug)}/</code>。<br>` +
        '只删文章：文件夹会保留（内容不会被引用，但不占仓库多少空间）。<br>' +
        '一起删除：文件夹与里面的图片一并删掉，历史记录里仍可找回。',
      okText: '文章和配图都删',
      extraText: '只删文章',
    });
    if (assetChoice === null) return;
    const removeAssets = assetChoice === true;
    const deletions = [current.path];
    // 只删文章：保留资源目录，deletions 里只有文章文件
    if (removeAssets === true) {
      try {
        const tree = await state.client.getTree();
        for (const entry of tree.entries) {
          if (entry.type === 'blob' && entry.path.startsWith(`${doc.assetDir(current.slug)}/`)) deletions.push(entry.path);
        }
      } catch (error) {
        toast(publish.maskToken(error.message), 'error');
        return;
      }
    }
    busy(true, '正在删除…');
    try {
      const result = await state.client.putFiles([], {
        message: `维护：删除《${label}》`,
        deletions,
        expectedHead: current.baseHead || undefined,
      });
      clearDraft(current.path);
      state.current = null;
      el.editor.hidden = true;
      el.placeholder.hidden = false;
      el.currentPath.textContent = '';
      el.markdown.value = '';
      el.previewFrame.srcdoc = '';
      state.head = { sha: result.sha };
      await loadPosts();
      toast(`已删除 ${deletions.length} 个文件并提交`, 'ok');
    } catch (error) {
      toast(publish.maskToken(error.message), 'error');
    } finally {
      busy(false);
    }
  }

  /* ------------------------------ 配图 ------------------------------ */

  async function handleFiles(fileList) {
    if (!state.current) {
      toast('请先打开或新建一篇文章', 'warn');
      return;
    }
    const { pushed, rejected } = state.uploadQueue.add(fileList, { slug: state.current.slug });
    for (const item of rejected) toast(`${item.name}：${item.reason}`, 'error');
    if (!pushed.length) return;
    state.current.dirty = true;
    renderUploads();
    const first = pushed[0];
    applyToolbar('assetImg', { name: first.name, alt: first.originalName.replace(/\.[^.]+$/, '') });
    toast(`已加入 ${pushed.length} 张图片，保存时会与文章一起提交`, 'ok');
  }

  function renderUploads() {
    const items = state.uploadQueue ? state.uploadQueue.list() : [];
    el.uploadList.textContent = '';
    el.uploadPanel.hidden = items.length === 0;
    for (const item of items) {
      const row = document.createElement('li');
      row.className = 'admin-upload';
      const name = document.createElement('span');
      name.textContent = `${item.name}（${(item.size / 1024).toFixed(0)}KB）`;
      const actions = document.createElement('span');
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'admin-btn admin-btn--tiny';
      insert.textContent = '插入引用';
      insert.addEventListener('click', () => applyToolbar('assetImg', { name: item.name }));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'admin-btn admin-btn--tiny admin-btn--danger';
      remove.textContent = '移除';
      remove.addEventListener('click', () => {
        state.uploadQueue.remove(item.name);
        renderUploads();
      });
      actions.append(insert, remove);
      row.append(name, actions);
      el.uploadList.appendChild(row);
    }
  }

  /* ------------------------------ 工具条 ------------------------------ */

  function applyToolbar(action, payload) {
    const textarea = el.markdown;
    const result = toolbar.applyTransform(textarea.value, textarea.selectionStart, textarea.selectionEnd, action, payload);
    textarea.value = result.text;
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    markDirty();
    schedulePreview();
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => updatePreview(), 500);
  }

  /** 窄屏下编辑区与预览二选一显示，避免两栏都被压扁 */
  function setMobileTab(tab) {
    const showPreview = tab === 'preview';
    document.body.classList.toggle('admin-show-preview', showPreview);
    el.tabEdit.classList.toggle('admin-tab--active', !showPreview);
    el.tabPreview.classList.toggle('admin-tab--active', showPreview);
    if (showPreview) updatePreview();
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bind() {
    el.signInButton.addEventListener('click', signIn);
    el.tokenInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
    el.repoInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
    el.forgetButton.addEventListener('click', forgetToken);
    el.signOutButton.addEventListener('click', signOut);
    el.reloadButton.addEventListener('click', loadPosts);
    el.newPostButton.addEventListener('click', createPost);
    el.deletePostButton.addEventListener('click', removePost);
    el.saveButton.addEventListener('click', () => save());
    el.filterInput.addEventListener('input', () => {
      state.listFilter = el.filterInput.value;
      renderPostList();
    });

    el.markdown.addEventListener('input', () => { markDirty(); schedulePreview(); });
    el.markdown.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        applyToolbar(event.shiftKey ? 'outdent' : 'indent');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        applyToolbar('bold');
      }
    });
    for (const id of ['titleInput', 'dateInput', 'categoriesInput', 'tagsInput', 'coverInput', 'excerptInput']) {
      el[id].addEventListener('input', () => { markDirty(); schedulePreview(); });
    }
    el.mathjaxInput.addEventListener('change', () => { markDirty(); schedulePreview(); });

    for (const button of el.toolbarButtons) {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        if (action === 'link') {
          const url = await openModal({
            title: '插入链接',
            okText: '插入',
            field: { label: '链接地址', value: 'https://', placeholder: 'https://example.com' },
          });
          if (url === null) return;
          applyToolbar('link', { url: String(url).trim() || 'https://' });
          return;
        }
        if (action === 'table') {
          applyToolbar('table', { rows: 4, columns: 3 });
          return;
        }
        if (action === 'formula') {
          applyToolbar('block', { snippet: '$$\nE = mc^2\n$$' });
          if (!el.mathjaxInput.checked) {
            el.mathjaxInput.checked = true;
            markDirty();
            toast('已自动打开 mathjax（公式需要它才会渲染）', 'ok');
          }
          return;
        }
        if (action === 'heading') {
          applyToolbar('heading', { level: 2 });
          return;
        }
        if (action === 'imageWidth') {
          const line = el.markdown.value.slice(0, el.markdown.selectionStart).split('\n').pop() || '';
          const tag = toolbar.parseAssetTag(line);
          if (!tag) {
            toast('把光标放到配图那一行再设置宽度', 'warn');
            return;
          }
          const currentWidth = tag.width || '自适应';
          const choice = await openModal({
            title: '图片宽度',
            text: `当前：<code>${currentWidth}</code><br>Hexo 的 <code>asset_img</code> 第二段引号参数就是宽度，可写像素（如 600）或百分比。`,
            okText: '半栏（约 400）',
            extraText: '恢复自适应',
          });
          if (choice === null) return;
          applyToolbar('imageWidth', { width: choice === true ? '400' : '' });
          return;
        }
        applyToolbar(action);
      });
    }

    el.fileInput.addEventListener('change', (event) => {
      handleFiles(event.target.files);
      event.target.value = '';
    });
    el.editorPane.addEventListener('dragover', (event) => { event.preventDefault(); });
    el.editorPane.addEventListener('drop', (event) => {
      if (!event.dataTransfer || !event.dataTransfer.files.length) return;
      event.preventDefault();
      handleFiles(event.dataTransfer.files);
    });
    el.markdown.addEventListener('paste', (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const images = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile());
      if (images.length) {
        event.preventDefault();
        handleFiles(images);
      }
    });

    el.endpointInput.addEventListener('change', async () => {
      preview.setEndpoint(el.endpointInput.value.trim() || previewLib.DEFAULT_ENDPOINT);
      const health = await preview.checkExact();
      preview.setMode(health.ok ? 'exact' : 'fallback');
      toast(health.ok ? '精确预览已连接' : '未检测到本机预览服务，改为近似预览', health.ok ? 'ok' : 'warn');
      updatePreview();
    });

    el.conflictKeep.addEventListener('click', resolveConflictKeepMine);
    el.conflictTake.addEventListener('click', resolveConflictTakeRemote);

    /* 弹窗 */
    el.modalOk.addEventListener('click', () => acceptModal(true));
    el.modalExtra.addEventListener('click', () => acceptModal(false));
    el.modalCancel.addEventListener('click', closeModal);
    el.modalBackdrop.addEventListener('click', closeModal);
    el.modalInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        acceptModal(true);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !el.modal.hidden) closeModal();
    });

    /* 移动端：编辑 / 预览 切换 */
    el.tabEdit.addEventListener('click', () => setMobileTab('edit'));
    el.tabPreview.addEventListener('click', () => setMobileTab('preview'));

    root.addEventListener('beforeunload', (event) => {
      if (!state.current || !state.current.dirty) return;
      saveDraft();
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function cacheElements() {
    const ids = [
      'login', 'workspace', 'repoInput', 'tokenInput', 'signInButton', 'forgetButton', 'loginError',
      'repoLabel', 'headLabel', 'signOutButton', 'reloadButton', 'newPostButton', 'deletePostButton',
      'filterInput', 'postList', 'placeholder', 'editorPane', 'metaForm', 'editor', 'currentPath',
      'markdown', 'titleInput', 'dateInput', 'categoriesInput', 'tagsInput', 'mathjaxInput',
      'coverInput', 'excerptInput', 'commitMessage', 'saveButton', 'publishLink',
      'previewFrame', 'previewMode', 'warnings', 'endpointInput', 'wordCount', 'permalink',
      'statusText', 'busy', 'busyText', 'toasts', 'fileInput', 'uploadPanel', 'uploadList',
      'conflictBox', 'conflictText', 'conflictKeep', 'conflictTake',
      'tokenLink', 'modal', 'modalBackdrop', 'modalTitle', 'modalText', 'modalFieldWrap',
      'modalFieldLabel', 'modalInput', 'modalError', 'modalOk', 'modalExtra', 'modalCancel',
      'tabEdit', 'tabPreview',
    ];
    for (const id of ids) el[id] = $(id);
    el.toolbarButtons = Array.from(document.querySelectorAll('[data-action]'));
  }

  function start() {
    cacheElements();
    bind();

    const savedRepo = readStore(STORAGE_KEYS.repo) || DEFAULT_REPO;
    const savedToken = readStore(STORAGE_KEYS.token);
    el.repoInput.value = savedRepo;
    el.tokenLink.href = doc.tokenCreateUrl(savedRepo);
    // 文章页的「编辑」按钮会带 ?p=文件名 过来，登录后自动打开
    state.pendingSlug = readRequestedSlug();
    el.repoInput.addEventListener('input', () => {
      el.tokenLink.href = doc.tokenCreateUrl(el.repoInput.value);
    });
    el.endpointInput.value = preview.getEndpoint();
    el.commitMessage.placeholder = '提交信息（留空自动生成，例如：日志：新增《飞行器安装日记》上篇）';
    state.uploadQueue = upload.createQueue({ doc });

    if (savedToken) {
      el.tokenInput.value = savedToken;
      signIn();
    } else {
      el.tokenInput.focus();
    }
    setStatus('等待登录');
  }

  const api = { state, save, updatePreview, applyToolbar };
  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  return api;
}));
