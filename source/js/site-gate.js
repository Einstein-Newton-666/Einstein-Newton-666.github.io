(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EinblogGate = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  /* ------------------------------------------------------------------
   * 访问密码的浏览器端：把 scripts/gate-build.js 加密过的 <body> 解回来。
   *
   * 与 scripts/lib/gate-crypto.js 共用同一套参数（PBKDF2-SHA256 + AES-256-GCM，
   * 认证标签附在密文尾部）。纯函数部分不碰 DOM，可以在 node --test 里直接
   * require 进来跑“Node 加密 → 这里解密”的往返；只有 boot() 需要浏览器。
   *
   * 缓存的是派生出来的钥匙（不是密码）：勾选“记住 30 天”写 localStorage，
   * 否则写 sessionStorage。钥匙随 salt/密码变化而失效，所以重新部署不会把
   * 已解锁的访客踢出去，换密码则一定会。
   * ------------------------------------------------------------------ */

  const PAYLOAD_ID = 'einblog-gate-payload';
  const SESSION_STORE_KEY = 'einblog.gate.key.v1';
  const PERSIST_STORE_KEY = 'einblog.gate.key.v1.persist';
  const PERSIST_DAYS = 30;
  const KDF_ALGORITHM = 'PBKDF2-SHA256';
  const CIPHER = 'AES-256-GCM';
  const KEY_BYTES = 32;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function base64ToBytes(text) {
    const binary = atob(String(text).replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const view = new Uint8Array(bytes);
    for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
    return btoa(binary);
  }

  function parsePayload(text) {
    const payload = JSON.parse(String(text));
    if (!payload || payload.v !== 1) throw new Error('负载版本不支持');
    if (!payload.kdf || payload.kdf.algo !== KDF_ALGORITHM) throw new Error('KDF 不支持');
    if (!Number.isInteger(payload.kdf.iter) || payload.kdf.iter < 100000) throw new Error('KDF 迭代次数不合理');
    if (payload.cipher !== CIPHER) throw new Error('加密算法不支持');
    if (base64ToBytes(payload.kdf.salt).length !== SALT_BYTES) throw new Error('salt 长度不对');
    if (base64ToBytes(payload.iv).length !== IV_BYTES) throw new Error('iv 长度不对');
    if (!payload.ct) throw new Error('负载缺少密文');
    return payload;
  }

  function requireSubtle() {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new Error('当前浏览器不支持 WebCrypto，请改用现代浏览器并通过 HTTPS 或 localhost 访问');
    return subtle;
  }

  async function deriveKey(password, payload) {
    if (!password) throw new Error('请输入访问密码');
    const subtle = requireSubtle();
    const material = await subtle.importKey('raw', textEncoder.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({
      name: 'PBKDF2',
      salt: base64ToBytes(payload.kdf.salt),
      iterations: payload.kdf.iter,
      hash: 'SHA-256',
    }, material, { name: 'AES-GCM', length: KEY_BYTES * 8 }, true, ['decrypt']);
  }

  async function importKey(base64Key) {
    const subtle = requireSubtle();
    const raw = base64ToBytes(base64Key);
    if (raw.length !== KEY_BYTES) throw new Error('缓存的钥匙长度不对');
    return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['decrypt']);
  }

  async function exportKey(key) {
    return bytesToBase64(await requireSubtle().exportKey('raw', key));
  }

  /** 密码错、负载被改动、缓存钥匙过期都会在这里抛（GCM 认证失败）。 */
  async function decryptPayload(payload, key) {
    const plain = await requireSubtle().decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ct),
    );
    const parsed = JSON.parse(textDecoder.decode(plain));
    if (!parsed || typeof parsed.bodyHtml !== 'string') throw new Error('负载内容不完整');
    return parsed;
  }

  function readPayload(doc) {
    const node = doc.getElementById(PAYLOAD_ID);
    if (!node) return null;
    return parsePayload(node.textContent);
  }

  /** 动态插入的 <script> 默认 async，会打乱主题脚本的执行顺序，这里强制按序。 */
  function replayScripts(container, doc) {
    const scripts = Array.prototype.slice.call(container.querySelectorAll('script'));
    scripts.forEach((old) => {
      const fresh = doc.createElement('script');
      Array.prototype.forEach.call(old.attributes, (attr) => fresh.setAttribute(attr.name, attr.value));
      if (old.src) {
        fresh.async = false;
        fresh.defer = false;
        fresh.src = old.src;
      } else {
        fresh.textContent = old.textContent;
      }
      old.replaceWith(fresh);
    });
  }

  function storageGet(store, key) {
    try {
      return store.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(store, key, value) {
    try {
      store.setItem(key, value);
    } catch (error) {
      /* 隐私模式下写不进去就算了，本次会话仍然可用 */
    }
  }

  function storageRemove(store, key) {
    try {
      store.removeItem(key);
    } catch (error) {
      /* 同上 */
    }
  }

  function readCachedKey() {
    const stored = storageGet(root.localStorage, PERSIST_STORE_KEY);
    if (stored) {
      try {
        const record = JSON.parse(stored);
        if (record && record.exp > Date.now() && record.key) return record.key;
      } catch (error) {
        /* 坏数据按没有处理 */
      }
      storageRemove(root.localStorage, PERSIST_STORE_KEY);
    }
    return storageGet(root.sessionStorage, SESSION_STORE_KEY);
  }

  function rememberKey(base64Key, persist) {
    if (persist) {
      storageSet(root.localStorage, PERSIST_STORE_KEY, JSON.stringify({
        key: base64Key,
        exp: Date.now() + PERSIST_DAYS * 24 * 60 * 60 * 1000,
      }));
      storageRemove(root.sessionStorage, SESSION_STORE_KEY);
      return;
    }
    storageSet(root.sessionStorage, SESSION_STORE_KEY, base64Key);
  }

  function forgetKey() {
    storageRemove(root.localStorage, PERSIST_STORE_KEY);
    storageRemove(root.sessionStorage, SESSION_STORE_KEY);
  }

  function lockSite() {
    forgetKey();
    root.location.reload();
  }

  function buildLockButton(doc) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.id = 'einblog-lock';
    button.className = 'einblog-lock';
    button.title = '锁定本站';
    button.setAttribute('aria-label', '锁定本站');
    button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">'
      + '<path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 8H9V7a3 3 0 1 1 6 0v3Z"/></svg>';
    button.addEventListener('click', lockSite);
    return button;
  }

  async function reveal(payload, key, doc) {
    const content = await decryptPayload(payload, key);
    doc.body.innerHTML = content.bodyHtml;
    replayScripts(doc.body, doc);
    const lockButton = buildLockButton(doc);
    doc.body.appendChild(lockButton);
  }

  function boot() {
    if (typeof document === 'undefined') return;
    const doc = document;
    const payloadNode = doc.getElementById(PAYLOAD_ID);
    if (!payloadNode) return;

    const panel = doc.getElementById('einblog-gate');
    const form = doc.getElementById('einblog-gate-form');
    const input = doc.getElementById('einblog-gate-input');
    const submit = doc.getElementById('einblog-gate-submit');
    const remember = doc.getElementById('einblog-gate-remember');
    const errorBox = doc.getElementById('einblog-gate-error');

    function setError(message) {
      if (errorBox) errorBox.textContent = message || '';
    }

    function setBusy(busy) {
      if (submit) submit.disabled = busy;
      if (input) input.disabled = busy;
      if (submit) submit.textContent = busy ? '解锁中…' : '解锁';
    }

    let payload;
    try {
      payload = parsePayload(payloadNode.textContent);
    } catch (error) {
      setError('页面负载损坏，无法解锁');
      return;
    }

    async function tryKey(keyBase64) {
      try {
        await reveal(payload, await importKey(keyBase64), doc);
        return true;
      } catch (error) {
        forgetKey();
        return false;
      }
    }

    async function onSubmit(event) {
      event.preventDefault();
      const password = input ? input.value : '';
      if (!password) {
        setError('请输入访问密码');
        return;
      }
      setError('');
      setBusy(true);
      try {
        const key = await deriveKey(password, payload);
        const persist = !!(remember && remember.checked);
        await reveal(payload, key, doc);
        rememberKey(await exportKey(key), persist);
      } catch (error) {
        setError(error && /WebCrypto/.test(error.message) ? error.message : '密码不对，再试一次');
        setBusy(false);
        if (input) {
          input.value = '';
          input.focus();
        }
      }
    }

    if (panel) panel.hidden = false;
    if (form) form.addEventListener('submit', onSubmit);
    if (input) input.focus();

    const cached = readCachedKey();
    if (cached) {
      tryKey(cached).then((unlocked) => {
        if (!unlocked && input) input.focus();
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return {
    PAYLOAD_ID,
    SESSION_STORE_KEY,
    PERSIST_STORE_KEY,
    PERSIST_DAYS,
    base64ToBytes,
    bytesToBase64,
    parsePayload,
    deriveKey,
    importKey,
    exportKey,
    decryptPayload,
    readPayload,
    replayScripts,
    readCachedKey,
    rememberKey,
    forgetKey,
    boot,
  };
}));
