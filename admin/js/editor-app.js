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
  // 源码（source/_posts/*.md）在私有仓库里；公开的 Einstein-Newton-666.github.io 只收构建产物，
  // 往它写文章源码等于把私密文章公开，所以默认值必须指向源码仓库。
  const DEFAULT_REPO = 'Einstein-Newton-666/einblog-source';
  const PUBLIC_ARTIFACT_REPO = 'einstein-newton-666/einstein-newton-666.github.io';

  /**
   * 误把公开产物仓库当成源码仓库时给出提示（返回空串表示无需提示）。
   * 纯函数，便于单测。
   */
  function sourceRepoWarning(repoFullName) {
    const cleaned = String(repoFullName ?? '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    if (!cleaned) return '';
    if (cleaned.toLowerCase() !== PUBLIC_ARTIFACT_REPO) return '';
    return '这是只存放构建产物的公开仓库，往它提交文章源码会把私密文章公开。'
      + '请改成源码仓库 Einstein-Newton-666/einblog-source。';
  }

  const state = {
    client: null,
    repo: null,
    head: null,
    posts: [],
    current: null,
    conflict: null,
    listFilter: '',
    listError: '',
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
   * @returns {Promise<string|true|false|null>} 取消 null；主按钮 true/输入值；extraText 按钮 false
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
    // 副按钮必须给出一个与主按钮不同的值。以前它和主按钮一样返回 true，
    // 于是「只删文章」与「文章和配图都删」在调用方眼里是同一件事：
    // 点「只删文章」照样把整个资源文件夹一起提交删除，提示还写着「只删文章」。
    const value = primary ? (el.modalFieldWrap.hidden ? true : el.modalInput.value) : false;
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
    // 拦在提交之前：产物仓库里没有源码，往它写会把私密文章公开
    const repoWarning = sourceRepoWarning(repoInput);
    if (repoWarning) {
      el.loginError.textContent = repoWarning;
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
    setListOpen(false);
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
    state.listError = '';
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
      // 关键：读失败必须明说。以前这里只弹一条会消失的提示，列表则显示
      // 「仓库里还没有文章」——和「文章真的没了」长得一模一样，
      // 手机上网络一断就会以为自己写的东西丢了。
      state.listError = publish.maskToken(error.message);
      renderPostList();
      toast(`读取文章列表失败：${state.listError}`, 'error');
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
    updateListToggleLabel(state.posts.length);
    // 读取失败时先说清楚是「没读到」，而不是「没有文章」
    if (state.listError) {
      const box = document.createElement('div');
      box.className = 'admin-sidebar__failed';
      const message = document.createElement('p');
      message.className = 'admin-sidebar__empty';
      message.textContent = `文章列表没读出来：${state.listError}`;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'admin-btn admin-btn--block';
      retry.textContent = '↻ 重试';
      retry.addEventListener('click', () => loadPosts());
      const hint = document.createElement('p');
      hint.className = 'admin-sidebar__note';
      hint.textContent = '文章没有被删除，只是这次没读到。手机流量下 api.github.com 有时会连不上，'
        + '可以换个网络再重试。';
      box.append(message, retry, hint);
      el.postList.appendChild(box);
      return;
    }
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

  /* ---------------------- 手机端：文章列表抽屉 ----------------------
   * 窄屏下列表默认收起（见 admin-editor.css 的 ≤760px 段），
   * 否则列表会一直占掉三成屏幕，正文输入区被压得只剩几行。
   * ------------------------------------------------------------------ */

  /** 顶栏按钮文案；纯函数，便于单测 */
  function listToggleLabel(count) {
    const total = Number.isFinite(count) && count > 0 ? `（${count}）` : '';
    return `📄 文章列表${total}`;
  }

  function updateListToggleLabel(count) {
    if (!el.listToggle) return;
    el.listToggle.textContent = listToggleLabel(count);
  }

  /** 展开/收起文章列表；宽屏下 CSS 不生效，等于空操作 */
  function setListOpen(open) {
    if (!el.workspace) return;
    el.workspace.classList.toggle('admin-list-open', !!open);
    if (el.listToggle) el.listToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function isListOpen() {
    return !!(el.workspace && el.workspace.classList.contains('admin-list-open'));
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
        // front-matter 的原文：保存时交给序列化做最小改动（见 buildSource）
        frontMatterRaw: parsed.frontMatterRaw,
        // 打开时的远端版本快照：保存时用它判断「这次到底改没改」，
        // 只有真改了才盖「最后更新」时间戳（没有改动的重复保存不该推时间）
        loadedMeta: JSON.parse(JSON.stringify(meta)),
        loadedBody: parsed.body,
        dirty: false,
        newPost: false,
        localAssets: [],
        remoteAssets: await listRemoteAssets(slug),
      };
      state.conflict = null;
      state.uploadQueue.clear();
      fillEditor();
      renderPostList();
      setListOpen(false);          // 手机端选完就收起列表，把屏幕还给正文
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

  /**
   * front-matter 里的 categories / tags 也可能是标量写法（`categories: 日志`）。
   * 只用 Array.isArray 判断的话，这类文章在编辑台里显示为空，保存时被当成
   * 「用户清空了分类」改写成 `categories: []` —— 分类就这么静默丢了，
   * 站点的 /logs/ 分类页与分类列表都会少一篇，而用户只改了正文。
   */
  function listToInput(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value === null || value === undefined) return '';
    return String(value);
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
    el.categoriesInput.value = listToInput(current.meta.categories);
    el.tagsInput.value = listToInput(current.meta.tags);
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

  /** 表单真正在编辑的字段；其余键（private、permalink、自定义键…）一律以远端为准 */
  const FORM_FIELDS = ['title', 'date', 'categories', 'tags', 'mathjax', 'cover', 'excerpt'];

  /** 只取表单字段。collectMeta() 会把整个 meta 都带上，不能直接拿来当「本地改动」用：
   *  那样等于宣称本地对每个键都有意见，远端删掉的字段会被原样写回去。 */
  function editedMeta() {
    const all = collectMeta();
    const picked = {};
    for (const key of FORM_FIELDS) picked[key] = all[key];
    return picked;
  }

  function buildSource(extraMeta) {
    // textarea 里是**纯正文**，不是整篇文档：这里绝不能再过一遍 parseDocument。
    // 正文第一行若是 ---（拿 --- 当分隔线的常见写法），会被当成 front-matter 的开栏，
    // 到下一个 --- 之间整段正文就被当成元数据吃掉了 —— 保存成功、没有提示，
    // git 里也看不出是编辑器主动删的。粘贴一整篇带 front-matter 的 markdown 同理。
    const body = String(el.markdown.value ?? '').replace(/\r\n?/g, '\n');
    // 必须把「打开时读到的那段 front-matter 原文」交给序列化，否则等于每次保存都
    // 把 front-matter 整个重建：date 会被加引号、注释与未知字段丢失、
    // 块状列表（categories:\n  - 日志）会被抹掉、mathjax: false 这类默认值会消失。
    // serializeDocument 的「只重写改过的行」全靠这段原文。
    const rawFrontMatter = (state.current && state.current.frontMatterRaw) || '';
    return doc.serializeDocument(
      { hasFrontMatter: true, frontMatterRaw: rawFrontMatter, body },
      Object.assign(collectMeta(), extraMeta || {}),
    );
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
    renderDraftPanel();
  }

  function clearDraft(path) {
    dropStore(STORAGE_KEYS.draft(path));
    renderDraftPanel();
  }

  /* ------------------------- 本机草稿总览 -------------------------
   * 草稿按「文章路径」存在本机浏览器里，正常流程是打开同一篇文章时提示恢复。
   * 但有两种情况会取不回来，用户就会以为写的东西没了：
   *   · 文章列表读失败（连不上 api.github.com），根本进不了那篇文章
   *   · 文章被改名/删除，草稿的键再也对不上
   * 所以这里把所有草稿列出来，可以直接恢复；仓库里已经没有的，
   * 允许按草稿内容重新建一篇，避免辛苦写的东西烂在 localStorage 里。
   * ---------------------------------------------------------------- */

  const DRAFT_PREFIX = 'einblog.admin.draft.v1::';

  function listDrafts() {
    const items = [];
    let keys = [];
    try { keys = Object.keys(globalThis.localStorage || {}); } catch (error) { return items; }
    for (const key of keys) {
      if (!key.startsWith(DRAFT_PREFIX)) continue;
      const path = key.slice(DRAFT_PREFIX.length);
      let payload = null;
      try { payload = JSON.parse(readStore(key) || 'null'); } catch (error) { payload = null; }
      if (!payload || typeof payload.body !== 'string') continue;
      items.push({
        path,
        meta: payload.meta || {},
        body: payload.body,
        savedAt: payload.savedAt || '',
        words: doc.wordCount ? doc.wordCount(payload.body) : 0,
      });
    }
    return items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  function formatDraftTime(iso) {
    if (!iso) return '时间未知';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function renderDraftPanel() {
    if (!el.draftPanel) return;
    const drafts = listDrafts();
    el.draftPanel.textContent = '';
    el.draftPanel.hidden = drafts.length === 0;
    if (!drafts.length) return;

    const title = document.createElement('h3');
    title.textContent = `本机还有 ${drafts.length} 份没发布的草稿`;
    const note = document.createElement('p');
    note.className = 'admin-drafts__note';
    note.textContent = '这些改动只存在这台设备的浏览器里，没有提交到仓库。点一下就能接着编辑。';
    el.draftPanel.append(title, note);

    for (const draft of drafts) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'admin-draft';
      const head = document.createElement('span');
      head.className = 'admin-draft__title';
      head.textContent = draft.meta.title || doc.slugFromPath(draft.path) || draft.path;
      const meta = document.createElement('span');
      meta.className = 'admin-draft__meta';
      meta.textContent = `${formatDraftTime(draft.savedAt)} · ${draft.words} 字 · ${draft.path}`;
      row.append(head, meta);
      row.addEventListener('click', () => openDraft(draft));
      el.draftPanel.appendChild(row);
    }
  }

  /** 打开一份本机草稿：仓库里还有这篇文章就正常打开（会提示恢复），否则按草稿新建 */
  async function openDraft(draft) {
    if (!state.client) {
      toast('请先登录，再恢复草稿', 'warn');
      el.tokenInput.focus();
      return;
    }
    const known = state.posts.find((post) => post.path === draft.path);
    if (known) {
      await openPost(draft.path);
      return;
    }
    // state.posts 里没有 ≠ 仓库里没有：列表可能压根没读出来（state.listError 时
    // state.posts 是空的），也可能是刚在别的设备上建的。必须按路径实取一次再下结论 ——
    // 判断错了就会走下面的「按草稿新建」，保存时带着当前 HEAD 直接把远端仍在的
    // 同名文件静默覆盖，而且 newPost=true 还让这次保存不盖 updated，站点「更新于」
    // 也不变，用户以为只是新建了一篇。
    let missing = false;
    busy(true, '正在确认这篇文章还在不在…');
    try {
      await state.client.getFile(draft.path);
    } catch (error) {
      // 只有明确的 404 才算「仓库里没有」；网络、权限问题一律不下结论
      if (error && error.status === 404) {
        missing = true;
      } else {
        busy(false);
        toast(`没法确认这篇还在不在仓库里：${publish.maskToken(error.message)}`, 'error');
        return;
      }
    }
    busy(false);
    if (!missing) {
      await openPost(draft.path);
      return;
    }
    const slug = doc.slugFromPath(draft.path) || '';
    const answer = await openModal({
      title: '这篇在仓库里找不到了',
      text: `草稿 <code>${draft.path}</code> 还在这台设备上，但仓库里没有对应文件（可能被改名或删除了）。<br>`
        + '可以按草稿内容重新建一篇，标题与正文都取自草稿。',
      okText: '按草稿新建',
    });
    if (answer === null) return;
    state.current = {
      path: draft.path || doc.postPath(slug || 'draft'),
      slug: slug || draft.path,
      sha: '',
      baseHead: state.head ? state.head.sha : '',
      meta: draft.meta,
      body: draft.body,
      dirty: true,
      newPost: true,
      localAssets: [],
      remoteAssets: [],
    };
    state.uploadQueue.clear();
    fillEditor();
    renderPostList();
    setListOpen(false);
    setStatus('已按本机草稿恢复，保存后会提交到仓库');
    toast('已从本机草稿恢复，检查后点「保存并发布」', 'ok');
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

  /** 编辑器能改的那部分内容的快照，用来判断「这次保存到底有没有改动」 */
  function editorSnapshot(meta, body) {
    const list = (value) => (Array.isArray(value) ? value : []).map(String).join('|');
    return JSON.stringify([
      String(meta?.title ?? ''),
      String(meta?.date ?? ''),
      String(meta?.mathjax ?? false),
      String(meta?.cover ?? ''),
      String(meta?.excerpt ?? ''),
      list(meta?.categories),
      list(meta?.tags),
      String(body ?? ''),
    ]);
  }

  /** 相对「打开时读到的远端版本」有没有改动 */
  function hasEditorChanges() {
    const current = state.current;
    if (!current) return false;
    if (current.newPost) return true;
    return editorSnapshot(collectMeta(), el.markdown.value)
      !== editorSnapshot(current.loadedMeta, current.loadedBody);
  }

  function currentFiles(uploadedFiles, extraMeta) {
    const files = [{
      path: state.current.path,
      content: buildSource(extraMeta),
    }];
    // encoding 必须原样带上：配图的 content 已经是 base64 文本，丢了标记就会被
    // 提交层当成普通文本再编一次，仓库里存下的就不是图片字节了
    for (const file of uploadedFiles || []) {
      files.push({ path: file.path, content: file.content, encoding: file.encoding });
    }
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

    // 真的改了内容才盖「最后更新」时间戳：
    // 站点的 updated_option 是 'date'（等于发布时间），若不显式写 updated，
    // 手机上编辑完文章，页面上的「更新于」永远不会变——用户会以为没保存成功。
    // 反之，没有任何改动的重复点保存不该把时间戳往前推。
    const changed = hasEditorChanges();
    const stamp = (!state.current.newPost && changed) ? doc.formatBeijingDate() : '';

    busy(true, publishNow ? '正在提交并触发部署…' : '正在提交…');
    try {
      const files = currentFiles(uploadedFiles, stamp ? { updated: stamp } : {});
      const result = await state.client.putFiles(files, {
        message,
        expectedHead: state.current.baseHead || undefined,
      });
      state.uploadQueue.markCommitted();
      state.current.sha = '';
      state.current.baseHead = result.sha;
      state.current.dirty = false;
      state.current.newPost = false;
      // 以刚提交的内容为新的基准：front-matter 原文 + 版本快照，
      // 这样「再点一次保存」既不会重排字段，也不会推后 updated。
      // 基准必须从「提交出去的那份文档」重建，不能用 collectMeta()：后者带的是
      // 本次保存之前 state 里的 updated，于是不刷新页面再点一次保存，就会把这个
      // 刚写进去的时间戳改回旧值 —— 站点「更新于」回退，编辑器还提示提交成功。
      const committed = doc.parseDocument(files[0].content);
      const committedMeta = doc.toPlainObject(committed);
      state.current.frontMatterRaw = committed.frontMatterRaw;
      state.current.meta = committedMeta;
      state.current.loadedMeta = JSON.parse(JSON.stringify(committedMeta));
      // loadedBody 存 textarea 的原文（不是 committed.body）：hasEditorChanges
      // 拿它跟 textarea 逐字比较，换行符被规整过就会误判成「改了」，白推一次时间戳。
      state.current.loadedBody = el.markdown.value;
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
      const remoteMeta = doc.toPlainObject(parsed);
      // 基准整体换成远端这一版，只有表单里真正在编辑的字段覆盖上去。
      // 以前这里只刷新 meta/baseHead/sha，frontMatterRaw 仍是冲突前那份原文，于是
      // 下一次保存会按旧原文把远端已经删掉的字段（例如一行 private: true）原样写回：
      // 远端的删除被悄悄撤销，而提交记录看起来只是普通的内容更新。
      state.current.meta = Object.assign(remoteMeta, editedMeta());
      state.current.frontMatterRaw = parsed.frontMatterRaw;
      state.current.loadedMeta = JSON.parse(JSON.stringify(remoteMeta));
      state.current.loadedBody = parsed.body;
      const syncedHead = await state.client.getHead();
      state.current.baseHead = syncedHead.sha;
      state.current.sha = file.sha;
      // 缓存里的 HEAD 与顶栏也要一起跟上：新建文章拿的是 state.head.sha 当 baseHead，
      // 不刷新的话，「刚同步完 → 新建文章 → 第一次保存」会撞上一个假冲突
      state.head = syncedHead;
      el.headLabel.textContent = syncedHead.sha.slice(0, 7);
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
    setListOpen(false);            // 新建后同样收起列表，直接进入写作
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
    const { pushed, rejected } = state.uploadQueue.add(fileList, {
      slug: state.current.slug,
      // 仓库里已有的同名配图也要参与去重：只看队列自己，同名上传会静默覆盖远端那张图
      existingNames: knownAssetNames(),
    });
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
    // 切到预览时顺手收起列表，否则列表会跟预览抢那点高度
    if (showPreview) setListOpen(false);
    if (showPreview) updatePreview();
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  /* ------------------------------ 视口高度 ------------------------------
   * 壳高优先用 JS 量出来的 innerHeight（写成 --admin-app-height）。
   * CSS 里虽然写了 100dvh + 100vh 回退，但有些手机浏览器（老 Chromium 内核、
   * X5/XWeb 之类）两者都不准：dvh 不认、100vh 又比可视区大，于是底部那排
   * 「编辑/预览」标签栏会被顶到屏幕外且滚不到。用像素值最靠谱。
   * -------------------------------------------------------------------- */

  function applyAppHeight() {
    const height = Math.round(root.innerHeight || 0);
    if (height > 0) {
      document.documentElement.style.setProperty('--admin-app-height', `${height}px`);
    }
  }

  function bindViewportHeight() {
    root.addEventListener('resize', applyAppHeight);
    root.addEventListener('orientationchange', applyAppHeight);
    // 键盘弹出/收起、地址栏收放也会改变可视高度
    if (root.visualViewport) root.visualViewport.addEventListener('resize', applyAppHeight);
  }

  function bind() {
    el.signInButton.addEventListener('click', signIn);
    el.tokenInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
    el.repoInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
    el.forgetButton.addEventListener('click', forgetToken);
    el.signOutButton.addEventListener('click', signOut);
    el.reloadButton.addEventListener('click', loadPosts);
    el.newPostButton.addEventListener('click', createPost);
    if (el.listToggle) el.listToggle.addEventListener('click', () => setListOpen(!isListOpen()));
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
      'listToggle', 'postSidebar',
      'filterInput', 'postList', 'placeholder', 'draftPanel', 'editorPane', 'metaForm', 'editor', 'currentPath',
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
    bindViewportHeight();
    applyAppHeight();

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
    updateListToggleLabel(0);
    setListOpen(false);
    renderDraftPanel();

    if (savedToken) {
      el.tokenInput.value = savedToken;
      signIn();
    } else {
      el.tokenInput.focus();
    }
    setStatus('等待登录');
  }

  const api = {
    state, save, updatePreview, applyToolbar, sourceRepoWarning,
    listToggleLabel, setListOpen, isListOpen,
    listDrafts, formatDraftTime, editorSnapshot,
  };
  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
  return api;
}));
