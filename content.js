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
      resolve(urlKeys[urlPattern] || null);
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

// --------------- Key derivation cache ---------------
const KEY_CACHE_MAX = 32;
const _keyCache = new Map();

function _keyCacheId(password, salt, usage) {
  return `${usage}:${salt}:${password}`;
}

async function getCachedKey(password, saltValue, usage, iterations = 210000) {
  const id = _keyCacheId(password, saltValue, usage);
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

// --------------- Decrypt ---------------
function parseEncryptedPayload(text) {
  const m = text.match(/<([^>]+)>/);
  if (!m || m.length < 2) return null;
  const sepIdx = m[1].indexOf(":");
  if (sepIdx < 1) return null;
  try {
    const iv = base64ToUint8(m[1].slice(0, sepIdx));
    const data = base64ToUint8(m[1].slice(sepIdx + 1));
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
    { salt: "NebulaEncrypt-v1-" + getUrlPattern(), iters: 210000 },
    { salt: "NebulaEncrypt-v1-" + getUrlPattern(), iters: 100000 },
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
  const salt = "NebulaEncrypt-v1-" + getUrlPattern();
  const key = await getCachedKey(password, salt, "encrypt", 210000);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(text)
  );
  return `NebulaEncrypt:<${uint8ToBase64(iv)}:${uint8ToBase64(new Uint8Array(ciphertext))}>`;
}

// --------------- Visual indicator CSS ---------------
function injectDecryptedStyles() {
  if (document.getElementById("nebula-encrypt-styles")) return;
  const style = document.createElement("style");
  style.id = "nebula-encrypt-styles";
  style.textContent = `
    [data-nebula-decrypted] {
      position: relative;
    }
    [data-nebula-decrypted]::before {
      content: "\\1F512";
      font-size: 10px;
      margin-right: 4px;
      opacity: 0.5;
      vertical-align: middle;
    }
    [data-nebula-encrypted] {
      cursor: pointer;
      border-bottom: 1px dashed rgba(128,128,128,0.5);
    }
    [data-nebula-encrypted]:hover {
      background: rgba(0,0,0,0.04);
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
    if (!content || !content.querySelector(".Message.own")) return null;
    if (!content.contains(clickTarget) && clickTarget !== content) return null;
    return { textSpan: content, isMy: true };
  }

  if (service === "TELEGRAM_K") {
    const msg = clickTarget.closest(".bubble.is-out .message");
    if (!msg) return null;
    if (!msg.contains(clickTarget) && clickTarget !== msg) return null;
    return { textSpan: msg, isMy: true };
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
    if (raw.startsWith("NebulaEncrypt:")) {
      span.setAttribute("data-nebula-encrypted", "1");
      span.setAttribute("title", "Нажмите, чтобы расшифровать");
    }
  }
}

// --------------- Process messages ---------------
const DECRYPTED_ATTR = "data-nebula-decrypted";
let _decryptedCount = 0;

async function processMessages() {
  const keys = await getKeysForCurrentPage();
  const domElements = getDomElementsForService();
  if (!keys || !domElements) return;

  const { myKey, peerKey } = keys;
  const { myMessages, peerMessages } = domElements;
  let newlyDecrypted = 0;

  for (const msg of myMessages) {
    if (msg.getAttribute(DECRYPTED_ATTR)) continue;
    const raw = msg.textContent;
    if (!raw.startsWith("NebulaEncrypt:")) continue;
    const decryptedText = await decryptText(raw, myKey);
    if (decryptedText !== null) {
      msg.textContent = decryptedText;
      msg.setAttribute(DECRYPTED_ATTR, "1");
      newlyDecrypted++;
    }
  }

  for (const msg of peerMessages) {
    if (msg.getAttribute(DECRYPTED_ATTR)) continue;
    const raw = msg.textContent;
    if (!raw.startsWith("NebulaEncrypt:")) continue;
    const decryptedText = await decryptText(raw, peerKey);
    if (decryptedText !== null) {
      msg.textContent = decryptedText;
      msg.setAttribute(DECRYPTED_ATTR, "1");
      newlyDecrypted++;
    }
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
  const raw = (textSpan.textContent || "").trim();
  if (!raw.startsWith("NebulaEncrypt:")) return;

  e.preventDefault();
  e.stopPropagation();

  const keys = await getKeysForCurrentPage();
  if (!keys) return;
  const password = isMy ? keys.myKey : keys.peerKey;
  const decryptedText = await decryptText(raw, password);
  if (decryptedText === null) return;

  textSpan.textContent = decryptedText;
  textSpan.setAttribute(DECRYPTED_ATTR, "1");
  textSpan.removeAttribute("data-nebula-encrypted");
  textSpan.removeAttribute("title");
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
  observer.observe(document.body, { childList: true, subtree: true });
}

// --------------- Message listener ---------------
if (!window.hasRun) {
  window.hasRun = true;

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
            const textToEncrypt = inputField.innerText.trim();
            if (!textToEncrypt) {
              sendResponse({ success: false, message: "Нет текста для шифрования." });
              return;
            }
            if (textToEncrypt.startsWith("NebulaEncrypt:")) {
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
                    if (!after.startsWith("NebulaEncrypt:")) {
                      replaceFieldWithText(encryptedText);
                    }
                  }, 50);
                } else {
                  replaceFieldWithText(encryptedText);
                }

                setTimeout(() => {
                  const now = (inputField.innerText || inputField.textContent || "").trim();
                  if (!now.startsWith("NebulaEncrypt:")) {
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
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    startMessageObserver();
    await processMessages();
  } catch (error) {
    console.error("NebulaEncrypt: initial decryption error", error);
  }
});

setInterval(() => processMessages().catch(() => {}), 5000);
