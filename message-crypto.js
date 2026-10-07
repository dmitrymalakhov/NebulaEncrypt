// Message format and cryptography are kept separate from chat DOM handling.
// This script runs in the extension's isolated content-script world.
(() => {
  if (globalThis.NebulaMessageCrypto) return;

  const PREFIX = "NebulaEncrypt:";
  const V3_PREFIX = `${PREFIX}v3:`;
  const MAX_PAYLOAD_LENGTH = 24000;
  const V3_ITERATIONS = 600000;
  const LEGACY_SALT_PREFIX = "NebulaEncrypt-v1-";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const legacyKeyCache = new Map();

  function toBase64(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(parts.join(""));
  }

  function fromBase64(value) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
    try {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return toBase64(bytes) === value ? bytes : null;
    } catch {
      return null;
    }
  }

  async function deriveKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      "raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function associatedData(origin) {
    return encoder.encode(`${V3_PREFIX}${origin}`);
  }

  async function encryptText(plaintext, password, origin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, V3_ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(origin), tagLength: 128 },
      key,
      encoder.encode(plaintext)
    );
    const result = `${V3_PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
    if (result.length > MAX_PAYLOAD_LENGTH) throw new Error("Сообщение слишком длинное для шифрования.");
    return result;
  }

  function parsePayload(text) {
    const value = typeof text === "string" ? text.trim() : "";
    if (!value.startsWith(PREFIX) || value.length > MAX_PAYLOAD_LENGTH) return null;

    if (value.startsWith(V3_PREFIX)) {
      const fields = value.slice(V3_PREFIX.length).split(":");
      if (fields.length !== 3) return null;
      const [salt, iv, data] = fields.map(fromBase64);
      if (salt?.length !== 16 || iv?.length !== 12 || !data || data.length < 16) return null;
      return { version: 3, salt, iv, data };
    }

    const match = /^NebulaEncrypt:<([^:>]+):([^:>]+)>$/.exec(value);
    if (!match) return null;
    const iv = fromBase64(match[1]);
    const data = fromBase64(match[2]);
    if (iv?.length !== 12 || !data || data.length < 16) return null;
    return { version: 1, iv, data };
  }

  async function getLegacyKey(password, salt, iterations) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${iterations}:${salt}:${password}`));
    const cacheId = toBase64(new Uint8Array(digest));
    if (!legacyKeyCache.has(cacheId)) {
      if (legacyKeyCache.size >= 32) legacyKeyCache.delete(legacyKeyCache.keys().next().value);
      const pending = deriveKey(password, encoder.encode(salt), iterations);
      legacyKeyCache.set(cacheId, pending);
      pending.catch(() => legacyKeyCache.delete(cacheId));
    }
    return legacyKeyCache.get(cacheId);
  }

  async function decryptText(text, password, origin) {
    const payload = parsePayload(text);
    if (!payload) return null;

    if (payload.version === 3) {
      try {
        const key = await deriveKey(password, payload.salt, V3_ITERATIONS);
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: payload.iv, additionalData: associatedData(origin), tagLength: 128 },
          key,
          payload.data
        );
        return decoder.decode(plaintext);
      } catch {
        return null;
      }
    }

    // Historical messages did not record a version. Keep their exact KDF variants.
    const attempts = [
      { salt: LEGACY_SALT_PREFIX + origin, iterations: 210000 },
      { salt: LEGACY_SALT_PREFIX + origin, iterations: 100000 },
      { salt: "a-unique-salt", iterations: 100000 },
    ];
    for (const { salt, iterations } of attempts) {
      try {
        const key = await getLegacyKey(password, salt, iterations);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.iv }, key, payload.data);
        return decoder.decode(plaintext);
      } catch { /* Try the next historical KDF. */ }
    }
    return null;
  }

  globalThis.NebulaMessageCrypto = {
    encryptText,
    decryptText,
    parsePayload,
    clearKeyCache: () => legacyKeyCache.clear(),
  };
})();
