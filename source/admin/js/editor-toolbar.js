(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditorToolbar = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  /* ------------------------------------------------------------------
   * 工具条文本变换：全部是「选中区间 → 新文本 + 新选区」的纯函数，
   * 便于在 node --test 里直接验证，不依赖 DOM。
   * ------------------------------------------------------------------ */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** 按行（整行）变换，保持缩进 */
  function mapLines(text, start, end, transform) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;
    const block = text.slice(lineStart, lineEnd);
    const next = transform(block.split('\n')).join('\n');
    return {
      text: text.slice(0, lineStart) + next + text.slice(lineEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart + next.length,
    };
  }

  function togglePrefix(text, start, end, prefix, options = {}) {
    const ordered = options.ordered === true;
    return mapLines(text, start, end, (lines) => {
      const matcher = ordered ? /^(\s*)\d+\.\s+/ : /^(\s*)(?:[-*+]|\d+\.)\s+/;
      const allHave = lines.every((line) => line.trim() === '' || matcher.test(line));
      return lines.map((line, index) => {
        if (line.trim() === '') return line;
        if (allHave) return line.replace(matcher, '$1');
        const indent = (line.match(/^\s*/) || [''])[0];
        const body = line.slice(indent.length).replace(matcher, '');
        return `${indent}${ordered ? `${index + 1}. ` : prefix}${body}`;
      });
    });
  }

  function toggleQuote(text, start, end) {
    return mapLines(text, start, end, (lines) => {
      const allQuoted = lines.every((line) => line.trim() === '' || /^\s*>\s?/.test(line));
      return lines.map((line) => {
        if (line.trim() === '') return line;
        if (allQuoted) return line.replace(/^(\s*)>\s?/, '$1');
        return line.replace(/^(\s*)/, '$1> ');
      });
    });
  }

  function toggleHeading(text, start, end, level) {
    const hashes = '#'.repeat(clamp(level, 1, 6));
    return mapLines(text, start, end, (lines) => lines.map((line) => {
      const stripped = line.replace(/^(\s*)#{1,6}\s+/, '$1');
      if (line.trim() === '') return line;
      const already = new RegExp(`^\\s*${hashes}\\s`).test(line);
      if (already) return stripped;
      return stripped.replace(/^(\s*)/, `$1${hashes} `);
    }));
  }

  /** 用标记包裹选区；标记在选区外侧或内侧时都取消包裹 */
  function toggleWrap(text, start, end, marker) {
    const length = marker.length;
    const selected = text.slice(start, end);
    const before = text.slice(0, start);
    const after = text.slice(end);

    if (
      selected.length >= length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      const inner = selected.slice(length, selected.length - length);
      return { text: before + inner + after, selectionStart: start, selectionEnd: start + inner.length };
    }

    if (
      selected.length > 0 &&
      before.endsWith(marker) &&
      after.startsWith(marker)
    ) {
      return {
        text: before.slice(0, before.length - length) + selected + after.slice(length),
        selectionStart: start - length,
        selectionEnd: start - length + selected.length,
      };
    }

    if (selected.length === 0) {
      return { text: `${before}${marker}${marker}${after}`, selectionStart: start + length, selectionEnd: start + length };
    }
    return {
      text: `${before}${marker}${selected}${marker}${after}`,
      selectionStart: start + length,
      selectionEnd: start + length + selected.length,
    };
  }

  function toggleCodeFence(text, start, end, language = '') {
    return mapLines(text, start, end, (lines) => {
      const fence = lines.findIndex((line) => /^\s*```/.test(line));
      if (fence !== -1) {
        const closing = lines.findIndex((line, index) => index > fence && /^\s*```/.test(line));
        if (closing !== -1) return [...lines.slice(0, fence), ...lines.slice(fence + 1, closing), ...lines.slice(closing + 1)];
        return [...lines.slice(0, fence), ...lines.slice(fence + 1)];
      }
      return [`\`\`\`${language}`.trimEnd(), ...lines, '```'];
    });
  }

  function insertLink(text, start, end, url) {
    const selected = text.slice(start, end) || '链接文字';
    const snippet = `[${selected}](${url || 'https://'})`;
    return {
      text: text.slice(0, start) + snippet + text.slice(end),
      selectionStart: start + 1,
      selectionEnd: start + 1 + selected.length,
    };
  }

  function insertBlock(text, start, end, snippet) {
    const before = text.slice(0, end);
    const after = text.slice(end);
    const needsLeadingBreak = before.length > 0 && !before.endsWith('\n\n');
    const leading = before.length === 0 ? '' : needsLeadingBreak ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const trailing = after.startsWith('\n') || after.length === 0 ? '\n' : '\n\n';
    const inserted = `${leading}${snippet}${trailing}`;
    return {
      text: before + inserted + after,
      selectionStart: end + inserted.length,
      selectionEnd: end + inserted.length,
    };
  }

  /** 选区覆盖的整行范围 */
  function lineRange(text, start, end) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;
    return { lineStart, lineEnd };
  }

  /** Tab 缩进 / Shift+Tab 反缩进（多行时整体处理，块内换行不会被吞掉） */
  function indent(text, start, end, outdent = false) {
    const unit = '  ';
    if (start === end && !outdent) {
      // 无选区：在行首缩进并把光标移到缩进之后（与编辑器一致，而不是插在光标处）
      const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const next = `${text.slice(0, lineStart)}${unit}${text.slice(lineStart)}`;
      return { text: next, selectionStart: start + unit.length, selectionEnd: start + unit.length };
    }
    const { lineStart, lineEnd } = lineRange(text, start, end);
    const block = text.slice(lineStart, lineEnd);
    const next = block
      .split('\n')
      .map((line) => {
        if (outdent) return line.replace(new RegExp(`^(\\s{1,${unit.length}}|\\t)`), '');
        return line.trim() === '' ? line : `${unit}${line}`;
      })
      .join('\n');
    return {
      text: text.slice(0, lineStart) + next + text.slice(lineEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart + next.length,
    };
  }

  function insertTable(text, start, end, rows = 3, columns = 3) {
    const header = `| ${Array.from({ length: columns }, (item, index) => `列${index + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: Math.max(0, rows - 2) }, () => `| ${Array.from({ length: columns }, () => '  ').join(' | ')} |`);
    return insertBlock(text, start, end, [header, divider, ...body].join('\n'));
  }

  /** 在当前行插入 `{% asset_img %}`，并继承正文里已用过的宽度写法 */
  function insertAssetImage(text, cursor, name, alt = '', width = '') {
    const bare = String(name ?? '').replace(/["'%\s]/g, '');
    const description = String(alt ?? '').replace(/["%]/g, '').trim();
    const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    let lineEnd = text.indexOf('\n', cursor);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    const inherited = width
      || (line.match(/\{%\s*asset_img\s+[^\s%]+\s+"[^"]*"\s+"([^"]*)"\s*%\}/) || [])[1]
      || '';
    const tag = `{% asset_img ${bare}${description ? ` "${description}"` : ''}${inherited ? ` "${inherited}"` : ''} %}`;
    // 光标所在行已有配图时另起一行，避免多张图挤在一起
    if (/\{%\s*asset_img/.test(line)) return insertBlock(text, cursor, cursor, tag);
    const nextLine = line.trim() === '' ? tag : `${line} ${tag}`;
    return {
      text: text.slice(0, lineStart) + nextLine + text.slice(lineEnd),
      selectionStart: lineStart + nextLine.length,
      selectionEnd: lineStart + nextLine.length,
    };
  }

  const ASSET_TAG = /\{%\s*asset_img\s+([^\s%]+)((?:\s+"[^"]*")*)\s*%\}/;

  /** 拆解 asset_img 标签：文件名 + 已给出的引号参数 */
  function parseAssetTag(line) {
    const match = line.match(ASSET_TAG);
    if (!match) return null;
    const quoted = match[2].match(/"[^"]*"/g) || [];
    return {
      index: match.index,
      text: match[0],
      name: match[1],
      quotes: quoted,
      alt: quoted[0] ? quoted[0].slice(1, -1) : '',
      width: quoted[1] ? quoted[1].slice(1, -1) : '',
    };
  }

  /** 给光标所在行的 asset_img 设置/清除宽度（Hexo 的第二个引号参数） */
  function setAssetImageWidth(text, cursor, width) {
    const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    let lineEnd = text.indexOf('\n', cursor);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    const tag = parseAssetTag(line);
    if (!tag) return null;
    const cleaned = String(width ?? '').replace(/["%]/g, '').trim();
    const parts = [`{% asset_img ${tag.name}`];
    if (tag.alt) parts.push(`"${tag.alt}"`);
    if (cleaned) parts.push(`"${cleaned}"`);
    parts.push('%}');
    const rebuilt = parts.join(' ');
    const next = line.slice(0, tag.index) + rebuilt + line.slice(tag.index + tag.text.length);
    return {
      text: text.slice(0, lineStart) + next + text.slice(lineEnd),
      selectionStart: lineStart + next.length,
      selectionEnd: lineStart + next.length,
    };
  }

  function applyTransform(text, selectionStart, selectionEnd, action, payload = {}) {
    const start = clamp(selectionStart, 0, text.length);
    const end = clamp(Math.max(selectionStart, selectionEnd), 0, text.length);
    switch (action) {
      case 'bold': return toggleWrap(text, start, end, '**');
      case 'italic': return toggleWrap(text, start, end, '*');
      case 'strike': return toggleWrap(text, start, end, '~~');
      case 'code': return toggleWrap(text, start, end, '`');
      case 'heading': return toggleHeading(text, start, end, payload.level || 2);
      case 'bullet': return togglePrefix(text, start, end, '- ');
      case 'ordered': return togglePrefix(text, start, end, '1. ', { ordered: true });
      case 'quote': return toggleQuote(text, start, end);
      case 'fence': return toggleCodeFence(text, start, end, payload.language || '');
      case 'link': return insertLink(text, start, end, payload.url);
      case 'assetImg': return insertAssetImage(text, end, payload.name, payload.alt, payload.width);
      case 'imageWidth': return setAssetImageWidth(text, end, payload.width) || { text, selectionStart: start, selectionEnd: end };
      case 'block': return insertBlock(text, start, end, payload.snippet || '');
      case 'table': return insertTable(text, start, end, payload.rows, payload.columns);
      case 'indent': return indent(text, start, end, false);
      case 'outdent': return indent(text, start, end, true);
      default: return { text, selectionStart: start, selectionEnd: end };
    }
  }

  return { applyTransform, toggleWrap, togglePrefix, toggleQuote, toggleHeading, toggleCodeFence, insertLink, insertBlock, insertTable, insertAssetImage, setAssetImageWidth, parseAssetTag, indent, mapLines };
}));
