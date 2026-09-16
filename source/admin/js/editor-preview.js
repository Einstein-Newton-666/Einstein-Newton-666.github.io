(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditorPreview = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function () {
  /* ------------------------------------------------------------------
   * 预览：优先请求本机精确预览服务（真实 hexo.post.render 管线），
   * 服务不可用时退回前端轻量渲染，并明确告知差异。
   * ------------------------------------------------------------------ */

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:4001';
  const STORAGE_KEY = 'einblog.admin.preview-endpoint.v1';

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 轻量渲染：只覆盖常用语法，明确不作为「与线上一致」的保证 */
  function renderFallback(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inCode = false;
    let codeLanguage = '';
    let codeLines = [];
    let listType = null;

    const flushCode = () => {
      if (!inCode) return;
      out.push(`<pre class="preview-code"><code data-language="${escapeHtml(codeLanguage)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      inCode = false;
      codeLanguage = '';
      codeLines = [];
    };
    const closeList = () => {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    };
    const inline = (text) => escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    for (const line of lines) {
      const fence = line.match(/^\s*```\s*(\S*)\s*$/);
      if (fence) {
        if (inCode) flushCode();
        else {
          closeList();
          inCode = true;
          codeLanguage = fence[1] || '';
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (/^\s*$/.test(line)) {
        closeList();
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (bullet || ordered) {
        const type = bullet ? 'ul' : 'ol';
        if (listType !== type) {
          closeList();
          out.push(`<${type}>`);
          listType = type;
        }
        out.push(`<li>${inline((bullet || ordered)[1])}</li>`);
        continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        closeList();
        out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
        continue;
      }
      const asset = line.match(/^\s*\{%\s*asset_img\s+(\S+)(?:\s+"([^"]*)")?\s*%\}\s*$/);
      if (asset) {
        closeList();
        out.push(`<p class="preview-asset">［配图：${escapeHtml(asset[1])}${asset[2] ? `（${escapeHtml(asset[2])}）` : ''}］</p>`);
        continue;
      }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    flushCode();
    closeList();
    return out.join('\n');
  }

  /** 把渲染结果里的图片 src 换成可访问地址：
   *  · 本地新增（未提交）的图片 → blob URL
   *  · 已提交/仓库里已有的配图 → 本机预览服务的资源接口 */
  function rewriteAssetSources(html, sources = {}, assetBase = '') {
    let output = String(html ?? '');
    const map = sources || {};
    for (const [name, url] of Object.entries(map)) {
      if (!url) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      output = output.replace(new RegExp(`(src=["'])[^"']*${escaped}(["'])`, 'gi'), `$1${url}$2`);
    }
    if (assetBase) {
      output = output.replace(/src=["']([^"']+)["']/gi, (match, source) => {
        if (/^(?:https?:|data:|blob:)/i.test(source)) return match;
        const name = source.split('/').pop();
        return `src="${assetBase.replace(/\/+$/, '')}/${encodeURIComponent(name)}"`;
      });
    }
    return output;
  }

  function createController(options = {}) {
    let endpoint = options.endpoint || DEFAULT_ENDPOINT;
    let mode = 'exact';
    try {
      const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (saved) {
        endpoint = saved;
        mode = 'exact';
      }
    } catch (error) {
      /* 隐私模式下忽略 */
    }

    function setEndpoint(value) {
      endpoint = String(value || DEFAULT_ENDPOINT).replace(/\/+$/, '');
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, endpoint);
      } catch (error) {
        /* 忽略 */
      }
    }

    async function checkExact() {
      try {
        const response = await fetch(`${endpoint}/api/health`, { cache: 'no-store' });
        if (!response.ok) return { ok: false, error: `本机预览服务返回 ${response.status}` };
        const data = await response.json();
        return { ok: data?.ok === true, service: data?.service || '', endpoint };
      } catch (error) {
        return { ok: false, error: '未检测到本机预览服务' };
      }
    }

    async function renderExact(payload) {
      const response = await fetch(`${endpoint}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || '预览渲染失败');
      return { html: data.html, warnings: data.warnings || [], ms: data.ms, mode: 'exact' };
    }

    async function render(payload) {
      const assetBase = payload.assetBase || `${endpoint}/api/assets?path=${encodeURIComponent(`_posts/${payload.slug}/`)}`;
      if (mode === 'exact') {
        try {
          const result = await renderExact(payload);
          return Object.assign(result, {
            stale: false,
            html: rewriteAssetSources(result.html, payload.sources, assetBase),
          });
        } catch (error) {
          mode = 'fallback';
          return {
            html: rewriteAssetSources(renderFallback(payload.markdown), payload.sources, ''),
            warnings: [],
            mode: 'fallback',
            error: error.message,
          };
        }
      }
      return {
        html: rewriteAssetSources(renderFallback(payload.markdown), payload.sources, ''),
        warnings: [],
        mode: 'fallback',
      };
    }

    return {
      render,
      checkExact,
      setEndpoint,
      getEndpoint: () => endpoint,
      getMode: () => mode,
      setMode: (value) => { mode = value === 'fallback' ? 'fallback' : 'exact'; },
    };
  }

  return { createController, renderFallback, rewriteAssetSources, escapeHtml, DEFAULT_ENDPOINT, STORAGE_KEY };
}));
