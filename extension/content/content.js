const DEFAULTS = {
  fontEnabled: false,
  fontFamily: "lexend",
  fontSizeEnabled: false,
  fontSizePx: 50,
  fontColorEnabled: false,
  fontColor: "#1CA085",
  textStrokeEnabled: false,
  textStrokeColor: "#C0382B",
  magnifierEnabled: false,
  magnifierSize: 50,
  magnifierZoom: 3,
  imageVeilEnabled: false,
  highlightEnabled: false,
  linkEmphasisEnabled: false,
  cursorEnabled: false,
  cursorType: "arrow-large.png",
  highContrastEnabled: false,
  nightModeEnabled: false,
  dimmingEnabled: false,
  dimmingLevel: 0.25,
  blueLightEnabled: false,
  blueLightLevel: 0.2,
  colorBlindMode: "none",
  reducedCrowdingEnabled: false,
  drawingEnabled: false,
  lineGuideEnabled: false
};

const FONT_CSS_MAP = {
  "open-dyslexic": "styles/fonts/open-dyslexic.css",
  "lexend": "styles/fonts/lexend.css",
  "sign-language": "styles/fonts/sign-language.css",
  "arial": "styles/fonts/arial.css",
  "verdana": "styles/fonts/verdana.css",
  "impact": "styles/fonts/impact.css",
  "comic-sans": "styles/fonts/comic-sans.css"
};

const TEXT_SIZE_SELECTORS = [
  "a",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "label",
  "input",
  "textarea",
  "button",
  "th",
  "td",
  "caption",
  "figcaption",
  "blockquote",
  "dd",
  "dt",
  "code",
  "pre"
].join(",");

const TEXT_COLOR_SELECTORS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "label",
  "input",
  "textarea",
  "button",
  "th",
  "td",
  "caption",
  "figcaption",
  "blockquote",
  "dd",
  "dt",
  "code",
  "pre"
].join(",");

const TEXT_STROKE_SELECTORS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "label",
  "input",
  "textarea",
  "button",
  "th",
  "td",
  "caption",
  "figcaption",
  "blockquote",
  "dd",
  "dt",
  "code",
  "pre",
  "a"
].join(",");

const TEXT_CROWDING_SELECTORS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "label",
  "input",
  "textarea",
  "button",
  "th",
  "td",
  "caption",
  "figcaption",
  "blockquote",
  "dd",
  "dt",
  "code",
  "pre"
].join(",");

let state = { ...DEFAULTS };

const highlightedElements = new Set();
let linkObserver = null;
let imageObserver = null;
let magnifierLens = null;
let currentImage = null;
let magnifierActive = false;
let magnifierSize = DEFAULTS.magnifierSize;
let magnifierZoom = DEFAULTS.magnifierZoom;
let magnifierListenersBound = false;
let veilAttributeObserver = null;
let dimOverlay = null;
let blueOverlay = null;
let drawingCanvas = null;
let drawingCtx = null;
let drawingStrokes = [];
let activeStroke = null;
let drawingResizeTimer = null;
let cursorGuardTimer = null;
let cursorGuardRaf = null;
let cursorGuardUrl = "";
let cursorProbeX = null;
let cursorProbeY = null;
let cursorGuardObserver = null;
let shiftPressed = false;
let shiftHoverImage = null;
let describedImage = null;
let describedImagePayload = null;
let describedImageText = "";
let describeRequestSerial = 0;
let captionHost = null;
let captionEls = null;
let captionRepositionRaf = null;
let chatHost = null;
let chatEls = null;
let chatInFlight = false;
let chatHistory = [];
let chatDrag = null;
let previousUserSelect = "";
let lineGuideOverlay = null;
let lineGuideEnabled = false;
let lineGuideY = 0;
let lineGuideRaf = null;
let selectionSpeechAudio = null;
let selectionSpeechBusy = false;

const HIGH_CONTRAST_CURSOR_MAP = {
  "arrow-large.png": "arrow-large-white.png",
  "pencil-large.png": "pencil-large-white.png",
  "black-large.cur": "arrow-large-white.png"
};

const GOOGLE_MAPS_BLOCKLIST = [
  "https://www.google.com/maps",
  "http://www.google.com/maps",
  "https://maps.google.com",
  "http://maps.google.com"
];

const DOC_SERVER_BASE = "http://localhost:8080";

function isGoogleMapsUrl() {
  const href = window.location.href;
  return GOOGLE_MAPS_BLOCKLIST.some((prefix) => href.startsWith(prefix));
}

function normalizeSettings(input) {
  return { ...DEFAULTS, ...(input || {}) };
}

function resetAllVisualEffects() {
  applyFontFamily(false, state.fontFamily);
  applyFontSize(false, state.fontSizePx);
  applyFontColor(false, state.fontColor);
  applyTextStroke(false, state.textStrokeColor);
  applyCursor(false, state.cursorType);
  applyImageVeil(false);
  toggleHighlight(false);
  applyLinkEmphasis(false);
  applyMagnifier(false, state.magnifierSize, state.magnifierZoom);
  applyReducedCrowding(false);
  applyDrawingMode(false);
  updateRootFilter({ ...state, highContrastEnabled: false, colorBlindMode: "none" });
  toggleHighContrast(false);
  toggleNightMode(false);
  applyDimming(false, state.dimmingLevel);
  applyBlueLight(false, state.blueLightLevel);
  setLineGuideEnabled(false);
}

function ensureStyleTag(id, cssText) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = cssText;
}

function removeElement(id) {
  const el = document.getElementById(id);
  if (el) {
    el.remove();
  }
}

function applyFontFamily(enabled, key) {
  const id = "aqual-font-family";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const resolvedKey = FONT_CSS_MAP[key] ? key : DEFAULTS.fontFamily;
  const href = chrome.runtime.getURL(FONT_CSS_MAP[resolvedKey]);
  let link = document.getElementById(id);
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  } else if (link.getAttribute("href") !== href) {
    link.setAttribute("href", href);
  }
}

function applyFontSize(enabled, sizePx) {
  const id = "aqual-font-size";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const safeSize = Math.max(8, Math.min(120, Number(sizePx) || DEFAULTS.fontSizePx));
  const css = `${TEXT_SIZE_SELECTORS} { font-size: ${safeSize}px !important; line-height: 1.4 !important; }`;
  ensureStyleTag(id, css);
}

function applyFontColor(enabled, color) {
  const id = "aqual-font-color";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const css = `${TEXT_COLOR_SELECTORS} { color: ${color} !important; }`;
  ensureStyleTag(id, css);
}

function applyTextStroke(enabled, color) {
  const id = "aqual-text-stroke";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const css = `${TEXT_STROKE_SELECTORS} { -webkit-text-fill-color: #ffffff !important; -webkit-text-stroke-width: 1px; -webkit-text-stroke-color: ${color} !important; }`;
  ensureStyleTag(id, css);
}

function applyReducedCrowding(enabled) {
  const id = "aqual-reduced-crowding";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const css = `${TEXT_CROWDING_SELECTORS} { letter-spacing: 0.03em !important; word-spacing: 0.18em !important; line-height: 1.7 !important; }`;
  ensureStyleTag(id, css);
}

function stopCursorGuard() {
  if (cursorGuardTimer) {
    clearInterval(cursorGuardTimer);
    cursorGuardTimer = null;
  }
  if (cursorGuardRaf !== null) {
    cancelAnimationFrame(cursorGuardRaf);
    cursorGuardRaf = null;
  }
  if (cursorGuardObserver) {
    cursorGuardObserver.disconnect();
    cursorGuardObserver = null;
  }
  document.removeEventListener("mousemove", handleCursorPointerMove, true);
  document.removeEventListener("pointermove", handleCursorPointerMove, true);
  document.removeEventListener("mouseover", requestCursorGuardCheck, true);
  window.removeEventListener("scroll", requestCursorGuardCheck, true);
  window.removeEventListener("focus", requestCursorGuardCheck, true);
  document.removeEventListener("visibilitychange", requestCursorGuardCheck, true);
  cursorProbeX = null;
  cursorProbeY = null;
}

function handleCursorPointerMove(event) {
  cursorProbeX = event.clientX;
  cursorProbeY = event.clientY;
  requestCursorGuardCheck();
}

function getCursorProbeElement() {
  if (cursorProbeX === null || cursorProbeY === null) {
    return document.documentElement;
  }
  return document.elementFromPoint(cursorProbeX, cursorProbeY) || document.documentElement;
}

function upsertCursorStyle(cursorUrl) {
  const id = "aqual-cursor-style";
  const css = `
    *,
    *::before,
    *::after,
    html,
    body,
    body *,
    body *::before,
    body *::after,
    svg,
    svg * {
      cursor: url(${cursorUrl}) 4 4, auto !important;
    }
  `;
  ensureStyleTag(id, css);
}

function elementHasCustomCursor(el) {
  if (!el) return false;
  const cursor = window.getComputedStyle(el).cursor || "";
  return cursor.includes(cursorGuardUrl);
}

function ensureCursorApplied() {
  if (!state.cursorEnabled || !cursorGuardUrl) return;
  const probeEl = getCursorProbeElement();
  const rootEl = document.documentElement;
  const bodyEl = document.body;
  const cursorStyleTag = document.getElementById("aqual-cursor-style");

  if (
    cursorStyleTag &&
    elementHasCustomCursor(probeEl) &&
    elementHasCustomCursor(rootEl) &&
    (!bodyEl || elementHasCustomCursor(bodyEl))
  ) {
    return;
  }

  // Rewriting the style tag is cheap and reliably forces Chrome to pick
  // the custom cursor again after OS/browser transient overrides.
  upsertCursorStyle(cursorGuardUrl);
}

