// popup.js

const SERVICE_URLS = {
  telegram: "https://web.telegram.org/",
  max: "https://web.max.ru/",
};
const SUPPORTED_HOSTS = new Set(["web.telegram.org", "web.max.ru"]);
const BACKUP_TYPE = "NebulaEncrypt.encryptedBackup.v1";
const BACKUP_KDF_ITERATIONS = 210000;
const BACKUP_FILE_MAX_BYTES = 1024 * 1024;

if (!globalThis.chrome) {
  const previewStorage = { urlKeys: {} };
  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      query(_query, callback) { callback([]); },
      sendMessage(_tabId, _message, callback) { callback?.({ success: false }); },
    },
    scripting: {
      executeScript(_details, callback) { callback?.(); },
    },
    storage: {
      local: {
        get(query, callback) {
          if (typeof query === "string") {
            callback({ [query]: previewStorage[query] });
            return;
          }
          callback({ ...(query || {}), ...previewStorage });
        },
        set(value, callback) {
          Object.assign(previewStorage, value);
          callback?.();
        },
      },
    },
  };
}

function normalizeUrlPattern(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || !SUPPORTED_HOSTS.has(parsed.host)) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return "";
  }
}

function detectServiceFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.host;
    if (host === "web.telegram.org") return { id: "telegram", name: "Telegram", urlPattern: normalizeUrlPattern(`${url.protocol}//${url.host}`) };
    if (host === "web.max.ru") return { id: "max", name: "MAX", urlPattern: normalizeUrlPattern(`${url.protocol}//${url.host}`) };
  } catch {}
  return null;
}

function isValidKeyRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    typeof record.myKey === "string" &&
    typeof record.peerKey === "string" &&
    record.myKey.length > 0 &&
    record.peerKey.length > 0 &&
    record.myKey.length <= 4096 &&
    record.peerKey.length <= 4096
  );
}

function sanitizeUrlKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const sanitized = {};
  for (const [rawUrl, record] of Object.entries(value)) {
    const urlPattern = normalizeUrlPattern(rawUrl);
    if (!urlPattern || !isValidKeyRecord(record)) continue;
    sanitized[urlPattern] = {
      myKey: record.myKey,
      peerKey: record.peerKey,
    };
  }

  return sanitized;
}

// --------------- Key strength ---------------
function measureStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const STRENGTH_COLORS = ["#ccc", "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71"];
const STRENGTH_WIDTHS = [0, 25, 50, 75, 100];

function updateStrengthBar(barId, value) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  const fill = bar.querySelector(".fill");
  const s = measureStrength(value);
  fill.style.width = STRENGTH_WIDTHS[s] + "%";
  fill.style.background = STRENGTH_COLORS[s];
}

// --------------- Random key ---------------
function generateKey(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const maxValidByte = 256 - (256 % chars.length);
  let result = "";

  while (result.length < length) {
    const arr = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of arr) {
      if (byte >= maxValidByte) continue;
      result += chars[byte % chars.length];
      if (result.length === length) break;
    }
  }

  return result;
}

// --------------- Backup crypto ---------------
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

async function deriveBackupKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: BACKUP_KDF_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBackup(urlKeys, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt);
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    urlKeys,
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(payload))
  );

  return {
    type: BACKUP_TYPE,
    kdf: {
      name: "PBKDF2-HMAC-SHA-256",
      iterations: BACKUP_KDF_ITERATIONS,
      salt: uint8ToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: uint8ToBase64(iv),
    },
    data: uint8ToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptBackup(backup, passphrase) {
  if (
    !backup ||
    backup.type !== BACKUP_TYPE ||
    backup.kdf?.name !== "PBKDF2-HMAC-SHA-256" ||
    backup.kdf?.iterations !== BACKUP_KDF_ITERATIONS ||
    typeof backup.kdf?.salt !== "string" ||
    backup.cipher?.name !== "AES-GCM" ||
    typeof backup.cipher?.iv !== "string" ||
    typeof backup.data !== "string"
  ) {
    throw new Error("Некорректный формат резервной копии.");
  }

  const dec = new TextDecoder();
  const salt = base64ToUint8(backup.kdf.salt);
  const iv = base64ToUint8(backup.cipher.iv);
  const data = base64ToUint8(backup.data);
  if (salt.length !== 16 || iv.length !== 12) {
    throw new Error("Некорректный формат резервной копии.");
  }

  const key = await deriveBackupKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(dec.decode(plaintext));
}

function downloadJson(filename, value) {
  const data = JSON.stringify(value, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --------------- Status ---------------
let _statusTimer = null;
function showStatus(message, isError) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = "status " + (isError ? "error" : "success");
  el.style.display = "block";
  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => { el.style.display = "none"; }, 4000);
}

// --------------- Быстрые действия: шифровать / расшифровать на активной вкладке ---------------
function runCommand(action) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length || !tabs[0].id) {
      showStatus("Нет открытой вкладки.", true);
      return;
    }
    const tab = tabs[0];
    if (!detectServiceFromUrl(tab.url || "")) {
      showStatus("Откройте вкладку с чатом MAX или Telegram, затем нажмите кнопку снова.", true);
      return;
    }
    const tabId = tab.id;
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          showStatus("Перезагрузите страницу чата и попробуйте снова.", true);
          return;
        }
        chrome.tabs.sendMessage(tabId, { action }, (response) => {
          if (chrome.runtime.lastError) {
            showStatus("Перезагрузите страницу и нажмите кнопку снова.", true);
            return;
          }
          if (response?.success) {
            showStatus(action === "encryptText" ? "Текст зашифрован." : "Сообщения расшифрованы.", false);
          } else {
            showStatus(response?.message || "Ошибка.", true);
          }
        });
      }
    );
  });
}

