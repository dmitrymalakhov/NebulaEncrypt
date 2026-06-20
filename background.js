if (!globalThis.nebulaExtensionApi && typeof importScripts === "function") {
  importScripts("extension-api.js");
}

const SUPPORTED_HOSTS = new Set(["web.telegram.org", "web.max.ru"]);

function hasValidKeyPair(record) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.myKey === "string" &&
    typeof record.peerKey === "string" &&
    record.myKey.length > 0 &&
    record.peerKey.length > 0
  );
}

function getSupportedUrlPattern(tabUrl) {
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== "https:" || !SUPPORTED_HOSTS.has(url.host)) {
      return null;
    }
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

function updateTabBadge(tabId, tabUrl) {
  const urlPattern = getSupportedUrlPattern(tabUrl);
  if (!urlPattern) {
    try {
      chrome.action.setBadgeText({ text: "", tabId });
    } catch {}
    return;
  }

  chrome.storage.local.get("urlKeys", (result) => {
    const urlKeys = result.urlKeys || {};
    const hasKeys = hasValidKeyPair(urlKeys[urlPattern]);
    try {
      chrome.action.setBadgeText({ text: hasKeys ? "✓" : "!", tabId });
      chrome.action.setBadgeBackgroundColor({
        color: hasKeys ? "#4CAF50" : "#FF9800",
        tabId,
      });
    } catch {}
  });
}

function sendCommandToTab(action) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    const tab = tabs[0];
    if (!getSupportedUrlPattern(tab.url || "")) {
      showNotification("NebulaEncrypt", "Откройте вкладку Telegram Web или MAX и нажмите сочетание клавиш снова.");
      return;
    }
    const tabId = tab.id;
    if (!tabId) return;
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.sendMessage(tabId, { action }, (response) => {
          if (chrome.runtime.lastError) {
            showNotification("NebulaEncrypt", "Перезагрузите страницу чата и нажмите сочетание клавиш снова.");
            return;
          }
          if (!response?.success && response?.message) {
            showNotification("NebulaEncrypt", response.message);
          }
        });
      }
    );
  });
}

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon-128.png",
      title,
      message,
      silent: true,
    });
  } catch {}
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "encrypt-text") sendCommandToTab("encryptText");
  if (command === "decrypt-text") sendCommandToTab("decryptText");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateBadge") {
    const count = request.count;
    const tabId = sender.tab?.id;
    if (!tabId) return;
    try {
      const text = count > 0 ? String(count) : "";
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId });
    } catch {}
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab?.url) return;
  updateTabBadge(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!tab?.url) return;
    updateTabBadge(tabId, tab.url);
  });
});
