// popup.js

const SERVICE_URLS = {
  telegram: "https://web.telegram.org/",
  max: "https://web.max.ru/",
};

function normalizeUrlPattern(url) {
  if (!url) return "";
  const u = url.trim();
  return u.endsWith("/") ? u : u + "/";
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
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
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
    const url = (tab.url || "").toLowerCase();
    if (!url.includes("web.max.ru") && !url.includes("web.telegram.org")) {
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

  document.getElementById("btnEncrypt").addEventListener("click", () => runCommand("encryptText"));
  document.getElementById("btnDecrypt").addEventListener("click", () => runCommand("decryptText"));

  myKeyInput.addEventListener("input", () => updateStrengthBar("myKeyStrength", myKeyInput.value));
  peerKeyInput.addEventListener("input", () => updateStrengthBar("peerKeyStrength", peerKeyInput.value));

  // Toggle visibility
  document.getElementById("toggleMyKey").addEventListener("click", () => {
    myKeyInput.type = myKeyInput.type === "password" ? "text" : "password";
  });
  document.getElementById("togglePeerKey").addEventListener("click", () => {
    peerKeyInput.type = peerKeyInput.type === "password" ? "text" : "password";
  });

  // Generate random keys
  document.getElementById("genMyKey").addEventListener("click", () => {
    myKeyInput.value = generateKey();
    myKeyInput.type = "text";
    updateStrengthBar("myKeyStrength", myKeyInput.value);
  });
  document.getElementById("genPeerKey").addEventListener("click", () => {
    peerKeyInput.value = generateKey();
    peerKeyInput.type = "text";
    updateStrengthBar("peerKeyStrength", peerKeyInput.value);
  });

  function setPageUrlByService() {
    pageUrlInput.value = serviceSelect.value;
    loadKeysForCurrentUrl();
  }

  function loadKeysForCurrentUrl() {
    const urlPattern = normalizeUrlPattern(pageUrlInput.value);
    if (!urlPattern) return;
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const keys = result.urlKeys[urlPattern];
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
      serviceDetectEl.textContent = "Текущая вкладка: " + detected.name;
      pageUrlInput.value = detected.urlPattern;
      serviceSelect.value = detected.id === "max" ? SERVICE_URLS.max : SERVICE_URLS.telegram;
    } else {
      serviceDetectEl.textContent = "Страница не поддерживается. Выберите сервис вручную.";
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

    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = result.urlKeys;
      urlKeys[urlPattern] = { myKey, peerKey };
      chrome.storage.local.set({ urlKeys }, () => {
        showStatus("Ключи сохранены!", false);
        myKeyInput.value = "";
        peerKeyInput.value = "";
        updateStrengthBar("myKeyStrength", "");
        updateStrengthBar("peerKeyStrength", "");
        loadSavedUrls();
        loadKeysForCurrentUrl();
      });
    });
  });

  // --------------- Export / Import ---------------
  document.getElementById("exportKeys").addEventListener("click", () => {
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const data = JSON.stringify(result.urlKeys, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nebula-encrypt-keys.json";
      a.click();
      URL.revokeObjectURL(url);
      showStatus("Ключи экспортированы.", false);
    });
  });

  document.getElementById("importKeysBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (typeof imported !== "object" || Array.isArray(imported)) {
          showStatus("Некорректный формат файла.", true);
          return;
        }
        chrome.storage.local.get({ urlKeys: {} }, (result) => {
          const urlKeys = { ...result.urlKeys, ...imported };
          chrome.storage.local.set({ urlKeys }, () => {
            showStatus("Импортировано " + Object.keys(imported).length + " записей.", false);
            loadSavedUrls();
            loadKeysForCurrentUrl();
          });
        });
      } catch {
        showStatus("Не удалось прочитать файл.", true);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // --------------- Saved list ---------------
  function loadSavedUrls() {
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = result.urlKeys;
      const savedUrlsDiv = document.getElementById("savedUrls");
      savedUrlsDiv.innerHTML = "";

      Object.keys(urlKeys).forEach((url) => {
        const wrap = document.createElement("div");
        wrap.className = "saved-item";
        const span = document.createElement("span");
        span.textContent = url;
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn-danger";
        deleteButton.textContent = "Удалить";
        deleteButton.addEventListener("click", () => {
          delete urlKeys[url];
          chrome.storage.local.set({ urlKeys }, () => {
            loadSavedUrls();
            if (normalizeUrlPattern(pageUrlInput.value) === url) {
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