function handleCursorGuardMutation(mutations) {
  for (let i = 0; i < mutations.length; i += 1) {
    const mutation = mutations[i];
    if (mutation.type === "attributes" || mutation.type === "childList") {
      requestCursorGuardCheck();
      return;
    }
  }
}

function startCursorGuard() {
  if (cursorGuardTimer) return;
  document.addEventListener("mousemove", handleCursorPointerMove, true);
  document.addEventListener("pointermove", handleCursorPointerMove, true);
  document.addEventListener("mouseover", requestCursorGuardCheck, true);
  window.addEventListener("scroll", requestCursorGuardCheck, true);
  window.addEventListener("focus", requestCursorGuardCheck, true);
  document.addEventListener("visibilitychange", requestCursorGuardCheck, true);
  cursorGuardObserver = new MutationObserver(handleCursorGuardMutation);
  cursorGuardObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class"]
  });
  cursorGuardTimer = setInterval(() => {
    ensureCursorApplied();
  }, 250);
}

function requestCursorGuardCheck() {
  if (cursorGuardRaf !== null) return;
  cursorGuardRaf = requestAnimationFrame(() => {
    cursorGuardRaf = null;
    ensureCursorApplied();
  });
}

function resolveCursorAsset(cursorType, highContrastEnabled) {
  if (!highContrastEnabled) {
    return cursorType;
  }
  return HIGH_CONTRAST_CURSOR_MAP[cursorType] || cursorType;
}

function applyCursor(enabled, cursorType, highContrastEnabled) {
  const id = "aqual-cursor-style";
  if (!enabled) {
    stopCursorGuard();
    cursorGuardUrl = "";
    removeElement(id);
    return;
  }
  const resolvedCursorType = resolveCursorAsset(cursorType, highContrastEnabled);
  const cursorUrl = chrome.runtime.getURL(`assets/cursors/${resolvedCursorType}`);
  if (cursorUrl !== cursorGuardUrl) {
    cursorGuardUrl = cursorUrl;
  }
  upsertCursorStyle(cursorGuardUrl);
  startCursorGuard();
  requestCursorGuardCheck();
}

function ensureOverlay(id, className) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = className;
    (document.body || document.documentElement).appendChild(el);
  }
  return el;
}

function applyDimming(enabled, level) {
  dimOverlay = ensureOverlay("aqual-dim-overlay", "aqual-dim-overlay");
  const safeLevel = Math.max(0, Math.min(0.8, Number(level) || 0));
  dimOverlay.style.opacity = enabled ? String(safeLevel) : "0";
}

function applyBlueLight(enabled, level) {
  blueOverlay = ensureOverlay("aqual-blue-overlay", "aqual-blue-overlay");
  const safeLevel = Math.max(0, Math.min(0.6, Number(level) || 0));
  blueOverlay.style.opacity = enabled ? String(safeLevel) : "0";
}

function toggleNightMode(enabled) {
  document.documentElement.classList.toggle("aqual-night", Boolean(enabled));
}

function toggleHighContrast(enabled) {
  document.documentElement.classList.toggle("aqual-high-contrast", Boolean(enabled));
}

function getDocumentSize() {
  const doc = document.documentElement;
  const body = document.body;
  const width = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0, doc.clientWidth);
  const height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0, doc.clientHeight);
  return { width, height };
}

function ensureDrawingCanvas() {
  if (!drawingCanvas) {
    drawingCanvas = document.createElement("canvas");
    drawingCanvas.className = "aqual-draw-canvas";
    drawingCanvas.setAttribute("aria-hidden", "true");
    (document.body || document.documentElement).appendChild(drawingCanvas);
    drawingCtx = drawingCanvas.getContext("2d");
    drawingCtx.lineCap = "round";
    drawingCtx.lineJoin = "round";
    drawingCanvas.addEventListener("pointerdown", handleDrawPointerDown);
    drawingCanvas.addEventListener("pointermove", handleDrawPointerMove);
    drawingCanvas.addEventListener("pointerup", handleDrawPointerUp);
    drawingCanvas.addEventListener("pointercancel", handleDrawPointerUp);
    drawingCanvas.addEventListener("pointerleave", handleDrawPointerUp);
  }
  resizeDrawingCanvas();
}

function resizeDrawingCanvas() {
  if (!drawingCanvas) return;
  const { width, height } = getDocumentSize();
  if (drawingCanvas.width !== width || drawingCanvas.height !== height) {
    drawingCanvas.width = width;
    drawingCanvas.height = height;
    drawingCtx = drawingCanvas.getContext("2d");
    drawingCtx.lineCap = "round";
    drawingCtx.lineJoin = "round";
    redrawStrokes();
  }
}

function startDrawingResizeWatcher() {
  if (drawingResizeTimer) return;
  drawingResizeTimer = setInterval(resizeDrawingCanvas, 1500);
}

function stopDrawingResizeWatcher() {
  if (drawingResizeTimer) {
    clearInterval(drawingResizeTimer);
    drawingResizeTimer = null;
  }
}

function redrawStrokes() {
  if (!drawingCtx || !drawingCanvas) return;
  drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  drawingStrokes.forEach((stroke) => {
    if (!stroke.points.length) return;
    drawingCtx.strokeStyle = stroke.color;
    drawingCtx.lineWidth = stroke.width;
    drawingCtx.beginPath();
    drawingCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      drawingCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    drawingCtx.stroke();
  });
}

function handleDrawPointerDown(event) {
  if (!state.drawingEnabled) return;
  event.preventDefault();
  drawingCanvas.setPointerCapture(event.pointerId);
  activeStroke = {
    color: "#fbbf24",
    width: 3,
    points: [{ x: event.pageX, y: event.pageY }]
  };
  drawingStrokes.push(activeStroke);
}

function handleDrawPointerMove(event) {
  if (!state.drawingEnabled || !activeStroke) return;
  event.preventDefault();
  const lastPoint = activeStroke.points[activeStroke.points.length - 1];
  const point = { x: event.pageX, y: event.pageY };
  activeStroke.points.push(point);
  drawingCtx.strokeStyle = activeStroke.color;
  drawingCtx.lineWidth = activeStroke.width;
  drawingCtx.beginPath();
  drawingCtx.moveTo(lastPoint.x, lastPoint.y);
  drawingCtx.lineTo(point.x, point.y);
  drawingCtx.stroke();
}

function handleDrawPointerUp(event) {
  if (!activeStroke) return;
  event.preventDefault();
  activeStroke = null;
}

function applyDrawingMode(enabled) {
  ensureDrawingCanvas();
  drawingCanvas.style.pointerEvents = enabled ? "auto" : "none";
  if (enabled) {
    startDrawingResizeWatcher();
  } else {
    stopDrawingResizeWatcher();
  }
}

