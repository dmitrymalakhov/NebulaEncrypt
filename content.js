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

    // Убираем всё, что идет после последнего символа "="
    const cleanText = text.split("=").slice(0, -1).join("=") + "=";

    // Проверяем, что строка соответствует ожидаемому формату
    const parts = cleanText.split(":");

    if (parts[0] !== "NebulaEncrypt") {
      throw new Error("Incorrectly formatted encryption string");
    }

    // Декодируем iv и зашифрованные данные
    const iv = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
    const encryptedData = Uint8Array.from(atob(parts[2]), (c) =>
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

  return `NebulaEncrypt:${btoa(String.fromCharCode(...iv))}:${btoa(
    String.fromCharCode(...new Uint8Array(ciphertext))
  )}`;
}

async function processMessages() {
  try {
    const { myKey, peerKey } = await chrome.storage.local.get([
      "myKey",
      "peerKey",
    ]);

    if (myKey && peerKey) {
      const myMessages = document.querySelectorAll(
        ".peer-color-count-1 .text-content"
      );
      const peerMessages = document.querySelectorAll(
        ".peer-color-count-2 .text-content"
      );

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
  } catch (error) {
    console.error("Error processing messages:", error);
  }
}

if (!window.hasRun) {
  window.hasRun = true; // Флаг, чтобы убедиться, что скрипт выполнен только один раз

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === "encryptText") {
        // Получаем текст из элемента с id 'editable-message-text'
        let inputField = document.getElementById("editable-message-text");
        let textToEncrypt = inputField.innerText.trim(); // Извлекаем текст

        // Проверяем, начинается ли текст с метки `NebulaEncrypt`
        if (textToEncrypt.startsWith("NebulaEncrypt:")) {
          console.warn("Text is already encrypted, skipping re-encryption.");
          sendResponse({
            success: false,
            message: "Text is already encrypted.",
          });
          return;
        }

        chrome.storage.local.get("myKey", async (result) => {
          const myKey = result.myKey;
          if (myKey && textToEncrypt) {
            const encryptedText = await encryptText(textToEncrypt, myKey);

            // Заменяем текст в поле ввода на зашифрованный текст
            inputField.innerText = encryptedText;

            // Создаем и отправляем событие 'input' для уведомления Telegram о том, что текст изменился
            const inputEvent = new Event("input", {
              bubbles: true,
              cancelable: true,
            });
            inputField.dispatchEvent(inputEvent);

            sendResponse({ success: true });
          } else {
            sendResponse({ success: false });
          }
        });
        return true;
      }

      if (request.action === "decryptText") {
        processMessages(); // Запускаем процесс дешифрации по запросу
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error("Error during message processing:", error);
      sendResponse({ success: false });
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await processMessages(); // Гарантируем выполнение всех операций
  } catch (error) {
    console.error("Error during initial decryption:", error);
  }
});

// Повторная попытка расшифровки каждые 1 секунд
setInterval(async () => {
  try {
    await processMessages(); // Гарантируем выполнение всех операций
  } catch (error) {
    console.error("Error during periodic decryption:", error);
  }
}, 1000);
