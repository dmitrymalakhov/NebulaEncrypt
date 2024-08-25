chrome.commands.onCommand.addListener((command) => {
  if (command === "encrypt-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            files: ["content.js"],
          },
          () => {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { action: "encryptText" },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "Failed to send message:",
                    chrome.runtime.lastError.message
                  );
                } else {
                  console.log("Message sent to content script");
                  if (response && response.success) {
                    console.log("Text encrypted successfully.");
                  } else {
                    console.log("Failed to encrypt text.");
                  }
                }
              }
            );
          }
        );
      }
    });
  }

  if (command === "decrypt-text") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            files: ["content.js"],
          },
          () => {
            chrome.tabs.sendMessage(
              tabs[0].id,
              { action: "decryptText" },
              (response) => {
                if (chrome.runtime.lastError) {
                  console.error(
                    "Failed to send message:",
                    chrome.runtime.lastError.message
                  );
                } else {
                  console.log("Message sent to content script");
                  if (response && response.success) {
                    console.log("Text decrypted successfully.");
                  } else {
                    console.log("Failed to decrypt text.");
                  }
                }
              }
            );
          }
        );
      }
    });
  }
});