// --------------- Main ---------------
document.addEventListener("DOMContentLoaded", () => {
  const saveKeysButton = document.getElementById("saveKeys");
  const pageUrlInput = document.getElementById("pageUrl");
  const serviceSelect = document.getElementById("serviceSelect");
  const serviceDetectEl = document.getElementById("serviceDetect");
  const myKeyInput = document.getElementById("myKey");
  const peerKeyInput = document.getElementById("peerKey");
  const backupPassphraseInput = document.getElementById("backupPassphrase");
  const keyStateEl = document.getElementById("keyState");

  document.getElementById("btnEncrypt").addEventListener("click", () => runCommand("encryptText"));
  document.getElementById("btnDecrypt").addEventListener("click", () => runCommand("decryptText"));

  myKeyInput.addEventListener("input", () => updateStrengthBar("myKeyStrength", myKeyInput.value));
  peerKeyInput.addEventListener("input", () => updateStrengthBar("peerKeyStrength", peerKeyInput.value));

  function setChipState(el, message, state) {
    el.textContent = message;
    el.classList.toggle("is-ok", state === "ok");
    el.classList.toggle("is-warn", state === "warn");
  }

  function setKeyState(hasKeys) {
    setChipState(keyStateEl, hasKeys ? "Ключи готовы" : "Нет ключей", hasKeys ? "ok" : "warn");
  }

  function toggleSecretInput(input, button) {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", show ? "true" : "false");
  }

  document.getElementById("toggleMyKey").addEventListener("click", (event) => {
    toggleSecretInput(myKeyInput, event.currentTarget);
  });
  document.getElementById("togglePeerKey").addEventListener("click", (event) => {
    toggleSecretInput(peerKeyInput, event.currentTarget);
  });
  document.getElementById("toggleBackupPassphrase").addEventListener("click", (event) => {
    toggleSecretInput(backupPassphraseInput, event.currentTarget);
  });

  // Generate random keys
  document.getElementById("genMyKey").addEventListener("click", () => {
    myKeyInput.value = generateKey();
    myKeyInput.type = "text";
    document.getElementById("toggleMyKey").setAttribute("aria-pressed", "true");
    updateStrengthBar("myKeyStrength", myKeyInput.value);
  });
  document.getElementById("genPeerKey").addEventListener("click", () => {
    peerKeyInput.value = generateKey();
    peerKeyInput.type = "text";
    document.getElementById("togglePeerKey").setAttribute("aria-pressed", "true");
    updateStrengthBar("peerKeyStrength", peerKeyInput.value);
  });

  function setPageUrlByService() {
    pageUrlInput.value = serviceSelect.value;
    const selectedName = serviceSelect.selectedOptions[0]?.textContent || "сервис";
    setChipState(serviceDetectEl, "Выбран: " + selectedName, "warn");
    loadKeysForCurrentUrl();
  }

  function loadKeysForCurrentUrl() {
    const urlPattern = normalizeUrlPattern(pageUrlInput.value);
    if (!urlPattern) {
      setKeyState(false);
      return;
    }
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = sanitizeUrlKeys(result.urlKeys) || {};
      const keys = urlKeys[urlPattern];
      setKeyState(!!keys);
      if (keys) {
        myKeyInput.placeholder = "••••••• (сохранён)";
        peerKeyInput.placeholder = "••••••• (сохранён)";
      } else {
        myKeyInput.placeholder = "Введите ключ";
        peerKeyInput.placeholder = "Введите ключ";
      }
    });
  }

  serviceSelect.addEventListener("change", setPageUrlByService);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) {
      setPageUrlByService();
      return;
    }
    const detected = detectServiceFromUrl(tab.url);
    if (detected) {
      setChipState(serviceDetectEl, "Текущая вкладка: " + detected.name, "ok");
      pageUrlInput.value = detected.urlPattern;
      serviceSelect.value = detected.id === "max" ? SERVICE_URLS.max : SERVICE_URLS.telegram;
    } else {
      setChipState(serviceDetectEl, "Сервис выбран вручную", "warn");
      setPageUrlByService();
    }
    loadKeysForCurrentUrl();
  });

  saveKeysButton.addEventListener("click", () => {
    const urlPattern = normalizeUrlPattern(pageUrlInput.value);
    const myKey = myKeyInput.value;
    const peerKey = peerKeyInput.value;

    if (!urlPattern) { showStatus("Укажите URL или выберите сервис.", true); return; }
    if (!myKey || !peerKey) { showStatus("Введите оба ключа.", true); return; }
    if (measureStrength(myKey) < 2) { showStatus("Ваш ключ слишком слабый. Минимум 8 символов, разный регистр или цифры.", true); return; }
    if (measureStrength(peerKey) < 2) { showStatus("Ключ собеседника слишком слабый. Минимум 8 символов, разный регистр или цифры.", true); return; }

    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = sanitizeUrlKeys(result.urlKeys) || {};
      urlKeys[urlPattern] = { myKey, peerKey };
      chrome.storage.local.set({ urlKeys }, () => {
        showStatus("Ключи сохранены!", false);
        myKeyInput.value = "";
        peerKeyInput.value = "";
        updateStrengthBar("myKeyStrength", "");
        updateStrengthBar("peerKeyStrength", "");
        setKeyState(true);
        loadSavedUrls();
        loadKeysForCurrentUrl();
      });
    });
  });

  // --------------- Export / Import ---------------
  document.getElementById("exportKeys").addEventListener("click", async () => {
    const passphrase = backupPassphraseInput.value;
    if (measureStrength(passphrase) < 2) {
      showStatus("Введите пароль резервной копии: минимум 8 символов, разный регистр или цифры.", true);
      return;
    }

    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      (async () => {
        try {
          const urlKeys = sanitizeUrlKeys(result.urlKeys) || {};
          if (Object.keys(urlKeys).length === 0) {
            showStatus("Нет ключей для экспорта.", true);
            return;
          }

          const encrypted = await encryptBackup(urlKeys, passphrase);
          downloadJson("nebula-encrypt-backup.json", encrypted);
          backupPassphraseInput.value = "";
          backupPassphraseInput.type = "password";
          showStatus("Зашифрованный бэкап экспортирован.", false);
        } catch {
          showStatus("Не удалось экспортировать бэкап.", true);
        }
      })();
    });
  });

  document.getElementById("importKeysBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > BACKUP_FILE_MAX_BYTES) {
      showStatus("Файл бэкапа слишком большой.", true);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        let importedPayload = parsed;

        if (parsed?.type === BACKUP_TYPE) {
          const passphrase = backupPassphraseInput.value;
          if (!passphrase) {
            showStatus("Введите пароль резервной копии перед импортом.", true);
            return;
          }
          importedPayload = await decryptBackup(parsed, passphrase);
        }

        const imported = sanitizeUrlKeys(importedPayload.urlKeys || importedPayload);
        if (!imported || Object.keys(imported).length === 0) {
          showStatus("В файле нет корректных ключей для поддерживаемых сайтов.", true);
          return;
        }

        chrome.storage.local.get({ urlKeys: {} }, (result) => {
          const current = sanitizeUrlKeys(result.urlKeys) || {};
          const urlKeys = { ...current, ...imported };
          chrome.storage.local.set({ urlKeys }, () => {
            showStatus("Импортировано " + Object.keys(imported).length + " записей.", false);
            backupPassphraseInput.value = "";
            backupPassphraseInput.type = "password";
            loadSavedUrls();
            loadKeysForCurrentUrl();
          });
        });
      } catch {
        showStatus("Не удалось прочитать файл или пароль неверный.", true);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // --------------- Saved list ---------------
  function loadSavedUrls() {
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = sanitizeUrlKeys(result.urlKeys) || {};
      const savedUrlsDiv = document.getElementById("savedUrls");
      savedUrlsDiv.replaceChildren();

      Object.keys(urlKeys).sort().forEach((url) => {
        const wrap = document.createElement("div");
        wrap.className = "saved-item";
        const span = document.createElement("span");
        span.textContent = url;
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger-button";
        deleteButton.textContent = "Удалить";
        deleteButton.addEventListener("click", () => {
          delete urlKeys[url];
          chrome.storage.local.set({ urlKeys }, () => {
            loadSavedUrls();
            if (normalizeUrlPattern(pageUrlInput.value) === url) {
              setKeyState(false);
              myKeyInput.placeholder = "Введите ключ";
              peerKeyInput.placeholder = "Введите ключ";
            }
          });
        });
        wrap.appendChild(span);
        wrap.appendChild(deleteButton);
        savedUrlsDiv.appendChild(wrap);
      });
    });
  }

  loadSavedUrls();
});
