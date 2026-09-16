'use strict';

/* ---------------------------------------------------------------------------
 * 访问密码的加解密约定（构建侧，Node）。
 *
 * 常量集中写在这里：浏览器端 source/js/site-gate.js 必须用完全相同的 KDF
 * 参数与密文布局才解得开，两边一旦漂移就是“线上永远解不开”。所以由
 * test/site-gate-crypto.test.cjs 跑一遍“Node 加密 → 浏览器模块用 WebCrypto
 * 解密”的往返来兜底，改这里就会立刻红灯。
 *
 * salt 固定存放在 scripts/lib/gate-salt.js 并随仓库提交：salt 不需要保密，
 * 固定下来才能让访客“记住 30 天”的解锁状态在每次重新部署后继续有效。
 * 要作废所有浏览器里已保存的钥匙，换密码或换 salt 都可以。
 * ------------------------------------------------------------------------- */

const crypto = require('node:crypto');

const SALT_BASE64 = require('./gate-salt');

const PAYLOAD_VERSION = 1;
const KDF_ALGORITHM = 'PBKDF2-SHA256';
const CIPHER = 'AES-256-GCM';
const KDF_ITERATIONS = 600000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function fromBase64(text, expectedBytes, label) {
  const buffer = Buffer.from(String(text), 'base64');
  if (expectedBytes && buffer.length !== expectedBytes) {
    throw new Error(`${label} 长度不对：期望 ${expectedBytes} 字节，实际 ${buffer.length} 字节`);
  }
  return buffer;
}

function readSalt() {
  return fromBase64(SALT_BASE64, SALT_BYTES, 'salt');
}

function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  if (!password) throw new Error('缺少访问密码');
  if (!Buffer.isBuffer(salt)) throw new Error('salt 必须是 Buffer');
  return crypto.pbkdf2Sync(String(password), salt, iterations, KEY_BYTES, 'sha256');
}

function encryptText(plainText, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const cipherText = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  // WebCrypto 的 AES-GCM 约定把认证标签附在密文尾部，这里按同一布局拼接。
  return { iv: toBase64(iv), ct: toBase64(Buffer.concat([cipherText, cipher.getAuthTag()])) };
}

function decryptText(payload, key) {
  const { iv, ct } = payload;
  const ivBuffer = fromBase64(iv, IV_BYTES, 'iv');
  const data = fromBase64(ct, 0, 'ct');
  if (data.length <= 16) throw new Error('密文长度不足');
  const authTag = data.subarray(data.length - 16);
  const cipherText = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
}

function buildPayload(plainText, key, salt, iterations = KDF_ITERATIONS) {
  const { iv, ct } = encryptText(plainText, key);
  return {
    v: PAYLOAD_VERSION,
    kdf: { algo: KDF_ALGORITHM, iter: iterations, salt: toBase64(salt) },
    cipher: CIPHER,
    iv,
    ct,
  };
}

/**
 * 序列化成塞进 <script type="application/json"> 的文本。
 * `<` 必须转义：json 里可能带 HTML 片段，直接出现 `</script>` 会提前闭合标签。
 */
function serializePayload(payload) {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function parsePayload(text) {
  let payload;
  try {
    payload = JSON.parse(String(text));
  } catch (error) {
    throw new Error(`负载不是合法 JSON：${error.message}`);
  }
  if (!payload || payload.v !== PAYLOAD_VERSION) {
    throw new Error(`负载版本不支持：${payload && payload.v}`);
  }
  if (!payload.kdf || payload.kdf.algo !== KDF_ALGORITHM) {
    throw new Error(`KDF 不支持：${payload.kdf && payload.kdf.algo}`);
  }
  if (!Number.isInteger(payload.kdf.iter) || payload.kdf.iter < 100000) {
    throw new Error('KDF 迭代次数不合理');
  }
  if (payload.cipher !== CIPHER) throw new Error(`加密算法不支持：${payload.cipher}`);
  fromBase64(payload.kdf.salt, SALT_BYTES, 'salt');
  fromBase64(payload.iv, IV_BYTES, 'iv');
  if (!payload.ct) throw new Error('负载缺少密文');
  return payload;
}

module.exports = {
  PAYLOAD_VERSION,
  KDF_ALGORITHM,
  CIPHER,
  KDF_ITERATIONS,
  KEY_BYTES,
  SALT_BYTES,
  IV_BYTES,
  SALT_BASE64,
  toBase64,
  fromBase64,
  readSalt,
  deriveKey,
  encryptText,
  decryptText,
  buildPayload,
  serializePayload,
  parsePayload,
};
