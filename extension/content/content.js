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
  adaptiveContrastEnabled: false,
  nightModeEnabled: false,
  dimmingEnabled: false,
  dimmingLevel: 0.25,
  blueLightEnabled: false,
  blueLightLevel: 0.2,
  colorBlindMode: "none",
  reducedCrowdingEnabled: false,
  drawingEnabled: false
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
let adaptiveTimer = null;
let drawingCanvas = null;
let drawingCtx = null;
let drawingStrokes = [];
let activeStroke = null;
let drawingResizeTimer = null;

function normalizeSettings(input) {
  return { ...DEFAULTS, ...(input || {}) };
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

function applyCursor(enabled, cursorType) {
  const id = "aqual-cursor-style";
  if (!enabled) {
    removeElement(id);
    return;
  }
  const cursorUrl = chrome.runtime.getURL(`assets/cursors/${cursorType}`);
  const css = `* { cursor: url(${cursorUrl}) 4 4, auto !important; }`;
  ensureStyleTag(id, css);
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

function parseRgbColor(value) {
  if (!value) return null;
  const match = value.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== undefined ? Number(match[4]) : 1;
  return { r, g, b, a };
}

function relativeLuminance({ r, g, b }) {
  const transform = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = transform(r);
  const G = transform(g);
  const B = transform(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function computeAdaptiveFilter() {
  const bodyStyle = window.getComputedStyle(document.body || document.documentElement);
  const rootStyle = window.getComputedStyle(document.documentElement);
  const bodyBg = parseRgbColor(bodyStyle.backgroundColor);
  const rootBg = parseRgbColor(rootStyle.backgroundColor);
  const bg = (bodyBg && bodyBg.a > 0.05)
    ? bodyBg
    : (rootBg && rootBg.a > 0.05 ? rootBg : parseRgbColor("rgb(255,255,255)"));
  const luminance = relativeLuminance(bg);
  if (luminance < 0.4) {
    return { brightness: 1.12, contrast: 1.2 };
  }
  return { brightness: 0.96, contrast: 1.25 };
}

function updateRootFilter(settings) {
  const parts = [];
  if (settings.highContrastEnabled) {
    parts.push("contrast(1.45) saturate(1.05)");
  }
  if (settings.adaptiveContrastEnabled) {
    const { brightness, contrast } = computeAdaptiveFilter();
    parts.push(`brightness(${brightness}) contrast(${contrast})`);
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

function manageAdaptiveTimer(enabled) {
  if (enabled && !adaptiveTimer) {
    adaptiveTimer = setInterval(() => updateRootFilter(state), 2000);
  } else if (!enabled && adaptiveTimer) {
    clearInterval(adaptiveTimer);
    adaptiveTimer = null;
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

  if (next.cursorEnabled !== state.cursorEnabled || next.cursorType !== state.cursorType) {
    applyCursor(next.cursorEnabled, next.cursorType);
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
    next.adaptiveContrastEnabled !== state.adaptiveContrastEnabled ||
    next.colorBlindMode !== state.colorBlindMode
  ) {
    updateRootFilter(next);
    manageAdaptiveTimer(next.adaptiveContrastEnabled);
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

  state = next;
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
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

let audioHotkeyActive = false;
const pressedKeys = new Set();

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

document.addEventListener("keydown", (event) => {
  pressedKeys.add(event.code);
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight") || event.altKey;
  const isADown = pressedKeys.has("KeyA") || event.code === "KeyA" || (event.key && event.key.toLowerCase() === "a");
  if (audioHotkeyActive || event.repeat) return;
  if (!(isAltDown && isADown)) return;
  if (event.ctrlKey || event.metaKey) return;
  audioHotkeyActive = true;
  event.preventDefault();
  safeRuntimeMessage({ type: "aqual-audio-hold", action: "start" });
}, true);

document.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
  if (!audioHotkeyActive) return;
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight");
  const isADown = pressedKeys.has("KeyA");
  if (!(isAltDown && isADown)) {
    audioHotkeyActive = false;
    safeRuntimeMessage({ type: "aqual-audio-hold", action: "stop" });
  }
}, true);

window.addEventListener("blur", () => {
  if (audioHotkeyActive) {
    audioHotkeyActive = false;
    safeRuntimeMessage({ type: "aqual-audio-hold", action: "stop" });
  }
  pressedKeys.clear();
});
