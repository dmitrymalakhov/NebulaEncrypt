const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const origin = "https://web.telegram.org/";
const password = "random-example-key-32-characters-123";
const bytes = (value) => new TextEncoder().encode(value);
const base64 = (value) => Buffer.from(value).toString("base64");

function loadScript(file, extra = {}) {
  const context = vm.createContext({
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
    ...extra,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  return context;
}

async function legacyMessage(salt, iterations) {
  const material = await webcrypto.subtle.importKey("raw", bytes(password), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes("старое сообщение"));
  return `NebulaEncrypt:<${base64(iv)}:${base64(encrypted)}>`;
}

test("v3 round trip uses fresh salt and rejects wrong site, password, and tampering", async () => {
  const api = loadScript("message-crypto.js").NebulaMessageCrypto;
  const first = await api.encryptText("Привет 👋", password, origin);
  const second = await api.encryptText("Привет 👋", password, origin);
  assert.match(first, /^NebulaEncrypt:v3:/);
  assert.notEqual(first, second);
  assert.equal(await api.decryptText(first, password, origin), "Привет 👋");
  assert.equal(await api.decryptText(first, "wrong", origin), null);
  assert.equal(await api.decryptText(first, password, "https://web.max.ru/"), null);
  const fields = first.split(":");
  for (const field of [2, 3, 4]) {
    const tampered = [...fields];
    const current = tampered[field];
    tampered[field] = (current[0] === "A" ? "B" : "A") + current.slice(1);
    assert.equal(await api.decryptText(tampered.join(":"), password, origin), null);
  }
});

test("malformed messages are rejected before key derivation", () => {
  const api = loadScript("message-crypto.js").NebulaMessageCrypto;
  for (const value of [
    "NebulaEncrypt:v4:abc",
    "NebulaEncrypt:v3:broken",
    "NebulaEncrypt:<x:y>",
    "NebulaEncrypt:" + "A".repeat(24000),
    "NebulaEncrypt:v3:AAAA:AAAA:AAAA",
  ]) {
    assert.equal(api.parsePayload(value), null);
  }
});

test("all three historical KDF variants remain readable", async () => {
  const api = loadScript("message-crypto.js").NebulaMessageCrypto;
  for (const [salt, iterations] of [
    [`NebulaEncrypt-v1-${origin}`, 210000],
    [`NebulaEncrypt-v1-${origin}`, 100000],
    ["a-unique-salt", 100000],
  ]) {
    assert.equal(await api.decryptText(await legacyMessage(salt, iterations), password, origin), "старое сообщение");
  }
});

test("backup v2 round trip and old v1 backup import", async () => {
  const popup = loadScript("popup.js", { document: { addEventListener() {} } });
  const passphrase = "long-random-backup-passphrase-123";
  const keys = { [origin]: { myKey: password, peerKey: "another-random-example-key-32-123" } };
  const backup = await popup.encryptBackup(keys, passphrase);
  assert.equal(backup.type, "NebulaEncrypt.encryptedBackup.v2");
  assert.equal(backup.kdf.iterations, 600000);
  assert.deepEqual(JSON.parse(JSON.stringify((await popup.decryptBackup(backup, passphrase)).urlKeys)), keys);
  await assert.rejects(popup.decryptBackup(backup, "wrong"));

  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await popup.deriveBackupKey(passphrase, salt, 210000);
  const data = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes(JSON.stringify({ urlKeys: keys })));
  const oldBackup = {
    type: "NebulaEncrypt.encryptedBackup.v1",
    kdf: { name: "PBKDF2-HMAC-SHA-256", iterations: 210000, salt: base64(salt) },
    cipher: { name: "AES-GCM", iv: base64(iv) },
    data: base64(data),
  };
  assert.deepEqual(JSON.parse(JSON.stringify((await popup.decryptBackup(oldBackup, passphrase)).urlKeys)), keys);
});

test("failed decryption never writes a password verifier into the page DOM", async () => {
  let attempts = 0;
  const context = vm.createContext({
    window: { location: { href: origin } },
    document: { readyState: "loading", addEventListener() {} },
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} } },
    },
    NebulaMessageCrypto: {
      async decryptText() { attempts++; return null; },
      clearKeyCache() {},
    },
    setInterval() {},
    URL,
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8")
    .replace(/\}\)\(\);\s*$/, "globalThis.testDecryptNode = decryptMessageNode;})();");
  vm.runInContext(source, context);
  const attributes = new Map();
  const message = {
    textContent: "NebulaEncrypt:v3:example",
    getAttribute(key) { return attributes.get(key) || null; },
    setAttribute(key, value) { attributes.set(key, value); },
    removeAttribute(key) { attributes.delete(key); },
  };

  assert.equal(await context.testDecryptNode(message, password, "peer"), false);
  assert.equal(await context.testDecryptNode(message, password, "peer"), false);
  assert.equal(attempts, 1);
  assert.equal(attributes.has("data-nebula-decrypt-failed"), false);
  assert.equal([...attributes.values()].some((value) => value.includes(password)), false);

  message.textContent = "NebulaEncrypt:v3:another-message";
  assert.equal(await context.testDecryptNode(message, password, "peer"), false);
  assert.equal(attempts, 2);
});
