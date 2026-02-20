function sendCommandToTab(action) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    const tabId = tabs[0].id;
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) return;
        chrome.tabs.sendMessage(tabId, { action }, (response) => {
          if (chrome.runtime.lastError) {
            showNotification("NebulaEncrypt", "Перезагрузите страницу MAX и нажмите сочетание клавиш снова.");
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
  try {
    const url = new URL(tab.url);
    const base = `${url.protocol}//${url.host}`;
    const urlPattern = base.endsWith("/") ? base : base + "/";

    chrome.storage.local.get("urlKeys", (result) => {
      const urlKeys = result.urlKeys || {};
      const hasKeys = !!urlKeys[urlPattern];
      try {
        chrome.action.setBadgeText({ text: hasKeys ? "" : "!", tabId });
        chrome.action.setBadgeBackgroundColor({
          color: hasKeys ? "#4CAF50" : "#FF9800",
          tabId,
        });
      } catch {}
    });
  } catch {}
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!tab?.url) return;
    try {
      const url = new URL(tab.url);
      const base = `${url.protocol}//${url.host}`;
      const urlPattern = base.endsWith("/") ? base : base + "/";
      chrome.storage.local.get("urlKeys", (result) => {
        const urlKeys = result.urlKeys || {};
        const hasKeys = !!urlKeys[urlPattern];
        try {
          chrome.action.setBadgeText({ text: hasKeys ? "" : "!", tabId });
          chrome.action.setBadgeBackgroundColor({
            color: hasKeys ? "#4CAF50" : "#FF9800",
            tabId,
          });
        } catch {}
      });
    } catch {}
  });
});