function clearDrawings() {
  drawingStrokes = [];
  if (drawingCtx && drawingCanvas) {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
}

function ensureColorFilters() {
  if (document.getElementById("aqual-color-filters")) {
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "aqual-color-filters");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.pointerEvents = "none";
  svg.innerHTML = `
    <filter id="aqual-cb-protanopia">
      <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
    </filter>
    <filter id="aqual-cb-deuteranopia">
      <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
    </filter>
    <filter id="aqual-cb-tritanopia">
      <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
    </filter>
  `;
  (document.body || document.documentElement).appendChild(svg);
}

function updateRootFilter(settings) {
  const parts = [];
  if (settings.highContrastEnabled) {
    parts.push("contrast(1.45) saturate(1.05)");
  }
  if (settings.colorBlindMode && settings.colorBlindMode !== "none") {
    ensureColorFilters();
    parts.push(`url(#aqual-cb-${settings.colorBlindMode})`);
  }

  if (parts.length > 0) {
    document.documentElement.classList.add("aqual-filter-root");
    document.documentElement.style.setProperty("--aqual-filter", parts.join(" "));
  } else {
    document.documentElement.classList.remove("aqual-filter-root");
    document.documentElement.style.removeProperty("--aqual-filter");
  }
}

function buildPlaceholder(width, height, altText) {
  const safeWidth = Math.max(24, Math.round(width || 120));
  const safeHeight = Math.max(24, Math.round(height || 80));
  const label = (altText && altText.trim() ? altText.trim() : "Image").slice(0, 80);
  const fontSize = Math.max(12, Math.min(20, Math.round(safeWidth / 8)));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${safeWidth}' height='${safeHeight}'>` +
    `<rect width='100%' height='100%' fill='%23f1f5f9'/>` +
    `<text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-size='${fontSize}' font-family='sans-serif' fill='%2364748b'>${label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function veilPictureSources(img) {
  const picture = img && img.parentElement && img.parentElement.tagName.toLowerCase() === "picture"
    ? img.parentElement
    : null;
  if (!picture) return;
  const sources = picture.querySelectorAll("source");
  sources.forEach(veilSourceElement);
}

function veilSourceElement(source) {
  if (!source || source.dataset.aqualVeil === "1") return;
  source.dataset.aqualVeil = "1";
  source.dataset.aqualSrcset = source.getAttribute("srcset") || "";
  source.dataset.aqualSizes = source.getAttribute("sizes") || "";
  source.removeAttribute("srcset");
  source.removeAttribute("sizes");
}

function restorePictureSources(img) {
  const picture = img && img.parentElement && img.parentElement.tagName.toLowerCase() === "picture"
    ? img.parentElement
    : null;
  if (!picture) return;
  const sources = picture.querySelectorAll("source");
  sources.forEach((source) => {
    if (source.dataset.aqualVeil !== "1") return;
    const srcset = source.dataset.aqualSrcset || "";
    const sizes = source.dataset.aqualSizes || "";
    if (srcset) {
      source.setAttribute("srcset", srcset);
    }
    if (sizes) {
      source.setAttribute("sizes", sizes);
    }
    delete source.dataset.aqualVeil;
    delete source.dataset.aqualSrcset;
    delete source.dataset.aqualSizes;
  });
}

function veilImage(img) {
  if (!img || img.dataset.aqualVeil === "1") {
    return;
  }
  const rect = img.getBoundingClientRect();
  const width = rect.width || img.width || img.naturalWidth || 120;
  const height = rect.height || img.height || img.naturalHeight || 80;
  img.dataset.aqualVeil = "1";
  img.dataset.aqualSrc = img.currentSrc || img.src || "";
  img.dataset.aqualSrcset = img.getAttribute("srcset") || "";
  img.dataset.aqualSizes = img.getAttribute("sizes") || "";
  veilPictureSources(img);
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.src = buildPlaceholder(width, height, img.alt);
}

function restoreImage(img) {
  if (!img || img.dataset.aqualVeil !== "1") {
    return;
  }
  const originalSrc = img.dataset.aqualSrc;
  const originalSrcset = img.dataset.aqualSrcset;
  const originalSizes = img.dataset.aqualSizes;
  if (originalSrc) {
    img.src = originalSrc;
  }
  if (originalSrcset) {
    img.setAttribute("srcset", originalSrcset);
  }
  if (originalSizes) {
    img.setAttribute("sizes", originalSizes);
  }
  restorePictureSources(img);
  delete img.dataset.aqualVeil;
  delete img.dataset.aqualSrc;
  delete img.dataset.aqualSrcset;
  delete img.dataset.aqualSizes;
}

function applyImageVeil(enabled) {
  const images = Array.from(document.images || []);
  if (enabled) {
    images.forEach(veilImage);
    startVeilAttributeObserver();
    if (!imageObserver) {
      imageObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.tagName && node.tagName.toLowerCase() === "img") {
              veilImage(node);
            }
            if (node.tagName && node.tagName.toLowerCase() === "source") {
              veilSourceElement(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll("img").forEach(veilImage);
              node.querySelectorAll("source").forEach(veilSourceElement);
            }
          });
        });
      });
      imageObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  } else {
    images.forEach(restoreImage);
    stopVeilAttributeObserver();
    if (imageObserver) {
      imageObserver.disconnect();
      imageObserver = null;
    }
  }
}

function startVeilAttributeObserver() {
  if (veilAttributeObserver) return;
  veilAttributeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type !== "attributes") return;
      const target = mutation.target;
      if (!target || !state.imageVeilEnabled) return;

      const tag = target.tagName.toLowerCase();
      if (tag === "source") {
        if (target.dataset.aqualVeil !== "1") return;
        const srcset = target.getAttribute("srcset");
        if (!srcset) return;
        target.dataset.aqualSrcset = srcset;
        target.dataset.aqualSizes = target.getAttribute("sizes") || "";
        target.removeAttribute("srcset");
        target.removeAttribute("sizes");
        return;
      }

      if (tag !== "img") return;
      if (target.dataset.aqualVeil !== "1") return;

      const currentSrc = target.currentSrc || target.src || "";
      if (currentSrc.startsWith("data:image/svg+xml")) {
        return;
      }

      target.dataset.aqualSrc = currentSrc;
      target.dataset.aqualSrcset = target.getAttribute("srcset") || "";
      target.dataset.aqualSizes = target.getAttribute("sizes") || "";
      veilPictureSources(target);

      const rect = target.getBoundingClientRect();
      const width = rect.width || target.width || target.naturalWidth || 120;
      const height = rect.height || target.height || target.naturalHeight || 80;
      target.removeAttribute("srcset");
      target.removeAttribute("sizes");
      target.src = buildPlaceholder(width, height, target.alt);
    });
  });
  veilAttributeObserver.observe(document.body || document.documentElement, {
    attributes: true,
    attributeFilter: ["src", "srcset", "sizes"],
    subtree: true
  });
}

function stopVeilAttributeObserver() {
  if (veilAttributeObserver) {
    veilAttributeObserver.disconnect();
    veilAttributeObserver = null;
  }
}

function wrapWordsInElement(el) {
  if (!el || el.dataset.aqualWords === "1") {
    return;
  }
  if (el.closest("[contenteditable='true']")) {
    return;
  }
  el.dataset.aqualWords = "1";
  el.dataset.aqualOriginalHtml = el.innerHTML;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const parts = text.split(/(\s+)/);
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (!part) return;
      if (/\s+/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");
        span.className = "aqual-word";
        span.textContent = part;
        fragment.appendChild(span);
      }
    });
    textNode.parentNode.replaceChild(fragment, textNode);
  });

  highlightedElements.add(el);
}

function enableHighlight() {
  const targets = document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
  targets.forEach(wrapWordsInElement);
}

function disableHighlight() {
  highlightedElements.forEach((el) => {
    if (el && el.dataset.aqualOriginalHtml !== undefined) {
      el.innerHTML = el.dataset.aqualOriginalHtml;
      delete el.dataset.aqualOriginalHtml;
      delete el.dataset.aqualWords;
    }
  });
  highlightedElements.clear();
}

function toggleHighlight(enabled) {
  if (enabled) {
    enableHighlight();
  } else {
    disableHighlight();
  }
}

function applyLinkEmphasis(enabled) {
  const anchors = document.querySelectorAll("a");
  if (enabled) {
    anchors.forEach((anchor) => anchor.classList.add("aqual-link-emphasis"));
    if (!linkObserver) {
      linkObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.tagName && node.tagName.toLowerCase() === "a") {
              node.classList.add("aqual-link-emphasis");
            }
            if (node.querySelectorAll) {
              node.querySelectorAll("a").forEach((a) => a.classList.add("aqual-link-emphasis"));
            }
          });
        });
      });
      linkObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  } else {
    anchors.forEach((anchor) => anchor.classList.remove("aqual-link-emphasis"));
    if (linkObserver) {
      linkObserver.disconnect();
      linkObserver = null;
    }
  }
}

function ensureMagnifierLens() {
  if (magnifierLens) return;
  magnifierLens = document.createElement("div");
  magnifierLens.className = "aqual-magnifier-lens";
  document.body.appendChild(magnifierLens);
}

function hideMagnifierLens() {
  if (magnifierLens) {
    magnifierLens.style.display = "none";
  }
}

function updateMagnifier(e) {
  if (!magnifierActive || !currentImage || !magnifierLens) return;
  const rect = currentImage.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
    hideMagnifierLens();
    return;
  }

  const size = magnifierSize;
  magnifierLens.style.width = `${size}px`;
  magnifierLens.style.height = `${size}px`;

  const backgroundSize = `${rect.width * magnifierZoom}px ${rect.height * magnifierZoom}px`;
  magnifierLens.style.backgroundSize = backgroundSize;
  magnifierLens.style.backgroundImage = `url('${currentImage.currentSrc || currentImage.src}')`;

  const bgX = x * magnifierZoom - size / 2;
  const bgY = y * magnifierZoom - size / 2;
  magnifierLens.style.backgroundPosition = `-${bgX}px -${bgY}px`;

  magnifierLens.style.left = `${e.pageX - size / 2}px`;
  magnifierLens.style.top = `${e.pageY - size / 2}px`;
  magnifierLens.style.display = "block";
}

function handleMouseOver(e) {
  if (!magnifierActive) return;
  const target = e.target;
  if (target && target.tagName && target.tagName.toLowerCase() === "img") {
    currentImage = target;
    ensureMagnifierLens();
  }
}

function handleMouseMove(e) {
  if (!magnifierActive) return;
  if (!currentImage) return;
  updateMagnifier(e);
}

function handleMouseOut(e) {
  if (!magnifierActive) return;
  const target = e.target;
  if (currentImage && target === currentImage) {
    currentImage = null;
    hideMagnifierLens();
  }
}

function applyMagnifier(enabled, size, zoom) {
  magnifierActive = Boolean(enabled);
  magnifierSize = Number(size) || DEFAULTS.magnifierSize;
  magnifierZoom = Number(zoom) || DEFAULTS.magnifierZoom;

  if (magnifierActive) {
    ensureMagnifierLens();
    if (!magnifierListenersBound) {
      document.addEventListener("mouseover", handleMouseOver, true);
      document.addEventListener("mousemove", handleMouseMove, true);
      document.addEventListener("mouseout", handleMouseOut, true);
      magnifierListenersBound = true;
    }
  } else {
    if (magnifierListenersBound) {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      magnifierListenersBound = false;
    }
    currentImage = null;
    hideMagnifierLens();
  }
}

function applySettings(incoming) {
  if (isGoogleMapsUrl()) {
    resetAllVisualEffects();
    state = normalizeSettings(incoming);
    return;
  }

  const next = normalizeSettings(incoming);

  if (next.fontEnabled !== state.fontEnabled || next.fontFamily !== state.fontFamily) {
    applyFontFamily(next.fontEnabled, next.fontFamily);
  }

  if (next.fontSizeEnabled !== state.fontSizeEnabled || next.fontSizePx !== state.fontSizePx) {
    applyFontSize(next.fontSizeEnabled, next.fontSizePx);
  }

  if (next.fontColorEnabled !== state.fontColorEnabled || next.fontColor !== state.fontColor) {
    applyFontColor(next.fontColorEnabled, next.fontColor);
  }

  if (next.textStrokeEnabled !== state.textStrokeEnabled || next.textStrokeColor !== state.textStrokeColor) {
    applyTextStroke(next.textStrokeEnabled, next.textStrokeColor);
  }

  if (
    next.cursorEnabled !== state.cursorEnabled ||
    next.cursorType !== state.cursorType ||
    (next.cursorEnabled && next.highContrastEnabled !== state.highContrastEnabled)
  ) {
    applyCursor(next.cursorEnabled, next.cursorType, next.highContrastEnabled);
  }

  if (next.imageVeilEnabled !== state.imageVeilEnabled) {
    applyImageVeil(next.imageVeilEnabled);
  }

  if (next.highlightEnabled !== state.highlightEnabled) {
    toggleHighlight(next.highlightEnabled);
  }

  if (next.linkEmphasisEnabled !== state.linkEmphasisEnabled) {
    applyLinkEmphasis(next.linkEmphasisEnabled);
  }

  if (
    next.magnifierEnabled !== state.magnifierEnabled ||
    next.magnifierSize !== state.magnifierSize ||
    next.magnifierZoom !== state.magnifierZoom
  ) {
    applyMagnifier(next.magnifierEnabled, next.magnifierSize, next.magnifierZoom);
  }

  if (next.reducedCrowdingEnabled !== state.reducedCrowdingEnabled) {
    applyReducedCrowding(next.reducedCrowdingEnabled);
  }

  if (next.drawingEnabled !== state.drawingEnabled) {
    applyDrawingMode(next.drawingEnabled);
  }

  if (
    next.highContrastEnabled !== state.highContrastEnabled ||
    next.colorBlindMode !== state.colorBlindMode
  ) {
    updateRootFilter(next);
  }

  if (next.highContrastEnabled !== state.highContrastEnabled) {
    toggleHighContrast(next.highContrastEnabled);
  }

  if (next.nightModeEnabled !== state.nightModeEnabled) {
    toggleNightMode(next.nightModeEnabled);
  }

  if (
    next.dimmingEnabled !== state.dimmingEnabled ||
    next.dimmingLevel !== state.dimmingLevel
  ) {
    applyDimming(next.dimmingEnabled, next.dimmingLevel);
  }

  if (
    next.blueLightEnabled !== state.blueLightEnabled ||
    next.blueLightLevel !== state.blueLightLevel
  ) {
    applyBlueLight(next.blueLightEnabled, next.blueLightLevel);
  }

  if (next.lineGuideEnabled !== state.lineGuideEnabled) {
    setLineGuideEnabled(next.lineGuideEnabled);
  }

  state = next;
}

function isGoogleSearchHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.includes("google.");
}

function parseHttpUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const absolute = new URL(String(rawUrl).trim(), window.location.href);
    if (!/^https?:$/.test(absolute.protocol)) return "";
    return absolute.href;
  } catch (_error) {
    return "";
  }
}

function parseAbsoluteHttpUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(input)) return "";
  try {
    const absolute = new URL(input);
    if (!/^https?:$/.test(absolute.protocol)) return "";
    return absolute.href;
  } catch (_error) {
    return "";
  }
}

function tryDecodeURIComponent(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function extractExternalUrlFromGoogleHref(rawHref) {
  let current = parseHttpUrl(rawHref);
  if (!current) return "";

  const visited = new Set();
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || visited.has(current)) {
      break;
    }
    visited.add(current);

    const absolute = parseHttpUrl(current);
    if (!absolute) break;

    let parsed;
    try {
      parsed = new URL(absolute);
    } catch (_error) {
      break;
    }

    if (!isGoogleSearchHost(parsed.hostname)) {
      return parsed.href;
    }

    const redirectParams = [
      "continue",
      "url",
      "q",
      "imgrefurl",
      "imgurl",
      "adurl",
      "u",
      "dest",
      "destination"
    ];

    let nextUrl = "";
    for (let i = 0; i < redirectParams.length; i += 1) {
      const value = parsed.searchParams.get(redirectParams[i]) || "";
      if (!value) continue;
      const decoded = tryDecodeURIComponent(value);
      const resolved = parseAbsoluteHttpUrl(decoded) || parseAbsoluteHttpUrl(value);
      if (resolved) {
        nextUrl = resolved;
        break;
      }
    }

    if (!nextUrl) {
      break;
    }

    current = nextUrl;
  }

  return "";
}

function addGoogleSearchCandidate(rawUrl, label, seen, candidates) {
  const targetUrl = extractExternalUrlFromGoogleHref(rawUrl);
  if (!targetUrl || seen.has(targetUrl)) return false;

  let domain = "";
  try {
    domain = new URL(targetUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_error) {
    return false;
  }
  if (!domain) return false;

  candidates.push({
    url: targetUrl,
    domain,
    label: String(label || "").trim().toLowerCase()
  });
  seen.add(targetUrl);
  return true;
}

function getAnchorRawHref(anchor) {
  if (!anchor || !anchor.getAttribute) return "";
  const attrHref = String(anchor.getAttribute("href") || "").trim();
  if (attrHref) {
    if (/^https?:\/\//i.test(attrHref)) {
      return attrHref;
    }
    if (attrHref.startsWith("/")) {
      return `${window.location.origin}${attrHref}`;
    }
  }
  return String(anchor && anchor.href ? anchor.href : "");
}

function collectGoogleAnchorsFromResultCard(card) {
  const ordered = [];
  if (!card || !card.querySelectorAll) return ordered;

  card.querySelectorAll("h3.LC20lb, h3").forEach((heading) => {
    const anchor = heading.closest("a[href]");
    if (anchor) ordered.push(anchor);
  });

  const primarySelectors = [
    "a.zReHs[href]",
    "a.rIRoqf[href]",
    "a.B4Fhld[href]",
    "a.nNd3yc[href]"
  ];
  primarySelectors.forEach((selector) => {
    card.querySelectorAll(selector).forEach((anchor) => {
      ordered.push(anchor);
    });
  });

  card.querySelectorAll("a[href]").forEach((anchor) => {
    ordered.push(anchor);
  });

  return ordered;
}

function collectGoogleSearchResultCandidates() {
  const root = document.querySelector("#rso") || document.querySelector("#search") || document.body;
  const seen = new Set();
  const candidates = [];

  // Hard priority for Google video-result anchors:
  // <a class="zReHs" href="https://..."><h3 class="LC20lb">...</h3></a>
  // If these exist, use only these so index mapping matches what users see.
  const strictVideoAnchors = root.querySelectorAll("a.zReHs[href]");
  if (strictVideoAnchors && strictVideoAnchors.length) {
    strictVideoAnchors.forEach((anchor) => {
      if (!anchor || anchor.closest("#top_nav, #hdtb, #appbar, #searchform, #foot")) return;
      const heading = anchor.querySelector("h3.LC20lb, h3");
      const label = (heading && heading.textContent ? heading.textContent : (anchor.getAttribute("aria-label") || anchor.textContent || "")).trim().toLowerCase();
      const rawHref = getAnchorRawHref(anchor);
      addGoogleSearchCandidate(rawHref, label, seen, candidates);
    });
    if (candidates.length) {
      return candidates;
    }
  }

  const resultCards = root.querySelectorAll(".MjjYud, .PmEWq, [data-cid], .g, .Gx5Zad");
  resultCards.forEach((card) => {
    if (!card || !card.querySelector) return;
    if (card.closest("#top_nav, #hdtb, #appbar, #searchform, #foot")) return;

    const heading = card.querySelector("h3.LC20lb, h3");
    const headingLabel = (heading && heading.textContent ? heading.textContent : "").trim().toLowerCase();
    let cardAdded = false;

    const cardAnchors = collectGoogleAnchorsFromResultCard(card);
    for (let i = 0; i < cardAnchors.length; i += 1) {
      const anchor = cardAnchors[i];
      if (!anchor || !anchor.href) continue;
      const label = headingLabel || (anchor.getAttribute("aria-label") || anchor.textContent || "");
      const rawHref = getAnchorRawHref(anchor);
      const added = addGoogleSearchCandidate(rawHref, label, seen, candidates);
      if (added) {
        cardAdded = true;
        break;
      }
    }

    if (!cardAdded) {
      const urlNode = card.querySelector("[data-surl], [data-curl]");
      if (urlNode) {
        const rawUrl = urlNode.getAttribute("data-surl") || urlNode.getAttribute("data-curl") || "";
        addGoogleSearchCandidate(rawUrl, headingLabel, seen, candidates);
      }
    }
  });

  // Fallback for unexpected layouts.
  const fallbackAnchors = [];
  root.querySelectorAll("h3.LC20lb, h3").forEach((heading) => {
    const anchor = heading.closest("a[href]");
    if (anchor) {
      fallbackAnchors.push(anchor);
    }
  });
  root.querySelectorAll("a h3").forEach((heading) => {
    const anchor = heading.closest("a[href]");
    if (anchor) {
      fallbackAnchors.push(anchor);
    }
  });
  root.querySelectorAll("a[href]").forEach((anchor) => {
    fallbackAnchors.push(anchor);
  });

  for (let i = 0; i < fallbackAnchors.length; i += 1) {
    const anchor = fallbackAnchors[i];
    if (!anchor || !anchor.href) continue;
    if (anchor.closest("#top_nav, #hdtb, #appbar, #searchform, #foot")) continue;
    const label = (anchor.getAttribute("aria-label") || anchor.textContent || "").trim().toLowerCase();
    const rawHref = getAnchorRawHref(anchor);
    addGoogleSearchCandidate(rawHref, label, seen, candidates);
  }

  return candidates;
}

function collapseSearchToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getDomainStem(domain) {
  const raw = String(domain || "").toLowerCase().replace(/^www\./, "");
  return collapseSearchToken(raw.split(".")[0] || raw);
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const matrix = Array.from({ length: left.length + 1 }, () => []);
  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function similarityScore(a, b) {
  const left = collapseSearchToken(a);
  const right = collapseSearchToken(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return 0.86 + (0.14 * ratio);
  }
  const distance = levenshteinDistance(left, right);
  const base = 1 - (distance / Math.max(left.length, right.length));
  return Math.max(0, base);
}

function resolveGoogleSearchResultFromPayload(payload) {
  const candidates = collectGoogleSearchResultCandidates();
  if (!candidates.length) {
    return { ok: false, error: "No Google results found on page." };
  }

  const domainKeywordRaw = (payload && payload.domainKeyword ? String(payload.domainKeyword) : "").toLowerCase().trim();
  if (domainKeywordRaw) {
    const forceDomainMatch = Boolean(payload && payload.forceDomainMatch);
    const collapsedKeyword = domainKeywordRaw.replace(/[^a-z0-9.-]/g, "");
    const tokenKeywords = domainKeywordRaw
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9.-]/g, ""))
      .filter((token) => token.length >= 2);

    const match = candidates.find((candidate) => {
      const domainCollapsed = candidate.domain.replace(/[^a-z0-9.-]/g, "");
      const urlLower = candidate.url.toLowerCase();
      const labelCollapsed = candidate.label.replace(/[^a-z0-9.-]/g, "");
      if (collapsedKeyword && (domainCollapsed.includes(collapsedKeyword) || urlLower.includes(collapsedKeyword) || labelCollapsed.includes(collapsedKeyword))) {
        return true;
      }
      if (!tokenKeywords.length) return false;
      return tokenKeywords.every((token) => (
        domainCollapsed.includes(token)
        || urlLower.includes(token)
        || labelCollapsed.includes(token)
      ));
    });

    if (match) {
      return { ok: true, url: match.url, domain: match.domain };
    }

    let best = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const domainCollapsed = candidate.domain.replace(/[^a-z0-9.-]/g, "");
      const domainStem = getDomainStem(candidate.domain);
      const labelCollapsed = candidate.label.replace(/[^a-z0-9.-]/g, "");

      let score = Math.max(
        similarityScore(domainKeywordRaw, domainCollapsed),
        similarityScore(domainKeywordRaw, domainStem),
        similarityScore(domainKeywordRaw, labelCollapsed)
      );

      if (tokenKeywords.length) {
        let tokenHits = 0;
        for (let j = 0; j < tokenKeywords.length; j += 1) {
          const token = tokenKeywords[j];
          if (
            domainCollapsed.includes(token)
            || domainStem.includes(token)
            || labelCollapsed.includes(token)
            || candidate.url.toLowerCase().includes(token)
          ) {
            tokenHits += 1;
          }
        }
        score = Math.max(score, tokenHits / tokenKeywords.length);
      }

      if (!best || score > best.score) {
        best = {
          candidate,
          score
        };
      }
    }

    if (best && (forceDomainMatch || best.score >= 0.33)) {
      return {
        ok: true,
        url: best.candidate.url,
        domain: best.candidate.domain,
        similarity: Number(best.score.toFixed(3))
      };
    }

    return { ok: false, error: `No result matched "${domainKeywordRaw}".` };
  }

  let index = Number(payload && payload.index);
  if (!Number.isFinite(index) || index <= 0) {
    index = 1;
  }
  index = Math.floor(index);
  if (index > candidates.length) {
    index = candidates.length;
  }

  const chosen = candidates[index - 1];
  if (!chosen) {
    return { ok: false, error: "No matching result index." };
  }
  return {
    ok: true,
    url: chosen.url,
    domain: chosen.domain,
    index,
    total: candidates.length
  };
}

function isSkyscannerHost(hostname) {
  return String(hostname || "").toLowerCase().includes("skyscanner.");
}

function parseSkyscannerConfigUrl(rawUrl) {
  const absolute = parseHttpUrl(rawUrl);
  if (!absolute) return "";
  try {
    const parsed = new URL(absolute);
    if (!isSkyscannerHost(parsed.hostname)) return "";
    if (!parsed.pathname.includes("/transport/flights/")) return "";
    if (!parsed.pathname.includes("/config/")) return "";
    return parsed.href;
  } catch (_error) {
    return "";
  }
}

function normalizeClockTime(rawTime) {
  const match = String(rawTime || "").match(/([0-2]?\d)\s*[:.]\s*([0-5]\d)/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function extractDepartureTimeFromText(rawText) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const departingMatch = text.match(/departing(?:[^0-9]{0,160})at\s*([0-2]?\d[:.][0-5]\d)/i);
  if (departingMatch && departingMatch[1]) {
    const normalized = normalizeClockTime(departingMatch[1]);
    if (normalized) return normalized;
  }

  const anyTimes = text.match(/\b([0-2]?\d[:.][0-5]\d)\b/g);
  if (anyTimes && anyTimes.length) {
    return normalizeClockTime(anyTimes[0]);
  }
  return "";
}

function collectSkyscannerFlightCandidates() {
  const anchors = document.querySelectorAll("a[href*='/transport/flights/'][href*='/config/']");
  const seen = new Set();
  const candidates = [];

  anchors.forEach((anchor) => {
    if (!anchor || !anchor.getAttribute) return;
    if (anchor.closest("[data-testid='PricingItem']")) return;

    const configUrl = parseSkyscannerConfigUrl(getAnchorRawHref(anchor));
    if (!configUrl || seen.has(configUrl)) return;
    seen.add(configUrl);

    const ticket = anchor.closest("[data-testid='ticket']") || anchor.closest("article") || anchor.closest("li");
    const combinedText = [
      anchor.getAttribute("aria-label") || "",
      anchor.textContent || "",
      ticket && ticket.getAttribute ? (ticket.getAttribute("aria-label") || "") : "",
      ticket && ticket.textContent ? ticket.textContent : ""
    ].join(" ").replace(/\s+/g, " ").trim();

    const optionMatch = combinedText.match(/\bflight option\s+(\d+)\b/i);
    const optionIndex = optionMatch ? Number(optionMatch[1]) : null;
    const departureTime = extractDepartureTimeFromText(combinedText);

    candidates.push({
      url: configUrl,
      departureTime,
      optionIndex: Number.isFinite(optionIndex) ? optionIndex : null
    });
  });

  return candidates;
}

function resolveSkyscannerFlightFromPayload(payload) {
  const candidates = collectSkyscannerFlightCandidates();
  if (!candidates.length) {
    return { ok: false, error: "No Skyscanner flight results were found on this page." };
  }

  const requestedTime = normalizeClockTime(payload && payload.departureTime);
  if (requestedTime) {
    const compactTime = requestedTime.replace(":", "");
    const timed = candidates.find((candidate) => (
      candidate.departureTime === requestedTime
      || String(candidate.url || "").includes(compactTime)
    ));
    if (timed) {
      return {
        ok: true,
        url: timed.url,
        departureTime: requestedTime
      };
    }
    return { ok: false, error: `No flight departing at ${requestedTime} was found.` };
  }

  let index = Number(payload && payload.index);
  if (!Number.isFinite(index) || index <= 0) {
    index = 1;
  }
  index = Math.floor(index);
  if (index > candidates.length) {
    index = candidates.length;
  }

  const chosen = candidates[index - 1];
  if (!chosen) {
    return { ok: false, error: "No matching Skyscanner result index was found." };
  }
  return {
    ok: true,
    url: chosen.url,
    index,
    total: candidates.length
  };
}

function collectSkyscannerProviderCandidates() {
  const links = document.querySelectorAll(
    "a[data-testid='pricing-item-redirect-button'][href], a[aria-label^='Select '][href]"
  );
  const seen = new Set();
  const candidates = [];

  links.forEach((link, idx) => {
    const url = parseHttpUrl(getAnchorRawHref(link));
    if (!url || seen.has(url)) return;
    seen.add(url);

    const item = link.closest("[data-testid='PricingItem']") || link.closest("article") || link.closest("li");
    const providerTextNode = item ? item.querySelector("h3, p") : null;
    const providerName = String(providerTextNode && providerTextNode.textContent ? providerTextNode.textContent : "")
      .replace(/\s+/g, " ")
      .trim();
    const ariaName = String(link.getAttribute("aria-label") || "")
      .replace(/^select\s+/i, "")
      .replace(/[.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    let domain = "";
    try {
      domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch (_error) {
      domain = "";
    }

    candidates.push({
      url,
      domain,
      providerName: providerName || ariaName || "",
      label: `${providerName} ${ariaName}`.replace(/\s+/g, " ").trim().toLowerCase(),
      index: idx + 1
    });
  });

  return candidates;
}

function resolveSkyscannerProviderFromPayload(payload) {
  const candidates = collectSkyscannerProviderCandidates();
  if (!candidates.length) {
    return { ok: false, error: "No booking provider links were found on this page." };
  }

  const providerKeywordRaw = (payload && payload.providerKeyword ? String(payload.providerKeyword) : "").toLowerCase().trim();
  if (!providerKeywordRaw) {
    return { ok: false, error: "No provider keyword was provided." };
  }

  const collapsedKeyword = providerKeywordRaw.replace(/[^a-z0-9.-]/g, "");
  const tokenKeywords = providerKeywordRaw
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9.-]/g, ""))
    .filter((token) => token.length >= 2);

  const direct = candidates.find((candidate) => {
    const providerCollapsed = candidate.providerName.toLowerCase().replace(/[^a-z0-9.-]/g, "");
    const domainCollapsed = candidate.domain.replace(/[^a-z0-9.-]/g, "");
    const labelCollapsed = candidate.label.replace(/[^a-z0-9.-]/g, "");
    const urlLower = candidate.url.toLowerCase();
    if (
      collapsedKeyword
      && (
        providerCollapsed.includes(collapsedKeyword)
        || domainCollapsed.includes(collapsedKeyword)
        || labelCollapsed.includes(collapsedKeyword)
        || urlLower.includes(collapsedKeyword)
      )
    ) {
      return true;
    }
    if (!tokenKeywords.length) return false;
    return tokenKeywords.every((token) => (
      providerCollapsed.includes(token)
      || domainCollapsed.includes(token)
      || labelCollapsed.includes(token)
      || urlLower.includes(token)
    ));
  });

  if (direct) {
    return {
      ok: true,
      url: direct.url,
      provider: direct.providerName,
      domain: direct.domain
    };
  }

  let best = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const providerCollapsed = candidate.providerName.toLowerCase().replace(/[^a-z0-9.-]/g, "");
    const domainCollapsed = candidate.domain.replace(/[^a-z0-9.-]/g, "");
    const domainStem = getDomainStem(candidate.domain);
    const labelCollapsed = candidate.label.replace(/[^a-z0-9.-]/g, "");

    let score = Math.max(
      similarityScore(providerKeywordRaw, providerCollapsed),
      similarityScore(providerKeywordRaw, domainCollapsed),
      similarityScore(providerKeywordRaw, domainStem),
      similarityScore(providerKeywordRaw, labelCollapsed)
    );

    if (tokenKeywords.length) {
      let tokenHits = 0;
      for (let j = 0; j < tokenKeywords.length; j += 1) {
        const token = tokenKeywords[j];
        if (
          providerCollapsed.includes(token)
          || domainCollapsed.includes(token)
          || domainStem.includes(token)
          || labelCollapsed.includes(token)
          || candidate.url.toLowerCase().includes(token)
        ) {
          tokenHits += 1;
        }
      }
      score = Math.max(score, tokenHits / tokenKeywords.length);
    }

    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (best && best.score >= 0.28) {
    return {
      ok: true,
      url: best.candidate.url,
      provider: best.candidate.providerName,
      domain: best.candidate.domain,
      similarity: Number(best.score.toFixed(3))
    };
  }

  return { ok: false, error: `No provider matched "${providerKeywordRaw}".` };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
  if (message.type === "aqual-google-search-action") {
    if (window.top !== window) {
      return;
    }
    const payload = message.payload || {};
    if (payload.action === "resolve-result") {
      sendResponse(resolveGoogleSearchResultFromPayload(payload));
      return true;
    }
  }
  if (message.type === "aqual-skyscanner-action") {
    if (window.top !== window) {
      return;
    }
    const payload = message.payload || {};
    if (payload.action === "resolve-flight") {
      sendResponse(resolveSkyscannerFlightFromPayload(payload));
      return true;
    }
    if (payload.action === "resolve-provider") {
      sendResponse(resolveSkyscannerProviderFromPayload(payload));
      return true;
    }
  }
  if (message.type === "aqual-apply") {
    applySettings(message.settings || {});
  }
  if (message.type === "aqual-print") {
    window.print();
  }
  if (message.type === "aqual-clear-drawings") {
    clearDrawings();
  }
});

chrome.storage.sync.get(DEFAULTS, (stored) => {
  applySettings(stored || {});
});

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isImageAssistEvent(event) {
  if (!event || !event.composedPath) return false;
  const path = event.composedPath();
  return (captionHost && path.includes(captionHost)) || (chatHost && path.includes(chatHost));
}

function isDescribableImage(image) {
  if (!image || !image.tagName || image.tagName.toLowerCase() !== "img") return false;
  if (!image.isConnected) return false;
  const src = image.dataset.aqualVeil === "1"
    ? (image.dataset.aqualSrc || "")
    : (image.currentSrc || image.src || "");
  if (!src) return false;
  const rect = image.getBoundingClientRect();
  return rect.width >= 24 && rect.height >= 24;
}

function setShiftHoverImage(image) {
  if (shiftHoverImage === image) return;
  if (shiftHoverImage) {
    shiftHoverImage.classList.remove("aqual-image-shift-target");
  }
  shiftHoverImage = image;
  if (shiftHoverImage) {
    shiftHoverImage.classList.add("aqual-image-shift-target");
  }
}

function resolveImageSourceForAssist(image) {
  const raw = image.dataset.aqualVeil === "1"
    ? (image.dataset.aqualSrc || "")
    : (image.currentSrc || image.src || "");
  if (!raw) return "";
  try {
    return new URL(raw, window.location.href).href;
  } catch (_error) {
    return raw;
  }
}

function collectImageContextText(image) {
  const parts = [];
  const alt = (image.alt || "").trim();
  if (alt) parts.push(`Alt: ${alt}`);
  const aria = (image.getAttribute("aria-label") || "").trim();
  if (aria) parts.push(`ARIA: ${aria}`);
  const title = (image.title || "").trim();
  if (title) parts.push(`Title: ${title}`);

  const figure = image.closest("figure");
  if (figure) {
    const figcaption = figure.querySelector("figcaption");
    const captionText = (figcaption && figcaption.textContent ? figcaption.textContent : "").trim();
    if (captionText) parts.push(`Figure caption: ${captionText}`);
  }

  const linked = image.closest("a, button");
  if (linked) {
    const controlText = (linked.getAttribute("aria-label") || linked.textContent || "").trim();
    if (controlText) parts.push(`Control text: ${controlText}`);
  }

  return parts.join(" | ").slice(0, 700);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image blob"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Part = result.includes(",") ? result.split(",", 2)[1] : "";
      if (!base64Part) {
        reject(new Error("Failed to encode image"));
        return;
      }
      resolve(base64Part);
    };
    reader.readAsDataURL(blob);
  });
}

async function buildDescribedImagePayload(image) {
  const imageUrl = resolveImageSourceForAssist(image);
  if (!imageUrl) {
    throw new Error("Unable to find image source");
  }

  const payload = {
    altText: (image.alt || "").trim(),
    titleText: (image.title || "").trim(),
    contextText: collectImageContextText(image),
    pageUrl: window.location.href,
    pageTitle: document.title || ""
  };

  if (imageUrl.startsWith("blob:")) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error("Unable to read image blob");
    }
    const blob = await response.blob();
    payload.imageData = await blobToBase64(blob);
    payload.contentType = blob.type || "image/png";
  } else {
    payload.imageUrl = imageUrl;
  }

  return payload;
}

function ensureCaptionUi() {
  if (captionHost && captionEls) return;

  captionHost = document.createElement("div");
  captionHost.id = "aqual-image-caption-host";
  captionHost.style.position = "fixed";
  captionHost.style.left = "12px";
  captionHost.style.top = "12px";
  captionHost.style.width = "320px";
  captionHost.style.maxWidth = "min(92vw, 420px)";
  captionHost.style.zIndex = "2147483647";
  captionHost.style.display = "none";

  const shadow = captionHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .card {
        background: rgba(9, 15, 27, 0.95);
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 14px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
        padding: 10px 12px;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .title {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: #cbd5e1;
      }
      .close {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0;
      }
      .close:hover {
        color: #f8fafc;
      }
      .desc {
        margin-top: 8px;
        font-size: 13px;
        line-height: 1.4;
        color: #e2e8f0;
        max-height: 170px;
        overflow: auto;
        white-space: pre-wrap;
      }
      .ask {
        margin-top: 8px;
        border: 0;
        border-radius: 999px;
        background: #1d4ed8;
        color: #ffffff;
        padding: 4px 9px;
        font-size: 11px;
        cursor: pointer;
      }
      .ask[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
      }
    </style>
    <div class="card" role="dialog" aria-live="polite" aria-label="Image description">
      <div class="head">
        <span class="title">Image Description</span>
        <button id="closeBtn" class="close" type="button" aria-label="Close image description">&times;</button>
      </div>
      <div id="descText" class="desc"></div>
      <button id="askBtn" class="ask" type="button" disabled>Ask follow-up</button>
    </div>
  `;

  captionEls = {
    closeBtn: shadow.getElementById("closeBtn"),
    descText: shadow.getElementById("descText"),
    askBtn: shadow.getElementById("askBtn")
  };

  captionEls.closeBtn.addEventListener("click", () => {
    captionHost.style.display = "none";
    closeChatUi(true);
  });

  captionEls.askBtn.addEventListener("click", () => {
    openChatUi();
  });

  (document.body || document.documentElement).appendChild(captionHost);
}

function ensureChatUi() {
  if (chatHost && chatEls) return;

  chatHost = document.createElement("div");
  chatHost.id = "aqual-image-chat-host";
  chatHost.style.position = "fixed";
  chatHost.style.right = "16px";
  chatHost.style.bottom = "16px";
  chatHost.style.width = "340px";
  chatHost.style.height = "290px";
  chatHost.style.minWidth = "260px";
  chatHost.style.minHeight = "220px";
  chatHost.style.maxWidth = "min(90vw, 680px)";
  chatHost.style.maxHeight = "min(80vh, 760px)";
  chatHost.style.resize = "both";
  chatHost.style.overflow = "hidden";
  chatHost.style.zIndex = "2147483647";
  chatHost.style.display = "none";

  const shadow = chatHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .box {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: rgba(10, 14, 24, 0.97);
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(15, 23, 42, 0.95);
        border-bottom: 1px solid rgba(148, 163, 184, 0.24);
        cursor: move;
        user-select: none;
      }
      .title {
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .close {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0;
      }
      .close:hover {
        color: #f8fafc;
      }
      .messages {
        flex: 1;
        overflow: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .msg {
        max-width: 88%;
        padding: 8px 10px;
        border-radius: 12px;
        font-size: 12px;
        line-height: 1.4;
        white-space: pre-wrap;
      }
      .msg.user {
        align-self: flex-end;
        background: #2563eb;
        color: #ffffff;
      }
      .msg.assistant {
        align-self: flex-start;
        background: #1f2937;
        color: #e2e8f0;
      }
      .msg.pending {
        opacity: 0.7;
      }
      .composer {
        display: flex;
        gap: 8px;
        padding: 10px;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(2, 6, 23, 0.82);
      }
      textarea {
        flex: 1;
        resize: none;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 8px;
        font-size: 12px;
        color: #e2e8f0;
        background: #0f172a;
        min-height: 36px;
        max-height: 120px;
      }
      textarea:focus {
        outline: 1px solid #3b82f6;
      }
      button.send {
        border: 0;
        border-radius: 10px;
        background: #1d4ed8;
        color: #ffffff;
        font-size: 12px;
        padding: 0 12px;
        cursor: pointer;
      }
      button.send:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    </style>
    <div class="box" role="dialog" aria-label="Image follow-up chat">
      <div id="dragHandle" class="head">
        <span class="title">Image Follow-up</span>
        <button id="closeBtn" class="close" type="button" aria-label="Close image follow-up">&times;</button>
      </div>
      <div id="messages" class="messages"></div>
      <form id="chatForm" class="composer">
        <textarea id="chatInput" placeholder="Ask about this image..." aria-label="Ask about this image"></textarea>
        <button id="sendBtn" class="send" type="submit">Send</button>
      </form>
    </div>
  `;

  chatEls = {
    closeBtn: shadow.getElementById("closeBtn"),
    dragHandle: shadow.getElementById("dragHandle"),
    messages: shadow.getElementById("messages"),
    chatForm: shadow.getElementById("chatForm"),
    chatInput: shadow.getElementById("chatInput"),
    sendBtn: shadow.getElementById("sendBtn")
  };

  chatEls.closeBtn.addEventListener("click", () => closeChatUi(false));
  chatEls.chatForm.addEventListener("submit", submitChatFollowUp);
  chatEls.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatEls.chatForm.requestSubmit();
    }
  });

  chatEls.dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest("button")) return;

    const rect = chatHost.getBoundingClientRect();
    chatHost.style.left = `${Math.round(rect.left)}px`;
    chatHost.style.top = `${Math.round(rect.top)}px`;
    chatHost.style.right = "auto";
    chatHost.style.bottom = "auto";

    chatDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    };
    previousUserSelect = document.documentElement.style.userSelect;
    document.documentElement.style.userSelect = "none";
    chatEls.dragHandle.setPointerCapture(event.pointerId);
  });

  chatEls.dragHandle.addEventListener("pointermove", (event) => {
    if (!chatDrag || event.pointerId !== chatDrag.pointerId) return;
    event.preventDefault();
    const width = chatHost.offsetWidth;
    const height = chatHost.offsetHeight;
    const nextLeft = chatDrag.left + (event.clientX - chatDrag.startX);
    const nextTop = chatDrag.top + (event.clientY - chatDrag.startY);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    chatHost.style.left = `${Math.round(clampNumber(nextLeft, 8, maxLeft))}px`;
    chatHost.style.top = `${Math.round(clampNumber(nextTop, 8, maxTop))}px`;
  });

  const stopDrag = (event) => {
    if (!chatDrag || event.pointerId !== chatDrag.pointerId) return;
    chatEls.dragHandle.releasePointerCapture(event.pointerId);
    chatDrag = null;
    document.documentElement.style.userSelect = previousUserSelect || "";
    previousUserSelect = "";
  };
  chatEls.dragHandle.addEventListener("pointerup", stopDrag);
  chatEls.dragHandle.addEventListener("pointercancel", stopDrag);

  (document.body || document.documentElement).appendChild(chatHost);
}

function closeChatUi(resetHistory) {
  if (chatHost) {
    chatHost.style.display = "none";
  }
  chatInFlight = false;
  if (chatEls) {
    chatEls.sendBtn.disabled = false;
  }
  if (resetHistory) {
    chatHistory = [];
    if (chatEls) {
      chatEls.messages.innerHTML = "";
      chatEls.chatInput.value = "";
    }
  }
}

function appendChatMessage(role, text, pending) {
  if (!chatEls) return null;
  const message = document.createElement("div");
  message.className = `msg ${role}${pending ? " pending" : ""}`;
  message.textContent = text;
  chatEls.messages.appendChild(message);
  chatEls.messages.scrollTop = chatEls.messages.scrollHeight;
  return message;
}

async function fetchJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }

  if (!response.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Request failed (${response.status})`);
  }
  return data;
}

function requestCaptionReposition() {
  if (captionRepositionRaf !== null) return;
  captionRepositionRaf = requestAnimationFrame(() => {
    captionRepositionRaf = null;
    if (!captionHost || captionHost.style.display === "none") return;
    if (!describedImage || !describedImage.isConnected) {
      captionHost.style.display = "none";
      closeChatUi(true);
      return;
    }

    const rect = describedImage.getBoundingClientRect();
    const width = clampNumber(Math.round(rect.width), 260, 420);
    captionHost.style.width = `${width}px`;
    const cardRect = captionHost.getBoundingClientRect();

    let left = clampNumber(rect.left, 8, Math.max(8, window.innerWidth - cardRect.width - 8));
    let top = rect.bottom + 10;
    if (top + cardRect.height > window.innerHeight - 8) {
      top = rect.top - cardRect.height - 10;
    }
    top = clampNumber(top, 8, Math.max(8, window.innerHeight - cardRect.height - 8));

    captionHost.style.left = `${Math.round(left)}px`;
    captionHost.style.top = `${Math.round(top)}px`;
  });
}

function showCaptionLoading() {
  ensureCaptionUi();
  captionEls.descText.textContent = "Describing image...";
  captionEls.askBtn.disabled = true;
  captionHost.style.display = "block";
  requestCaptionReposition();
}

function showCaptionError(message) {
  ensureCaptionUi();
  captionEls.descText.textContent = message;
  captionEls.askBtn.disabled = true;
  captionHost.style.display = "block";
  requestCaptionReposition();
}

function showCaptionDescription(description) {
  ensureCaptionUi();
  captionEls.descText.textContent = description;
  captionEls.askBtn.disabled = false;
  captionHost.style.display = "block";
  requestCaptionReposition();
}

function openChatUi() {
  if (!describedImagePayload || !describedImageText) return;
  ensureChatUi();
  chatHost.style.display = "block";
  if (!chatHistory.length && chatEls.messages.children.length === 0) {
    appendChatMessage("assistant", "Ask anything specific about this image.", false);
  }
  chatEls.chatInput.focus();
}

async function describeImageFromPage(image) {
  describedImage = image;
  describedImagePayload = null;
  describedImageText = "";
  chatHistory = [];
  closeChatUi(true);
  showCaptionLoading();

  const requestId = ++describeRequestSerial;
  try {
    const payload = await buildDescribedImagePayload(image);
    const data = await fetchJson(`${DOC_SERVER_BASE}/describe-web-image`, payload);
    if (requestId !== describeRequestSerial) return;

    describedImagePayload = payload;
    describedImageText = (data.description || "").trim();
    if (!describedImageText) {
      throw new Error("No description returned");
    }
    showCaptionDescription(describedImageText);
  } catch (error) {
    if (requestId !== describeRequestSerial) return;
    showCaptionError(`Couldn't describe this image: ${error.message}`);
  }
}

async function askFollowUpAboutImage(question, history) {
  if (!describedImagePayload) {
    throw new Error("No active image context");
  }
  const payload = {
    ...describedImagePayload,
    question,
    description: describedImageText,
    history
  };
  const data = await fetchJson(`${DOC_SERVER_BASE}/ask-web-image`, payload);
  const answer = (data.answer || "").trim();
  if (!answer) {
    throw new Error("No answer returned");
  }
  return answer;
}

async function submitChatFollowUp(event) {
  event.preventDefault();
  if (!chatEls || chatInFlight) return;

  const question = (chatEls.chatInput.value || "").trim();
  if (!question) return;

  chatEls.chatInput.value = "";
  appendChatMessage("user", question, false);
  const pending = appendChatMessage("assistant", "Thinking...", true);
  chatInFlight = true;
  chatEls.sendBtn.disabled = true;

  const historyForRequest = [...chatHistory, { role: "user", content: question }];
  try {
    const answer = await askFollowUpAboutImage(question, historyForRequest);
    if (pending) {
      pending.textContent = answer;
      pending.classList.remove("pending");
    }
    chatHistory = [...historyForRequest, { role: "assistant", content: answer }];
  } catch (error) {
    if (pending) {
      pending.textContent = `Sorry, I couldn't answer that: ${error.message}`;
      pending.classList.remove("pending");
    }
  } finally {
    chatInFlight = false;
    chatEls.sendBtn.disabled = false;
    chatEls.messages.scrollTop = chatEls.messages.scrollHeight;
  }
}

function handleShiftImageHover(event) {
  if (!shiftPressed || isImageAssistEvent(event)) {
    setShiftHoverImage(null);
    return;
  }
  const target = event.target;
  const image = target && target.closest ? target.closest("img") : null;
  setShiftHoverImage(isDescribableImage(image) ? image : null);
}

function handleShiftImageClick(event) {
  if (event.button !== 0 || !event.shiftKey || isImageAssistEvent(event)) return;
  const target = event.target;
  const image = target && target.closest ? target.closest("img") : null;
  if (!isDescribableImage(image)) return;

  event.preventDefault();
  event.stopPropagation();
  setShiftHoverImage(null);
  describeImageFromPage(image);
}

function initializeImageAssist() {
  window.addEventListener("scroll", requestCaptionReposition, true);
  window.addEventListener("resize", requestCaptionReposition, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Shift") {
      shiftPressed = true;
    }
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift") {
      shiftPressed = false;
      setShiftHoverImage(null);
    }
  }, true);

  document.addEventListener("mousemove", handleShiftImageHover, true);
  document.addEventListener("click", handleShiftImageClick, true);
}

