const statusEl = document.getElementById("status");
const grantButton = document.getElementById("grantAccess");
const closeButton = document.getElementById("closePage");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.borderColor = isError ? "#ef4444" : "var(--border)";
  statusEl.style.color = isError ? "#fecaca" : "var(--text)";
}

async function requestAccess() {
  setStatus("Requesting microphone access...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    chrome.storage.local.set({ aqualMicPermissionGranted: true });
    setStatus("Microphone access granted.");
  } catch (err) {
    const message = err && err.name === "NotAllowedError"
      ? "Microphone permission denied. Choose Allow to proceed."
      : `Microphone error: ${err?.message || "unknown"}`;
    chrome.storage.local.set({ aqualMicPermissionGranted: false });
    setStatus(message, true);
  }
}

grantButton.addEventListener("click", () => {
  requestAccess();
});

closeButton.addEventListener("click", () => {
  window.close();
});

const auto = new URLSearchParams(window.location.search).get("auto");
if (auto === "1") {
  requestAccess();
}
