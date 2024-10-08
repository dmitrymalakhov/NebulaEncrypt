async function getKeysForCurrentPage() {
  const url = new URL(window.location.href);
  const urlPattern = `${url.protocol}//${url.host}`;

  return new Promise((resolve) => {
    chrome.storage.local.get("urlKeys", (result) => {
      const urlKeys = result.urlKeys || {};
      resolve(urlKeys[urlPattern] || null);
    });
  });
}

function getDomElementsForService() {
  const url = new URL(window.location.href);
  const host = url.host;

  if (host.includes("web.telegram.org")) {
    // Проверяем, используем ли мы версию "A" или "K"
    const isVersionA = url.pathname.startsWith("/a/");

    if (isVersionA) {
      // Версия "A"
      return {
        myMessages: document.querySelectorAll(".Message.own .text-content"),
        peerMessages: document.querySelectorAll(
          ".Message:not(.own) .text-content"
        ),
        inputField: document.getElementById("editable-message-text"),
      };
    } else {
      // Версия "K"
      return {
        myMessages: document.querySelectorAll(".bubble.is-out .message"),
        peerMessages: document.querySelectorAll(".bubble.is-in .message"),
        inputField: document.querySelector(
          "div[contenteditable='true'].input-message-input"
        ), // Предположительно, в версии K
      };
    }
  }
  // Добавьте сюда другие сервисы, если они будут поддерживаться
  return null;
}

async function decryptText(text, password) {
  try {
    const dec = new TextDecoder();
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
        salt: enc.encode("a-unique-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["decrypt"]
    );

    // Извлекаем содержимое из < >
    const matches = text.match(/<(.+)>/);
    if (!matches || matches.length < 2) {
      return null;
    }

    const cleanText = matches[1]; // Текст внутри <>
    const parts = cleanText.split(":");

    if (parts.length < 2) {
      return null;
    }

    const iv = Uint8Array.from(atob(parts[0]), (c) => c.charCodeAt(0));
    const encryptedData = Uint8Array.from(atob(parts[1]), (c) =>
      c.charCodeAt(0)
    );

    const decryptedMessage = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encryptedData
    );

    return dec.decode(decryptedMessage);
  } catch (error) {
    console.error("Failed to decrypt message:", error.message);
    return null; // Возвращаем null в случае ошибки
  }
}

async function encryptText(text, password) {
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
      salt: enc.encode("a-unique-salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    enc.encode(text)
  );

  return `NebulaEncrypt:<${btoa(String.fromCharCode(...iv))}:${btoa(
    String.fromCharCode(...new Uint8Array(ciphertext))
  )}>`;
}

async function processMessages() {
  const keys = await getKeysForCurrentPage();
  const domElements = getDomElementsForService();

  if (!keys || !domElements) return;

  const { myKey, peerKey } = keys;

  const { myMessages, peerMessages } = domElements;

  for (const msg of myMessages) {
    if (msg.textContent.startsWith("NebulaEncrypt:")) {
      const decryptedText = await decryptText(msg.textContent, myKey);
      if (decryptedText !== null) {
        msg.textContent = decryptedText;
      }
    }
  }

  for (const msg of peerMessages) {
    if (msg.textContent.startsWith("NebulaEncrypt:")) {
      const decryptedText = await decryptText(msg.textContent, peerKey);
      if (decryptedText !== null) {
        msg.textContent = decryptedText;
      }
    }
  }
}

if (!window.hasRun) {
  window.hasRun = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      const domElements = getDomElementsForService();
      if (!domElements) return;

      const { inputField } = domElements;

      if (request.action === "encryptText") {
        getKeysForCurrentPage().then((keys) => {
          if (!keys) {
            sendResponse({ success: false });
            return;
          }

          let textToEncrypt = inputField.innerText.trim();

          if (textToEncrypt.startsWith("NebulaEncrypt:")) {
            sendResponse({
              success: false,
              message: "Text is already encrypted.",
            });
            return;
          }

          encryptText(textToEncrypt, keys.myKey).then((encryptedText) => {
            inputField.innerText = encryptedText;

            const inputEvent = new Event("input", {
              bubbles: true,
              cancelable: true,
            });
            inputField.dispatchEvent(inputEvent);

            sendResponse({ success: true });
          });
        });
        return true;
      }

      if (request.action === "decryptText") {
        processMessages();
        sendResponse({ success: true });
      }
    } catch (error) {
      sendResponse({ success: false });
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await processMessages();
  } catch (error) {
    console.error("Error during initial decryption:", error);
  }
});

setInterval(async () => {
  try {
    await processMessages();
  } catch (error) {}
}, 1000);