initializeImageAssist();

function ensureLineGuideOverlay() {
  if (lineGuideOverlay && lineGuideOverlay.isConnected) return lineGuideOverlay;
  lineGuideOverlay = document.createElement("div");
  lineGuideOverlay.className = "aqual-line-guide-overlay";
  lineGuideOverlay.style.opacity = "0";
  (document.body || document.documentElement).appendChild(lineGuideOverlay);
  return lineGuideOverlay;
}

function requestLineGuidePaint() {
  if (!lineGuideEnabled) return;
  if (lineGuideRaf !== null) return;
  lineGuideRaf = requestAnimationFrame(() => {
    lineGuideRaf = null;
    if (!lineGuideEnabled) return;
    const overlay = ensureLineGuideOverlay();
    const nextY = clampNumber(
      Math.round(lineGuideY - (overlay.offsetHeight / 2)),
      0,
      Math.max(0, window.innerHeight - overlay.offsetHeight)
    );
    overlay.style.transform = `translateY(${nextY}px)`;
    overlay.style.opacity = "1";
  });
}

function setLineGuideEnabled(enabled) {
  lineGuideEnabled = Boolean(enabled);
  const overlay = ensureLineGuideOverlay();
  if (!lineGuideEnabled) {
    overlay.style.opacity = "0";
    return;
  }
  lineGuideY = clampNumber(lineGuideY || (window.innerHeight * 0.35), 0, window.innerHeight);
  requestLineGuidePaint();
}

