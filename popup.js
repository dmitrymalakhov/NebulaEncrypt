document.getElementById("saveKeys").addEventListener("click", () => {
  const myKey = document.getElementById("myKey").value;
  const peerKey = document.getElementById("peerKey").value;

  if (myKey && peerKey) {
    chrome.storage.local.set({ myKey, peerKey }, () => {
      alert("Keys saved successfully.");
    });
  } else {
    alert("Please enter both keys.");
  }
});
