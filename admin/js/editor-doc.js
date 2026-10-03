(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditorDoc = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  /* ------------------------------------------------------------------
   * 文章文档模型：front-matter 解析 / 序列化、字段校验、命名与资源路径。
   * 纯函数，不触碰 DOM，便于在 node --test 中直接验证。
   * ------------------------------------------------------------------ */

  const MATH_INLINE_PATTERN = /(^|[^\\$])\$[^$\n]+\$/;
  const MATH_BLOCK_PATTERN = /\$\$[\s\S]+?\$\$/;
  const ASSET_IMG_PATTERN = /\{%\s*asset_img\s+([^\s%]+)[^%]*%\}/g;
  const ASSET_LINK_PATTERN = /\{%\s*asset_link\s+([^\s%]+)[^%]*%\}/g;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;
  const BARE_KEY_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;
  const SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
  const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'];
  const MAX_SLUG_LENGTH = 100;
  const KNOWN_WRITABLE_KEYS = ['title', 'date', 'categories', 'tags', 'mathjax', 'cover', 'updated', 'excerpt', 'sitemap'];
  /** front-matter 的规范顺序：新键按此落位，已有键相对顺序不变 */
  const KEY_ORDER = ['title', 'date', 'updated', 'categories', 'tags', 'mathjax', 'cover', 'excerpt', 'sitemap', 'permalink', 'description', 'keywords', 'comments', 'toc'];

  function splitLines(text) {
    return String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  }

  function stripBom(text) {
    return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** 解析成 {key, raw, value} 列表；`raw` 保留原始行，便于最小化改写 diff */
  function parseBlockLines(blockText) {
    const entries = [];
    const lines = splitLines(blockText);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
        entries.push({ key: null, raw: line, value: undefined });
        continue;
      }
      const match = line.match(BARE_KEY_PATTERN);
      if (!match) {
        // 缩进/块标量等本仓库未使用的写法：原样保留，避免误改
        entries.push({ key: null, raw: line, value: undefined });
        continue;
      }
      const key = match[1];
      const inline = match[2].trim();
      // 块状序列（YAML）：
      //   categories:
      //     - 日志
      // 必须整体吃进来。以前只认行内写法，这种会被读成空串，
      // 于是在编辑台里分类显示为空、保存时那一行被当成「已清空」删掉，
      // 而下面的 `- 日志` 成了孤儿行 —— 分类就这样悄悄丢了。
      if (inline === '' && /^\s*-\s+\S/.test(lines[index + 1] || '')) {
        const items = [];
        const raws = [line];
        let cursor = index + 1;
        while (cursor < lines.length && /^\s*-\s+\S/.test(lines[cursor])) {
          raws.push(lines[cursor]);
          items.push(parseScalar(lines[cursor].replace(/^\s*-\s+/, '').trim()));
          cursor += 1;
        }
        entries.push({ key, raw: raws.join('\n'), value: items, block: true });
        index = cursor - 1;
        continue;
      }
      entries.push({ key, raw: line, value: parseScalar(inline) });
    }
    return entries;
  }

  function parseScalar(text) {
    if (text === '') return '';
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null' || text === '~') return null;
    if (/^\[.*\]$/.test(text)) return parseInlineList(text);
    if (/^'(?:[^']|'')*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
    if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
      try {
        return JSON.parse(text);
      } catch (error) {
        return text.slice(1, -1);
      }
    }
    return text;
  }

  function parseInlineList(text) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map((item) => {
        const value = parseScalar(item);
        return value === null || value === undefined ? '' : value;
      });
  }

  /** 会被解析成布尔/数字/null 的字面量必须加引号，否则回读类型会变 */
  const AMBIGUOUS_SCALAR = /^(?:true|false|null|~|yes|no|on|off|[-+]?\d+(?:\.\d+)?)$/i;

  function serializeScalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `[${value.map((item) => String(item)).join(', ')}]`;
    const text = String(value);
    if (text === '') return '';
    const needsQuote =
      text !== text.trim() ||
      /[:#\[\]{}'"\\]/.test(text) ||
      /^[-?*&!|>%@`]/.test(text) ||
      AMBIGUOUS_SCALAR.test(text);
    if (!needsQuote) return text;
    if (!text.includes("'")) return `'${text}'`;
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  /** 解析整篇 Markdown：拆出 front-matter 与正文 */
  function parseDocument(source) {
    const text = stripBom(String(source ?? '')).replace(/\r\n?/g, '\n');
    const bom = typeof source === 'string' && source.charCodeAt(0) === 0xfeff;
    const openMatch = text.match(/^---[ \t]*\n/);
    if (!openMatch) {
      return { hasFrontMatter: false, frontMatterRaw: '', body: text, bom, eol: 'lf' };
    }
    const rest = text.slice(openMatch[0].length);
    const closeMatch = rest.match(/(?:^|\n)---[ \t]*(?:\n|$)/);
    if (!closeMatch) {
      return { hasFrontMatter: false, frontMatterRaw: '', body: text, bom, eol: 'lf' };
    }
    const closeStart = closeMatch.index + (closeMatch[0].startsWith('\n') ? 1 : 0);
    const frontMatterRaw = rest.slice(0, closeStart);
    const bodyStart = closeMatch.index + closeMatch[0].length;
    return { hasFrontMatter: true, frontMatterRaw, body: rest.slice(bodyStart), bom, eol: 'lf' };
  }

  /** 连载行注释（含其后的说明行）一并取出，避免插到注释与说明之间 */
  function takeCommentLines(entries) {
    const lines = [];
    while (entries.length && entries[0].trim() === '') entries.shift();
    while (entries.length && /^\s*#/.test(entries[0])) {
      lines.push(entries.shift().replace(/\s+$/, ''));
      while (entries.length && /^\s*$/.test(entries[0]) && entries.length > 1 && /^\s*#/.test(entries[1])) {
        entries.shift();
      }
    }
    while (entries.length && entries[0].trim() === '') entries.shift();
    return lines;
  }

  /** 比较两个 front-matter 标量语义上是否相同（数组按元素、布尔按真假） */
  function sameScalar(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
      const left = (Array.isArray(a) ? a : [a]).map((item) => String(item ?? '')).filter((item) => item !== '');
      const right = (Array.isArray(b) ? b : [b]).map((item) => String(item ?? '')).filter((item) => item !== '');
      return left.length === right.length && left.every((item, index) => item === right[index]);
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
    return String(a ?? '') === String(b ?? '');
  }

  /** 空的覆盖值（''、[]、false、null）不应作为新键写进 front-matter */
  function isEmptyOverride(value) {
    if (value === '' || value === null || value === undefined || value === false) return true;
    return Array.isArray(value) && value.length === 0;
  }

  /** 写出来会变成 YAML 空值（null）的覆盖值。
   *  注意 undefined **不算**：undefined 的语义是「调用方没给值」，应当保留原行，
   *  而不是删掉字段（真实事故：一次保存把原有的 mathjax: false 弄丢了）。 */
  function isNullLike(value) {
    return value === '' || value === null;
  }

  /** 序列化：未改动的已存在键沿用原始行，只重写被显式设置过的键。
   *  新键先按原始行序插入（保证已有键的相对顺序不变），再按规范顺序稳定排序。 */
  function serializeDocument(doc, meta, options = {}) {
    const body = String(doc?.body ?? '');
    const entries = doc?.hasFrontMatter ? parseBlockLines(doc.frontMatterRaw) : [];
    const overrides = meta || {};

    const rendered = new Map();
    const existingKeys = new Set(entries.filter((entry) => entry.key).map((entry) => entry.key));
    const hasNewKeys = Object.keys(overrides).some((key) => !existingKeys.has(key));
    /** 被「给新键让位」跳过的原始行：这些键不在 overrides 里，必须原样补回去，不能丢 */
    const deferred = new Map();
    let index = 0;
    let patched = 0;
    for (const entry of entries) {
      if (entry.key && Object.prototype.hasOwnProperty.call(overrides, entry.key)) {
        if (rendered.has(entry.key)) continue;
        // 调用方没给值（undefined）＝ 对字段没有意见，原样保留。
        // 这条护栏是必要的：把 undefined 当空值处理会静默删掉用户原有的字段。
        if (overrides[entry.key] === undefined) {
          rendered.set(entry.key, entry.raw);
          patched += 1;
          continue;
        }
        if (isNullLike(overrides[entry.key])) {
          // ⚠️ 绝对不能写出裸的 `excerpt:` —— 那是 YAML 的 null，
          // Hexo 的 post schema 要求该字段是字符串，校验失败会**整篇跳过**
          // （日志只留一行 Process failed），文章页直接消失：
          // 用户看到的就是「文章没了 / 打不开」，而仓库里文件还在。
          // 所以显式清空的值一律删掉这一行，而不是原样写回。
          patched += 1;
          continue;
        }
        // 值没变就沿用原始行：否则 `date: 2026-09-16 09:00:00` 会被重写成加引号的形式，
        // 明明没动过却产生 diff（编辑台承诺的是「只重写改过的行」）。
        rendered.set(
          entry.key,
          sameScalar(entry.value, overrides[entry.key])
            ? entry.raw
            : `${entry.key}: ${serializeScalar(overrides[entry.key])}`,
        );
        patched += 1;
        continue;
      }
      if (entry.key && rendered.has(entry.key)) continue;
      // 没有新增键时逐行原样保留；有新增键时，在第一个规范位置之前的已知键处让位给新键
      if (hasNewKeys && entry.key && KEY_ORDER.includes(entry.key) && patched === 0) {
        deferred.set(entry.key, entry.raw);
        continue;
      }
      if (entry.key) rendered.set(entry.key, entry.raw);
      else rendered.set(`\u0000${index}`, entry.raw);
      index += 1;
    }
    // 让过位的原始行补回去（它们不在 overrides 里，否则上面就会命中第一个分支）。
    // 不做这一步的话，「让位」就等于静默删字段。
    for (const [key, raw] of deferred) {
      if (!rendered.has(key)) rendered.set(key, raw);
    }
    for (const key of Object.keys(overrides)) {
      if (rendered.has(key)) continue;
      if (!BARE_KEY_PATTERN.test(`${key}:`)) continue;
      // 编辑台每次都会把 cover / excerpt 一并交给序列化（哪怕是空串）。
      // 若原文件没有这两个键、用户也没填，就不要再插进去：
      // 空 excerpt 会让 Hexo 不再自动从正文生成摘要，属于真会改变站点表现的副作用。
      if (isEmptyOverride(overrides[key])) continue;
      rendered.set(key, `${key}: ${serializeScalar(overrides[key])}`);
    }

    const lines = Array.from(rendered.values());
    const comments = takeCommentLines(lines);
    const canonical = [];
    const extras = [];
    for (const key of KEY_ORDER) {
      if (rendered.has(key) && rendered.get(key).trim() !== '') canonical.push(rendered.get(key));
    }
    for (const line of lines) {
      if (line.trim() === '') continue;
      if (canonical.includes(line)) continue;
      extras.push(line);
    }
    const header = [...comments, ...canonical, ...extras];
    return `---\n${header.join('\n')}\n---\n${body}`;
  }

  function toPlainObject(doc) {
    const result = {};
    if (!doc?.hasFrontMatter) return result;
    for (const entry of parseBlockLines(doc.frontMatterRaw)) {
      if (!entry.key) continue;
      if (Object.prototype.hasOwnProperty.call(result, entry.key)) continue;
      result[entry.key] = entry.value;
    }
    return result;
  }

  function formatBeijingDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? '00';
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`;
  }

  /** 由标题生成默认文件名（保留中文，去掉路径与非法字符） */
  function slugify(title) {
    const base = String(title ?? '')
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[.\-]+|[.\-]+$/g, '');
    const slug = base || `post-${formatBeijingDate().slice(0, 10)}`;
    return slug.slice(0, MAX_SLUG_LENGTH);
  }

  /** 文件名校验：拒绝路径穿越、保留名、非法字符 */
  function validateSlug(slug) {
    const value = String(slug ?? '').trim();
    if (!value) return { ok: false, reason: '文件名不能为空' };
    if (value.length > MAX_SLUG_LENGTH) return { ok: false, reason: `文件名过长（上限 ${MAX_SLUG_LENGTH} 字符）` };
    if (value === '.' || value === '..') return { ok: false, reason: '文件名不能是 . 或 ..' };
    if (/[\\/]/.test(value)) return { ok: false, reason: '文件名不能包含路径分隔符' };
    if (value.startsWith('.')) return { ok: false, reason: '文件名不能以点开头' };
    if (/[\u0000-\u001f<>:"|?*]/.test(value)) return { ok: false, reason: '文件名包含非法字符' };
    if (WINDOWS_RESERVED.test(value)) return { ok: false, reason: `“${value}” 是系统保留名` };
    if (!SLUG_PATTERN.test(value)) return { ok: false, reason: '文件名只能包含文字、数字、点、下划线与连字符' };
    return { ok: true, slug: value };
  }

  function postPath(slug) {
    return `source/_posts/${slug}.md`;
  }

  function assetDir(slug) {
    return `source/_posts/${slug}`;
  }

  const POST_PATH_PATTERN = /^source\/_posts\/([^/]+)\.md$/;

  /** 从仓库路径取出文件名（不含扩展名） */
  function slugFromPath(filePath) {
    const match = String(filePath ?? '').match(POST_PATH_PATTERN);
    return match ? match[1] : null;
  }

  function isPostPath(filePath) {
    return POST_PATH_PATTERN.test(String(filePath ?? ''));
  }

  function assetPath(slug, fileName) {
    return `${assetDir(slug)}/${fileName}`;
  }

  /** 收集正文引用的资源文件名（asset_img / asset_link） */
  function referencedAssets(body) {
    const found = [];
    const text = String(body ?? '');
    for (const pattern of [ASSET_IMG_PATTERN, ASSET_LINK_PATTERN]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match) {
        const name = match[1].replace(/^['"]|['"]$/g, '');
        found.push(name.split('/').pop());
        match = pattern.exec(text);
      }
    }
    return Array.from(new Set(found));
  }

  function hasMath(body) {
    const text = String(body ?? '');
    return MATH_BLOCK_PATTERN.test(text) || MATH_INLINE_PATTERN.test(text);
  }

  function wordCount(body) {
    const text = String(body ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\{%[^%]*%\}/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/[#>*`_~-]/g, ' ');
    const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    return cjk + latin;
  }

  function readingMinutes(count) {
    return Math.max(1, Math.round(Number(count || 0) / 300));
  }

  function isImageName(fileName) {
    const extension = String(fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTENSIONS.includes(extension);
  }

  const IMAGE_MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };

  function extensionForMime(mime) {
    return IMAGE_MIME_EXTENSIONS[String(mime ?? '').toLowerCase()] ?? null;
  }

  /** 资源重名时追加 -2 / -3 后缀 */
  function uniqueAssetName(fileName, taken = []) {
    const takenLower = new Set(taken.map((name) => String(name).toLowerCase()));
    const value = String(fileName ?? '').trim() || 'image.png';
    if (!takenLower.has(value.toLowerCase())) return value;
    const dot = value.lastIndexOf('.');
    const stem = dot > 0 ? value.slice(0, dot) : value;
    const extension = dot > 0 ? value.slice(dot) : '';
    let index = 2;
    let candidate = `${stem}-${index}${extension}`;
    while (takenLower.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `${stem}-${index}${extension}`;
    }
    return candidate;
  }

  function escapeTagArgument(name) {
    return String(name ?? '').replace(/["'%]/g, '').replace(/\s+/g, '-');
  }

  /** 生成 asset_img 标签（描述与宽度可选，宽度是 Hexo 的 "alt" width 写法） */
  function assetImageTag(name, alt = '', width = '') {
    const safe = escapeTagArgument(name);
    const description = String(alt ?? '').replace(/["%]/g, '').trim();
    const parts = [`{% asset_img ${safe}`];
    if (description) parts.push(`"${description}"`);
    if (width) parts.push(`"${String(width).replace(/["%]/g, '').trim()}"`);
    return `${parts.join(' ')} %}`;
  }

  /** 从 asset_img 标签里读出宽度（第二个参数），用于插入时继承已有配图宽度 */
  function assetImageWidths(body) {
    const widths = [];
    const pattern = /\{%\s*asset_img\s+[^\s%]+\s+"[^"]*"\s+"([^"]*)"\s*%\}/g;
    let match = pattern.exec(String(body ?? ''));
    while (match) {
      if (match[1]) widths.push(match[1]);
      match = pattern.exec(String(body ?? ''));
    }
    return widths;
  }

  /** 依 scaffolds/post.md 的字段顺序生成新文章（正文可留空） */
  function createPostSource({ title = '', date, categories = [], tags = [], mathjax = false, cover = '', body = '' } = {}) {
    const lines = [
      '---',
      `title: ${serializeScalar(title)}`,
      `date: ${serializeScalar(date || formatBeijingDate())}`,
      `categories: ${serializeScalar(categories)}`,
      `tags: ${serializeScalar(tags)}`,
      `mathjax: ${mathjax ? 'true' : 'false'}`,
      `cover: ${serializeScalar(cover)}`,
      '---',
      '',
    ];
    const content = String(body ?? '');
    return content ? `${lines.join('\n')}${content}` : lines.join('\n');
  }

  /** 保存前校验：错误=拦截，警告=提示 */
  function validatePost({ slug, meta, body, assetFiles = [] } = {}) {
    const errors = [];
    const warnings = [];
    const slugCheck = validateSlug(slug);
    if (!slugCheck.ok) errors.push(slugCheck.reason);

    const data = meta || {};
    const title = String(data.title ?? '').trim();
    if (!title) errors.push('title 不能为空');
    // date 是硬性要求，不能留空：序列化对「空值」的规则是删掉那一行，而 Hexo 缺 date
    // 会退到文件的出生时间 —— 永久链接随构建机变化（CI 上是检出时间），同一天连续
    // 构建可能给出不同 URL；test/verify-site.mjs 也会因解析不出 date 直接失败，
    // 发布流程卡在那里不再发版，而用户这边只看到「提交成功」。
    const date = String(data.date ?? '').trim();
    if (!date) {
      errors.push('date 不能为空（Hexo 会退到文件创建时间，文章地址会跟着构建机变）');
    } else if (!DATE_PATTERN.test(date)) {
      errors.push('date 需为 YYYY-MM-DD HH:mm:ss');
    }
    if (data.updated !== undefined && data.updated !== null && String(data.updated).trim() !== '' && !DATE_PATTERN.test(String(data.updated).trim())) {
      errors.push('updated 需为 YYYY-MM-DD HH:mm:ss');
    }
    if (data.mathjax !== undefined && typeof data.mathjax !== 'boolean') errors.push('mathjax 只能是 true 或 false');
    for (const key of ['categories', 'tags']) {
      if (data[key] === undefined || data[key] === null) continue;
      if (!Array.isArray(data[key])) errors.push(`${key} 需为数组`);
    }
    if (data.cover !== undefined && data.cover !== null && String(data.cover).trim() !== '' && !String(data.cover).startsWith('/')) {
      warnings.push('cover 建议使用以 / 开头的站内路径');
    }

    const bodyText = String(body ?? '');
    if (bodyText.trim() === '') warnings.push('正文还是空的，发布后文章页只有标题');
    if (hasMath(bodyText) && data.mathjax !== true) warnings.push('正文含公式但 mathjax 不是 true，线上不会渲染公式');
    if (data.mathjax === true && !hasMath(bodyText)) warnings.push('mathjax 为 true 但正文没有公式');
    if (Array.isArray(data.categories) && data.categories.length === 0) warnings.push('未设置分类，将归入 uncategorized');

    const assetsLower = new Set(assetFiles.map((name) => String(name).toLowerCase()));
    const missing = referencedAssets(bodyText).filter((name) => !assetsLower.has(name.toLowerCase()));
    if (missing.length) errors.push(`正文引用了不存在的资源：${missing.join('、')}（应放在 ${assetDir(slug)}/）`);

    if (slug && slugFromPath(postPath(slug)) !== slug) errors.push('文章路径不合法');

    return { ok: errors.length === 0, errors, warnings };
  }

  /** 计算发布后的文章地址（与 _config.yml 的 permalink 规则一致） */
  function permalinkFor(meta, siteUrl = '') {
    const date = String(meta?.date ?? '').trim();
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const slug = String(meta?.slug ?? '').trim();
    if (!match || !slug) return '';
    const base = String(siteUrl || '').replace(/\/+$/, '');
    return `${base}/${match[1]}/${match[2]}/${match[3]}/${encodeURIComponent(slug)}/`;
  }

  /**
   * 生成「预填参数的令牌创建链接」：GitHub 支持用查询参数预填细粒度令牌的
   * 名称、说明与权限，点开即可少配几步（仓库选择仍需手动勾选，GitHub 未提供该参数）。
   * @see https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
   */
  function tokenCreateUrl(repoFullName) {
    const cleaned = String(repoFullName ?? '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const parts = cleaned.split('/').filter(Boolean);
    const repo = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '本博客仓库';
    const params = new URLSearchParams();
    params.set('name', '博客编辑台');
    params.set('description', `供 ${repo} 的在线编辑台使用：只提交文章与配图，权限只给 Contents 读写，有效期建议 90 天。`);
    params.set('contents', 'write');
    return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
  }

  return {
    KNOWN_WRITABLE_KEYS,
    KEY_ORDER,
    IMAGE_EXTENSIONS,
    MAX_SLUG_LENGTH,
    parseDocument,
    serializeDocument,
    toPlainObject,
    parseBlockLines,
    parseScalar,
    serializeScalar,
    sameScalar,
    isEmptyOverride,
    isNullLike,
    formatBeijingDate,
    slugify,
    validateSlug,
    postPath,
    assetDir,
    assetPath,
    slugFromPath,
    isPostPath,
    referencedAssets,
    hasMath,
    wordCount,
    readingMinutes,
    isImageName,
    extensionForMime,
    uniqueAssetName,
    assetImageTag,
    assetImageWidths,
    createPostSource,
    validatePost,
    permalinkFor,
    tokenCreateUrl,
  };
}));
