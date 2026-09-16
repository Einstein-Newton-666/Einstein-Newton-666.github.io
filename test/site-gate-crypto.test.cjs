const test = require('node:test');
const assert = require('node:assert/strict');

const gateCrypto = require('../scripts/lib/gate-crypto.js');
const browserGate = require('../source/js/site-gate.js');

/* 测试用低迭代次数：生产是 600000，这里只要保证两边参数一致、往返能对上。 */
const ITERATIONS = 120000;
const PASSWORD = 'correct horse battery staple';
const SALT = Buffer.from('0123456789abcdef', 'utf8');

test('Node 加密的负载能被浏览器模块解开（两边参数不许漂移）', async () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload(
    JSON.stringify({ v: 1, bodyHtml: '<p>正文里有中文与 emoji 🛩</p>' }),
    key,
    SALT,
    ITERATIONS,
  );

  const parsed = browserGate.parsePayload(gateCrypto.serializePayload(payload));
  const browserKey = await browserGate.deriveKey(PASSWORD, parsed);
  const content = await browserGate.decryptPayload(parsed, browserKey);

  assert.equal(content.bodyHtml, '<p>正文里有中文与 emoji 🛩</p>');
});

test('缓存的钥匙（导出再导入）仍然能解密', async () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload(JSON.stringify({ v: 1, bodyHtml: 'ok' }), key, SALT, ITERATIONS);
  const parsed = browserGate.parsePayload(gateCrypto.serializePayload(payload));

  const browserKey = await browserGate.deriveKey(PASSWORD, parsed);
  const exported = await browserGate.exportKey(browserKey);
  const restored = await browserGate.importKey(exported);
  const content = await browserGate.decryptPayload(parsed, restored);

  assert.equal(content.bodyHtml, 'ok');
});

test('密码不对时解密失败', async () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload(JSON.stringify({ v: 1, bodyHtml: 'secret' }), key, SALT, ITERATIONS);
  const parsed = browserGate.parsePayload(gateCrypto.serializePayload(payload));

  const wrongKey = await browserGate.deriveKey('wrong password', parsed);
  await assert.rejects(() => browserGate.decryptPayload(parsed, wrongKey));
});

test('密文被改动一个字节就解不开（GCM 认证）', async () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload(JSON.stringify({ v: 1, bodyHtml: 'secret' }), key, SALT, ITERATIONS);
  const tampered = Object.assign({}, payload, {
    ct: Buffer.from(gateCrypto.fromBase64(payload.ct)).reverse().toString('base64'),
  });

  const parsed = browserGate.parsePayload(gateCrypto.serializePayload(tampered));
  const browserKey = await browserGate.deriveKey(PASSWORD, parsed);
  await assert.rejects(() => browserGate.decryptPayload(parsed, browserKey));
});

test('负载序列化会转义 <，避免提前闭合 script 标签', () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload(
    JSON.stringify({ v: 1, bodyHtml: '<script>alert(1)</script>' }),
    key,
    SALT,
    ITERATIONS,
  );

  const serialized = gateCrypto.serializePayload(payload);
  assert.ok(!serialized.includes('<'), '序列化结果里不应出现裸 <');
  assert.equal(JSON.parse(serialized).v, 1);
});

test('负载校验会拒绝版本不符、salt 长度不对、迭代次数过低', () => {
  const good = { v: 1, kdf: { algo: 'PBKDF2-SHA256', iter: ITERATIONS, salt: SALT.toString('base64') }, cipher: 'AES-256-GCM', iv: Buffer.alloc(12).toString('base64'), ct: 'AAAA' };

  assert.throws(() => gateCrypto.parsePayload(JSON.stringify(Object.assign({}, good, { v: 2 }))), /版本/);
  assert.throws(() => gateCrypto.parsePayload(JSON.stringify(Object.assign({}, good, { kdf: Object.assign({}, good.kdf, { salt: 'AAAA' }) }))), /salt/);
  assert.throws(() => gateCrypto.parsePayload(JSON.stringify(Object.assign({}, good, { kdf: Object.assign({}, good.kdf, { iter: 1000 }) }))), /迭代/);
  assert.throws(() => gateCrypto.parsePayload('{不是 json'), /JSON/);
});

test('Node 侧自解自答（构建校验用得到）', () => {
  const key = gateCrypto.deriveKey(PASSWORD, SALT, ITERATIONS);
  const payload = gateCrypto.buildPayload('hello 世界', key, SALT, ITERATIONS);
  assert.equal(gateCrypto.decryptText(payload, key), 'hello 世界');
});
