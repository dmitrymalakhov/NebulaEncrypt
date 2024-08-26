// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const saveKeysButton = document.getElementById("saveKeys");
  const pageUrlInput = document.getElementById("pageUrl");

  // Получаем текущий URL и подставляем в поле URL
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = new URL(tabs[0].url);
    pageUrlInput.value = `${url.protocol}//${url.host}`;
  });

  saveKeysButton.addEventListener("click", () => {
    const urlPattern = pageUrlInput.value;
    const myKey = document.getElementById("myKey").value;
    const peerKey = document.getElementById("peerKey").value;

    if (urlPattern && myKey && peerKey) {
      chrome.storage.local.get({ urlKeys: {} }, (result) => {
        const urlKeys = result.urlKeys;
        urlKeys[urlPattern] = { myKey, peerKey };
        chrome.storage.local.set({ urlKeys }, () => {
          alert("Keys saved successfully for " + urlPattern);
          loadSavedUrls(); // Reload saved URLs
        });
      });
    } else {
      alert("Please enter a URL pattern and both keys.");
    }
  });

  const loadSavedUrls = () => {
    chrome.storage.local.get({ urlKeys: {} }, (result) => {
      const urlKeys = result.urlKeys;
      const savedUrlsDiv = document.getElementById("savedUrls");
      savedUrlsDiv.innerHTML = "";

      Object.keys(urlKeys).forEach((url) => {
        const div = document.createElement("div");
        div.textContent = url;
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
          delete urlKeys[url];
          chrome.storage.local.set({ urlKeys }, () => {
            loadSavedUrls();
          });
        });
        div.appendChild(deleteButton);
        savedUrlsDiv.appendChild(div);
      });
    });
  };

  loadSavedUrls();
});
