(() => {
const GLOBAL_STATE_KEY = "__nebulaEncryptState";
const state = window[GLOBAL_STATE_KEY] || (window[GLOBAL_STATE_KEY] = {});
if (state.initialized) {
  return;
}
state.initialized = true;

const ENCRYPTED_PREFIX = "NebulaEncrypt:";
const SALT_PREFIX = "NebulaEncrypt-v1-";
const MAX_ENCRYPTED_PAYLOAD_LENGTH = 24000;
const DECRYPTED_ATTR = "data-nebula-decrypted";
const FAILED_ATTR = "data-nebula-decrypt-failed";

/** Единый формат URL для хранения ключей (с trailing slash) */
function getUrlPattern() {
  const url = new URL(window.location.href);
  const base = `${url.protocol}//${url.host}`;
  return base.endsWith("/") ? base : base + "/";
}

async function getKeysForCurrentPage() {
  const urlPattern = getUrlPattern();
  return new Promise((resolve) => {
    chrome.storage.local.get("urlKeys", (result) => {
      const urlKeys = result.urlKeys || {};
      const keys = urlKeys[urlPattern] || null;
      if (
        keys &&
        typeof keys.myKey === "string" &&
        typeof keys.peerKey === "string" &&
        keys.myKey.length > 0 &&
        keys.peerKey.length > 0
      ) {
        resolve(keys);
        return;
      }
      resolve(null);
    });
  });
}

const SUPPORTED_SERVICES = {
  TELEGRAM_A: { host: "web.telegram.org", pathPrefix: "/a/", name: "Telegram (A)" },
  TELEGRAM_K: { host: "web.telegram.org", pathPrefix: null, name: "Telegram (K)" },
  MAX: { host: "web.max.ru", pathPrefix: null, name: "MAX" },
};

function detectService() {
  const url = new URL(window.location.href);
  const host = url.host;
  if (host === "web.telegram.org") {
    return url.pathname.startsWith("/a/") ? "TELEGRAM_A" : "TELEGRAM_K";
  }
  if (host === "web.max.ru") return "MAX";
  return null;
}

function getDomElementsForService() {
  const service = detectService();
  if (!service) return null;

  if (service === "TELEGRAM_A") {
    return {
      myMessages: document.querySelectorAll(".Message.own .text-content"),
      peerMessages: document.querySelectorAll(
        ".Message:not(.own) .text-content"
      ),
      inputField: document.getElementById("editable-message-text"),
    };
  }

  if (service === "TELEGRAM_K") {
    return {
      myMessages: document.querySelectorAll(".bubble.is-out .message"),
      peerMessages: document.querySelectorAll(".bubble.is-in .message"),
      inputField: document.querySelector(
        "div[contenteditable='true'].input-message-input"
      ),
    };
  }

  if (service === "MAX") {
    const myList = [];
    const peerList = [];
    // Сообщения: .message > [data-bubbles-variant] > .bordersWrapper--*--left/right > .bubble > span.text
    const bubbles = document.querySelectorAll(".bubble");
    for (const bubble of bubbles) {
      const textSpan = Array.from(bubble.children).find(
        (el) => el.tagName === "SPAN" && el.classList.contains("text")
      );
      if (!textSpan) continue;
      const wrapper = bubble.closest(".bordersWrapper");
      const isOut =
        bubble.closest('[data-bubbles-variant="outgoing"]') ||
        bubble.closest(".message--isOut") ||
        (wrapper && /--(?:top|middle|bottom)--right/.test(wrapper.className));
      if (isOut) myList.push(textSpan);
      else peerList.push(textSpan);
    }
    // MAX: поле ввода — div.input > ... > div.contenteditable[data-lexical-editor="true"], placeholder "Пост"
    const inputCandidates = [
      ...document.querySelectorAll('div.input div.contenteditable[data-lexical-editor="true"]'),
      ...document.querySelectorAll('.input [data-lexical-editor="true"]'),
    ];
    const unique = [...new Set(inputCandidates)];
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      return r.height >= 20 && r.width >= 50 && r.top < window.innerHeight && r.bottom > 0;
    }
    let inputField =
      unique.find((el) => isVisible(el) && (el.getAttribute("aria-placeholder") === "Пост" || el.getAttribute("placeholder") === "Пост")) ||
      unique.find((el) => isVisible(el) && el.closest(".input")) ||
      unique.find(isVisible) ||
      unique[0];
    if (!inputField) {
      inputField = document.querySelector('[data-lexical-editor="true"]') ||
        document.querySelector('.input [contenteditable]') ||
        document.querySelector('[contenteditable="true"]');
    }
    if (!inputField) {
      const lexicalSpan = document.querySelector('span[data-lexical-text="true"]');
      if (lexicalSpan) inputField = lexicalSpan.closest('[contenteditable]');
    }
    if (!inputField && document.activeElement) {
      const el = document.activeElement;
      if (el.isContentEditable) inputField = el;
      else if (el.closest?.('[contenteditable]')) inputField = el.closest('[contenteditable]');
    }
    return {
      myMessages: myList,
      peerMessages: peerList,
      inputField,
      isLexical: !!(inputField && (inputField.querySelector('span[data-lexical-text="true"]') || inputField.hasAttribute?.('data-lexical-editor'))),
    };
  }

  return null;
}

// --------------- Binary ↔ Base64 helpers ---------------
function uint8ToBase64(bytes) {
  const CHUNK = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function isLikelyBase64(value) {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// --------------- Key derivation cache ---------------
const KEY_CACHE_MAX = 32;
const _keyCache = new Map();

async function _keyCacheId(password, salt, usage, iterations) {
  const enc = new TextEncoder();
  const raw = enc.encode(`${usage}:${iterations}:${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return uint8ToBase64(new Uint8Array(digest));
}

async function getCachedKey(password, saltValue, usage, iterations = 210000) {
  const id = await _keyCacheId(password, saltValue, usage, iterations);
  if (_keyCache.has(id)) return _keyCache.get(id);

  if (_keyCache.size >= KEY_CACHE_MAX) {
    const oldest = _keyCache.keys().next().value;
    _keyCache.delete(oldest);
  }

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(saltValue),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
  _keyCache.set(id, key);
  return key;
}

async function keyFingerprint(password, role) {
  const enc = new TextEncoder();
  const raw = enc.encode(`${role}:${getUrlPattern()}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return uint8ToBase64(new Uint8Array(digest));
}

// --------------- Decrypt ---------------
function parseEncryptedPayload(text) {
  const normalized = (text || "").trim();
  if (!normalized.startsWith(ENCRYPTED_PREFIX)) return null;
  if (normalized.length > MAX_ENCRYPTED_PAYLOAD_LENGTH) return null;
  const m = normalized.match(/^NebulaEncrypt:<([^:>]+):([^>]+)>$/);
  if (!m) return null;
  if (!isLikelyBase64(m[1]) || !isLikelyBase64(m[2])) return null;
  try {
    const iv = base64ToUint8(m[1]);
    const data = base64ToUint8(m[2]);
    if (iv.length !== 12) return null;
    return { iv, data };
  } catch { return null; }
}

async function decryptText(text, password) {
  const payload = parseEncryptedPayload(text);
  if (!payload) return null;
  const { iv, data } = payload;
  const dec = new TextDecoder();

  // v2 (210k iters) → v1 (100k iters, new salt) → legacy (100k iters, old salt)
  const attempts = [
    { salt: SALT_PREFIX + getUrlPattern(), iters: 210000 },
    { salt: SALT_PREFIX + getUrlPattern(), iters: 100000 },
    { salt: "a-unique-salt", iters: 100000 },
  ];
  for (const { salt, iters } of attempts) {
    try {
      const key = await getCachedKey(password, salt, "decrypt", iters);
      const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      return dec.decode(buf);
    } catch { continue; }
  }
  return null;
}

// --------------- Encrypt ---------------
async function encryptText(text, password) {
  const enc = new TextEncoder();
  const salt = SALT_PREFIX + getUrlPattern();
  const key = await getCachedKey(password, salt, "encrypt", 210000);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(text)
  );
  return `${ENCRYPTED_PREFIX}<${uint8ToBase64(iv)}:${uint8ToBase64(new Uint8Array(ciphertext))}>`;
}

// --------------- Visual indicator CSS ---------------
function injectDecryptedStyles() {
  if (document.getElementById("nebula-encrypt-styles")) return;
  const style = document.createElement("style");
  style.id = "nebula-encrypt-styles";
  style.textContent = `
    [data-nebula-encrypted] {
      cursor: pointer;
      text-decoration-line: underline;
      text-decoration-style: dotted;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }
    [data-nebula-encrypted]:hover {
      background: rgba(15,118,110,0.08);
      border-radius: 4px;
    }
  `;
  document.head.appendChild(style);
}

// --------------- Click-to-decrypt: find message text span and variant ---------------
function getMessageTextSpanAndVariant(clickTarget) {
  const service = detectService();
  if (!service) return null;

  if (service === "MAX") {
    const bubble = clickTarget.closest(".bubble");
    if (!bubble) return null;
    const textSpan = bubble.querySelector("span.text");
    if (!textSpan) return null;
    const wrapper = bubble.closest(".bordersWrapper");
    const isMy =
      bubble.closest('[data-bubbles-variant="outgoing"]') ||
      bubble.closest(".message--isOut") ||
      (wrapper && /--(?:top|middle|bottom)--right/.test(wrapper.className));
    return { textSpan, isMy };
  }

  if (service === "TELEGRAM_A") {
    const content = clickTarget.closest(".text-content");
    if (!content) return null;
    if (!content.contains(clickTarget) && clickTarget !== content) return null;
    const message = content.closest(".Message");
    if (!message) return null;
    return { textSpan: content, isMy: message.classList.contains("own") };
  }

  if (service === "TELEGRAM_K") {
    const bubble = clickTarget.closest(".bubble");
    if (!bubble) return null;
    const msg = bubble.querySelector(".message");
    if (!msg || (!msg.contains(clickTarget) && clickTarget !== msg)) return null;
    return { textSpan: msg, isMy: bubble.classList.contains("is-out") };
  }

  return null;
}

// --------------- Mark encrypted messages in feed (for click-to-decrypt) ---------------
function markEncryptedInFeed() {
  const domElements = getDomElementsForService();
  if (!domElements) return;
  const { myMessages, peerMessages } = domElements;
  const allSpans = [...myMessages, ...peerMessages];
  for (const span of allSpans) {
    if (span.getAttribute(DECRYPTED_ATTR)) continue;
    const raw = (span.textContent || "").trim();
    if (raw.startsWith(ENCRYPTED_PREFIX)) {
      span.setAttribute("data-nebula-encrypted", "1");
      span.setAttribute(
        "title",
        span.getAttribute(FAILED_ATTR)
          ? "Не удалось расшифровать текущими ключами"
          : "Нажмите, чтобы расшифровать"
      );
    }
  }
}

// --------------- Process messages ---------------
let _decryptedCount = 0;

function getMessageRawText(msg) {
  return (msg.textContent || "").trim();
}

function applyDecryptedText(msg, decryptedText) {
  msg.textContent = decryptedText;
  msg.setAttribute(DECRYPTED_ATTR, "1");
  msg.removeAttribute(FAILED_ATTR);
  msg.removeAttribute("data-nebula-encrypted");
  msg.setAttribute("title", "Расшифровано NebulaEncrypt");
}

async function decryptMessageNode(msg, password, fingerprint, options = {}) {
  if (msg.getAttribute(DECRYPTED_ATTR)) return false;

  const raw = getMessageRawText(msg);
  if (!raw.startsWith(ENCRYPTED_PREFIX)) return false;
  if (!options.force && msg.getAttribute(FAILED_ATTR) === fingerprint) return false;

  const decryptedText = await decryptText(raw, password);
  if (decryptedText !== null) {
    applyDecryptedText(msg, decryptedText);
    return true;
  }

  msg.setAttribute(FAILED_ATTR, fingerprint);
  msg.setAttribute("data-nebula-encrypted", "1");
  msg.setAttribute("title", "Не удалось расшифровать текущими ключами");
  return false;
}

async function processMessages() {
  const keys = await getKeysForCurrentPage();
  const domElements = getDomElementsForService();
  if (!keys || !domElements) return;

  const { myKey, peerKey } = keys;
  const { myMessages, peerMessages } = domElements;
  const myFingerprint = await keyFingerprint(myKey, "my");
  const peerFingerprint = await keyFingerprint(peerKey, "peer");
  let newlyDecrypted = 0;

  for (const msg of myMessages) {
    if (await decryptMessageNode(msg, myKey, myFingerprint)) newlyDecrypted++;
  }

  for (const msg of peerMessages) {
    if (await decryptMessageNode(msg, peerKey, peerFingerprint)) newlyDecrypted++;
  }

  if (newlyDecrypted > 0) {
    _decryptedCount += newlyDecrypted;
    try {
      chrome.runtime.sendMessage({
        action: "updateBadge",
        count: _decryptedCount,
      });
    } catch {}
  }
  markEncryptedInFeed();
}

// --------------- Click-to-decrypt handler ---------------
async function handleFeedMessageClick(e) {
  const info = getMessageTextSpanAndVariant(e.target);
  if (!info) return;
  const { textSpan, isMy } = info;
  if (textSpan.getAttribute(DECRYPTED_ATTR)) return;
  const raw = getMessageRawText(textSpan);
  if (!raw.startsWith(ENCRYPTED_PREFIX)) return;

  e.preventDefault();
  e.stopPropagation();

  const keys = await getKeysForCurrentPage();
  if (!keys) return;
  const password = isMy ? keys.myKey : keys.peerKey;
  const fingerprint = await keyFingerprint(password, isMy ? "my" : "peer");
  const decrypted = await decryptMessageNode(textSpan, password, fingerprint, { force: true });
  if (!decrypted) return;

  _decryptedCount++;
  try {
    chrome.runtime.sendMessage({ action: "updateBadge", count: _decryptedCount });
  } catch {}
}

// --------------- Debounced MutationObserver ---------------
let _observerTimer = null;

function startMessageObserver() {
  if (!document.body) return;
  injectDecryptedStyles();
  document.body.addEventListener("click", handleFeedMessageClick, true);
  const observer = new MutationObserver(() => {
    if (_observerTimer) clearTimeout(_observerTimer);
    _observerTimer = setTimeout(() => {
      processMessages();
      markEncryptedInFeed();
    }, 300);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.urlKeys) return;
  _keyCache.clear();
  document.querySelectorAll(`[${FAILED_ATTR}]`).forEach((el) => {
    el.removeAttribute(FAILED_ATTR);
    el.removeAttribute("title");
  });
  processMessages().catch(() => {});
});

// --------------- Message listener ---------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      const domElements = getDomElementsForService();
      if (!domElements) {
        sendResponse({ success: false, message: "Этот сайт не поддерживается." });
        return true;
      }
      const { inputField } = domElements;

      if (request.action === "encryptText") {
        if (!inputField) {
          sendResponse({ success: false, message: "Поле ввода не найдено. Откройте чат." });
          return true;
        }
        getKeysForCurrentPage()
          .then((keys) => {
            if (!keys) {
              sendResponse({ success: false, message: "Ключи не настроены для этого сайта." });
              return;
            }
            const textToEncrypt = inputField.innerText || inputField.textContent || "";
            if (!textToEncrypt.trim()) {
              sendResponse({ success: false, message: "Нет текста для шифрования." });
              return;
            }
            if (textToEncrypt.trim().startsWith(ENCRYPTED_PREFIX)) {
              sendResponse({ success: false, message: "Текст уже зашифрован." });
              return;
            }
            encryptText(textToEncrypt, keys.myKey)
              .then((encryptedText) => {
                inputField.scrollIntoView({ block: "nearest", behavior: "smooth" });
                inputField.focus();

                function replaceFieldWithText(text) {
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  const range = document.createRange();
                  range.selectNodeContents(inputField);
                  sel.addRange(range);
                  const ok = document.execCommand("insertText", false, text);
                  if (!ok) {
                    inputField.innerText = text;
                    inputField.dispatchEvent(new InputEvent("input", { bubbles: true }));
                  }
                }

                const isLexical = domElements.isLexical || inputField.querySelector?.('span[data-lexical-text="true"]');
                if (isLexical) {
                  // 1) Выделяем всё содержимое и вставляем через paste (редактор часто заменяет выделение при вставке)
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  const range = document.createRange();
                  range.selectNodeContents(inputField);
                  sel.addRange(range);
                  try {
                    const dt = new DataTransfer();
                    dt.setData("text/plain", encryptedText);
                    inputField.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
                  } catch (_) {}
                  // 2) Если через 50ms поле не обновилось — пробуем execCommand insertText (замена выделения)
                  setTimeout(() => {
                    const after = (inputField.innerText || inputField.textContent || "").trim();
                    if (!after.startsWith(ENCRYPTED_PREFIX)) {
                      replaceFieldWithText(encryptedText);
                    }
                  }, 50);
                } else {
                  replaceFieldWithText(encryptedText);
                }

                setTimeout(() => {
                  const now = (inputField.innerText || inputField.textContent || "").trim();
                  if (!now.startsWith(ENCRYPTED_PREFIX)) {
                    navigator.clipboard.writeText(encryptedText).then(
                      () => sendResponse({ success: false, message: "Текст скопирован в буфер. Вставьте в поле ввода (Ctrl+V)." }),
                      () => sendResponse({ success: false, message: "Кликните в поле ввода в чате и нажмите «Зашифровать» снова." })
                    );
                  } else {
                    sendResponse({ success: true });
                  }
                }, 350);
              })
              .catch(() => sendResponse({ success: false, message: "Ошибка шифрования." }));
          })
          .catch(() => sendResponse({ success: false }));
        return true;
      }

      if (request.action === "decryptText") {
        processMessages().then(() => sendResponse({ success: true }));
        return true;
      }

      if (request.action === "getStatus") {
        const service = detectService();
        sendResponse({
          success: true,
          service: service ? SUPPORTED_SERVICES[service].name : null,
          decryptedCount: _decryptedCount,
        });
        return true;
      }
    } catch (error) {
      sendResponse({ success: false, message: error?.message || "Ошибка" });
    }
    return true;
  });

async function boot() {
  try {
    startMessageObserver();
    await processMessages();
    markEncryptedInFeed();
  } catch (error) {
    console.error("NebulaEncrypt: initial decryption error", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

setInterval(() => processMessages().catch(() => {}), 5000);
})();
