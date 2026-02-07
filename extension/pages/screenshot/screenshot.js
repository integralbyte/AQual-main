const image = document.getElementById("screenshotImage");
const downloadBtn = document.getElementById("downloadBtn");

chrome.storage.local.get("aqualScreenshot", (stored) => {
  if (!stored || !stored.aqualScreenshot) return;
  image.src = stored.aqualScreenshot;
  downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = stored.aqualScreenshot;
    link.download = "aqual-screenshot.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