function persistLineGuideSetting(enabled) {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.sync || !chrome.storage.sync.set) return;
    chrome.storage.sync.set({ lineGuideEnabled: Boolean(enabled) }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        // Ignore storage sync failures; state already applied locally.
      }
    });
  } catch (_error) {
    // Ignore extension context errors.
  }
}

function initializeLineGuide() {
  document.addEventListener("mousemove", (event) => {
    lineGuideY = event.clientY;
    requestLineGuidePaint();
  }, true);

  window.addEventListener("resize", () => {
    if (!lineGuideEnabled) return;
    lineGuideY = clampNumber(lineGuideY || (window.innerHeight * 0.35), 0, window.innerHeight);
    requestLineGuidePaint();
  }, true);
}

initializeLineGuide();

function stopSelectionSpeechPlayback() {
  if (!selectionSpeechAudio) return;
  const currentSrc = selectionSpeechAudio.src || "";
  selectionSpeechAudio.pause();
  selectionSpeechAudio.removeAttribute("src");
  selectionSpeechAudio.load();
  selectionSpeechAudio = null;
  if (currentSrc.startsWith("blob:")) {
    URL.revokeObjectURL(currentSrc);
  }
}

function getSelectedTextForSpeech() {
  const selection = window.getSelection();
  const rawSelectionText = selection ? String(selection) : "";
  const selectedText = rawSelectionText.trim();
  if (selectedText) {
    return selectedText.slice(0, 2500);
  }

  const active = document.activeElement;
  if (!active) return "";
  const tag = active.tagName ? active.tagName.toLowerCase() : "";
  const supportsRange = tag === "input" || tag === "textarea";
  if (supportsRange) {
    const value = String(active.value || "");
    const start = Number(active.selectionStart);
    const end = Number(active.selectionEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return value.slice(start, end).trim().slice(0, 2500);
    }
  }
  return "";
}

async function speakSelectedTextWithElevenLabs() {
  if (selectionSpeechBusy) return;
  const text = getSelectedTextForSpeech();
  if (!text) return;

  selectionSpeechBusy = true;
  try {
    stopSelectionSpeechPlayback();
    const response = await fetch(`${DOC_SERVER_BASE}/speak-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      let errorMessage = `Speech request failed (${response.status})`;
      try {
        const errData = await response.json();
        if (errData && errData.error) {
          errorMessage = errData.error;
        }
      } catch (_error) {
        // Ignore non-JSON error body.
      }
      throw new Error(errorMessage);
    }

    const audioBlob = await response.blob();
    if (!audioBlob || !audioBlob.size) {
      throw new Error("No audio returned");
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    selectionSpeechAudio = audio;
    audio.onended = () => {
      if (selectionSpeechAudio === audio) {
        selectionSpeechAudio = null;
      }
      URL.revokeObjectURL(audioUrl);
    };
    audio.onerror = () => {
      if (selectionSpeechAudio === audio) {
        selectionSpeechAudio = null;
      }
      URL.revokeObjectURL(audioUrl);
    };
    await audio.play();
  } catch (error) {
    console.warn("AQual speech failed:", error);
  } finally {
    selectionSpeechBusy = false;
  }
}

let audioHotkeyActive = false;
const pressedKeys = new Set();
let audioHoldPingTimer = null;
let audioHoldSequence = 0;
let activeAudioHoldId = 0;

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

function safeRuntimeMessage(payload) {
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage(payload, () => {
      if (chrome.runtime.lastError) {
        // Ignore if no listener or extension reloaded.
      }
    });
  } catch (error) {
    // Ignore runtime errors when extension context is unavailable.
  }
}

function startAudioHoldPing() {
  if (audioHoldPingTimer) return;
  audioHoldPingTimer = setInterval(() => {
    if (!audioHotkeyActive || !activeAudioHoldId) return;
    safeRuntimeMessage({ type: "aqual-audio-hold", action: "start", holdId: activeAudioHoldId });
  }, 350);
}

function stopAudioHoldPing() {
  if (!audioHoldPingTimer) return;
  clearInterval(audioHoldPingTimer);
  audioHoldPingTimer = null;
}

document.addEventListener("keydown", (event) => {
  pressedKeys.add(event.code);
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight") || event.altKey;
  const isCDown = pressedKeys.has("KeyC") || event.code === "KeyC" || (event.key && event.key.toLowerCase() === "c");
  const isGDown = pressedKeys.has("KeyG") || event.code === "KeyG" || (event.key && event.key.toLowerCase() === "g");
  const isADown = pressedKeys.has("KeyA") || event.code === "KeyA" || (event.key && event.key.toLowerCase() === "a");
  if (event.ctrlKey || event.metaKey) return;

  if (!event.repeat && isAltDown && isCDown) {
    event.preventDefault();
    speakSelectedTextWithElevenLabs();
    return;
  }

  if (!event.repeat && isAltDown && isGDown) {
    event.preventDefault();
    const nextEnabled = !lineGuideEnabled;
    setLineGuideEnabled(nextEnabled);
    state = { ...state, lineGuideEnabled: nextEnabled };
    persistLineGuideSetting(nextEnabled);
    return;
  }

  if (audioHotkeyActive || event.repeat) return;
  if (!(isAltDown && isADown)) return;
  audioHotkeyActive = true;
  audioHoldSequence += 1;
  activeAudioHoldId = audioHoldSequence;
  event.preventDefault();
  safeRuntimeMessage({ type: "aqual-audio-hold", action: "start", holdId: activeAudioHoldId });
  startAudioHoldPing();
}, true);

document.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
  if (!audioHotkeyActive) return;
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight");
  const isADown = pressedKeys.has("KeyA");
  if (!(isAltDown && isADown)) {
    audioHotkeyActive = false;
    stopAudioHoldPing();
    safeRuntimeMessage({ type: "aqual-audio-hold", action: "stop", holdId: activeAudioHoldId });
    activeAudioHoldId = 0;
  }
}, true);

window.addEventListener("blur", () => {
  if (audioHotkeyActive) {
    audioHotkeyActive = false;
    stopAudioHoldPing();
    safeRuntimeMessage({ type: "aqual-audio-hold", action: "stop", holdId: activeAudioHoldId });
    activeAudioHoldId = 0;
  }
  stopSelectionSpeechPlayback();
  if (lineGuideOverlay) {
    lineGuideOverlay.style.opacity = "0";
  }
  pressedKeys.clear();
});
