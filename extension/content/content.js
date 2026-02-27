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
  lineGuideEnabled: false,
  readingModeEnabled: false
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
let describedImageCaptionEl = null;
let describedImageText = "";
let describeRequestSerial = 0;
let lineGuideOverlay = null;
let lineGuideEnabled = false;
let lineGuideY = 0;
let lineGuideRaf = null;
let selectionSpeechAudio = null;
let selectionSpeechBusy = false;
let geminiLiveHost = null;
let geminiLiveEls = null;
let geminiLiveHideTimer = null;
let ringEventPollTimer = null;
let ringEventPollInFlight = false;
let ringEventCursor = 0;
let ringEventLastToggleAt = 0;
let ringEventLastActionAt = Object.create(null);
let readingModeRequestId = 0;
let readingModeRequestInFlight = false;
let readingModeAbortController = null;

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
const READING_MODE_PLAN_ENDPOINT = `${DOC_SERVER_BASE}/reading-mode-plan`;
const READING_MODE_REQUEST_TIMEOUT_MS = 18000;
const READING_MODE_MAX_HTML_CHARS = 450000;
const READING_MODE_DEBUG_LOGS = true;
const RING_EVENT_POLL_ENDPOINT = `${DOC_SERVER_BASE}/ring-event/poll`;
const RING_EVENT_POLL_INTERVAL_MS = 1400;
const RING_EVENT_LOCAL_DEBOUNCE_MS = 260;
const RING_EVENT_POLL_DEFAULTS = { aqualRingBackendPollingEnabled: true };
const RING_BUTTON_ACTION_DEFAULTS = {
  right: "toggle_image_veil",
  left: "toggle_line_guide",
  bottom: "toggle_font_color",
  top: "toggle_reduced_crowding",
  center: "toggle_voice_mic",
  home: "toggle_high_contrast"
};
const VALID_RING_ACTIONS = new Set([
  "toggle_voice_mic",
  "toggle_gemini_live",
  "toggle_reading_mode",
  "toggle_high_contrast",
  "toggle_night_mode",
  "toggle_blue_light",
  "toggle_dimming",
  "toggle_font_family",
  "toggle_font_size",
  "toggle_line_guide",
  "toggle_image_veil",
  "toggle_highlight",
  "toggle_link_emphasis",
  "toggle_cursor",
  "toggle_text_stroke",
  "toggle_drawing",
  "toggle_magnifier",
  "toggle_reduced_crowding",
  "toggle_font_color",
  "cycle_color_vision",
  "cycle_font_family",
  "cycle_cursor",
  "cycle_font_size",
  "cycle_magnifier_size",
  "cycle_magnifier_zoom",
  "cycle_dimming_level",
  "cycle_blue_light_level",
  "cycle_font_color",
  "cycle_text_stroke_color",
  "clear_drawings",
  "print_page",
  "capture_screenshot",
  "key_arrow_up",
  "key_arrow_down",
  "key_arrow_left",
  "key_arrow_right",
  "key_space",
  "key_enter",
  "key_escape",
  "key_tab",
  "key_backspace",
  "key_page_up",
  "key_page_down",
  "key_home",
  "key_end",
  "none"
]);
let ringButtonActionOverrides = { ...RING_BUTTON_ACTION_DEFAULTS };

function isGoogleMapsUrl() {
  const href = window.location.href;
  return GOOGLE_MAPS_BLOCKLIST.some((prefix) => href.startsWith(prefix));
}

function normalizeRingAction(action) {
  const token = String(action || "").trim().toLowerCase();
  if (!VALID_RING_ACTIONS.has(token)) {
    return "";
  }
  return token;
}

function normalizeRingButtonActions(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const button of Object.keys(RING_BUTTON_ACTION_DEFAULTS)) {
    const defaultAction = RING_BUTTON_ACTION_DEFAULTS[button];
    const requested = normalizeRingAction(source[button]);
    normalized[button] = requested || defaultAction;
  }
  return normalized;
}

function resolveRingActionForPayload(buttonLabel, fallbackAction) {
  const fallback = normalizeRingAction(fallbackAction) || "toggle_voice_mic";
  const button = String(buttonLabel || "").trim().toLowerCase();
  if (!button) {
    return fallback;
  }
  const configured = normalizeRingAction(ringButtonActionOverrides[button]);
  if (!configured) {
    return fallback;
  }
  return configured;
}

function normalizeSettings(input) {
  return { ...DEFAULTS, ...(input || {}) };
}

function resetAllVisualEffects() {
  setReadingModeEnabled(false);
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

function readingModeDebug(eventName, details) {
  if (!READING_MODE_DEBUG_LOGS || window.top !== window) return;
  const payload = {
    event: String(eventName || ""),
    href: window.location.href,
    ...(details && typeof details === "object" ? details : {})
  };
  try {
    console.info("[aqual-reading-mode]", JSON.stringify(payload));
  } catch (_error) {
    console.info("[aqual-reading-mode]", eventName, details || "");
  }
}

function updateReadingModeStatus(status, detail = "", extra = null) {
  const payload = {
    status: String(status || ""),
    detail: String(detail || ""),
    pageUrl: window.location.href,
    updatedAt: Date.now()
  };
  if (extra && typeof extra === "object") {
    payload.extra = extra;
  }
  chrome.storage.local.set({ aqualReadingModeStatus: payload }, () => {
    if (chrome.runtime.lastError) {
      // Ignore storage write errors in page contexts where runtime may be transient.
    }
  });
}

function reportReadingModeState(enabled) {
  chrome.runtime.sendMessage(
    {
      type: "aqual-reading-mode-state-update",
      enabled: Boolean(enabled)
    },
    () => {
      if (chrome.runtime.lastError) {
        // Ignore if service worker is restarting.
      }
    },
  );
}

function normalizeReadingModeSelectorList(rawValue, maxItems = 0) {
  const values = Array.isArray(rawValue) ? rawValue : [];
  const output = [];
  const seen = new Set();
  const cap = Number(maxItems);
  const capEnabled = Number.isFinite(cap) && cap > 0;
  for (let i = 0; i < values.length; i += 1) {
    const selector = String(values[i] || "").trim();
    if (!selector || selector.length > 220) continue;
    const lowered = selector.toLowerCase();
    if (lowered === "*" || lowered === "html" || lowered === "body" || lowered === ":root") continue;
    if (lowered.includes("script") || lowered.includes("<") || lowered.includes(">")) continue;
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    output.push(selector);
    if (capEnabled && output.length >= cap) break;
  }
  return output;
}

function readingModeQuerySelectorAll(selector) {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (_error) {
    return [];
  }
}

function readingModeElementDepth(element) {
  let depth = 0;
  let node = element;
  while (node && node.parentElement) {
    node = node.parentElement;
    depth += 1;
  }
  return depth;
}

function readingModeIsAqualElement(element) {
  if (!element || !element.getAttribute) return false;
  const id = String(element.id || "");
  if (id.startsWith("aqual-")) return true;
  const className = String(element.className || "");
  return className.includes("aqual-");
}

function readingModeBuildCandidateRoots(includeSelectors) {
  const selectors = normalizeReadingModeSelectorList(includeSelectors, 12);
  const fallbackSelectors = [
    "main article",
    "article",
    "[role='main'] article",
    "main",
    "[role='main']",
    "#content",
    ".content",
    ".article",
    ".post",
    ".story"
  ];
  const orderedSelectors = [...selectors, ...fallbackSelectors];
  const scored = [];
  const seen = new Set();

  for (let i = 0; i < orderedSelectors.length; i += 1) {
    const selector = orderedSelectors[i];
    const nodes = readingModeQuerySelectorAll(selector);
    for (let j = 0; j < nodes.length && j < 60; j += 1) {
      const node = nodes[j];
      if (!(node instanceof Element) || !document.body || !document.body.contains(node)) continue;
      if (readingModeIsAqualElement(node)) continue;
      const key = `${selector}::${readingModeElementDepth(node)}::${node.tagName}::${node.id || ""}::${node.className || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const textLength = String(node.innerText || "").replace(/\s+/g, " ").trim().length;
      const idClassText = `${node.id || ""} ${node.className || ""}`.toLowerCase();
      const semanticBonus = /^(ARTICLE|MAIN|SECTION)$/.test(node.tagName) ? 260 : 0;
      const contentHintBonus = /(article|content|story|post|entry|main|body|text)/.test(idClassText) ? 180 : 0;
      const score = textLength + semanticBonus + contentHintBonus;
      if (textLength < 80 && i < selectors.length) {
        continue;
      }
      scored.push({
        element: node,
        depth: readingModeElementDepth(node),
        score,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    return b.score - a.score;
  });

  const roots = [];
  for (let i = 0; i < scored.length; i += 1) {
    const candidate = scored[i].element;
    if (roots.some((existing) => candidate === existing || candidate.contains(existing))) {
      continue;
    }
    roots.push(candidate);
    if (roots.length >= 6) break;
  }

  if (roots.length) return roots;

  if (document.body) {
    const fallbackRoot = document.querySelector("article")
      || document.querySelector("main")
      || document.querySelector("[role='main']")
      || document.querySelector("#content")
      || document.body;
    if (fallbackRoot) return [fallbackRoot];
  }

  return [];
}

function readingModeElementInsideRoots(element, roots) {
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i];
    if (root === element || root.contains(element)) {
      return true;
    }
  }
  return false;
}

function readingModeTextLengthOfRoots(roots) {
  return roots.reduce((sum, root) => {
    const text = root && typeof root.innerText === "string"
      ? root.innerText.replace(/\s+/g, " ").trim()
      : "";
    return sum + text.length;
  }, 0);
}

function readingModeSelectorIsAggressiveExclude(selector) {
  const token = String(selector || "").trim().toLowerCase();
  if (!token) return true;
  const broad = new Set([
    "div", "section", "article", "main", "span", "p", "a",
    "ul", "ol", "li", "table", "figure", "img", "video",
    "h1", "h2", "h3", "h4", "h5", "h6", "*", "main *", "article *", "body *"
  ]);
  if (broad.has(token)) return true;
  if (token.startsWith("*")) return true;
  if (token.includes(":not(") || token.includes(":has(") || token.includes(":is(") || token.includes(":where(")) {
    return true;
  }
  const hasStructure = /[#.\[\s>+~:]/.test(token);
  const hasNoiseHint = /(ad|promo|related|recommend|tag|chip|newsletter|share|social|cookie|consent|sponsor|sidebar|rail|card)/.test(token);
  return !hasStructure && !hasNoiseHint;
}

function clearReadingModeDom() {
  document.documentElement.classList.remove("aqual-reading-mode-active");
  const hiddenNodes = document.querySelectorAll("[data-aqual-reading-hidden='1']");
  hiddenNodes.forEach((node) => {
    node.removeAttribute("data-aqual-reading-hidden");
  });
}

function applyReadingModePlan(plan) {
  if (!document.body || !document.documentElement) {
    return { ok: false, error: "Page body is unavailable." };
  }

  const includeSelectors = normalizeReadingModeSelectorList(
    plan && (plan.includeSelectors || plan.include_selectors),
    10,
  );
  const excludeSelectors = normalizeReadingModeSelectorList(
    plan && (plan.excludeSelectors || plan.exclude_selectors),
    0,
  );
  let roots = readingModeBuildCandidateRoots(includeSelectors);
  const fallbackRoots = readingModeBuildCandidateRoots([]);
  const rootsTextLength = readingModeTextLengthOfRoots(roots);
  const fallbackTextLength = readingModeTextLengthOfRoots(fallbackRoots);
  if (
    fallbackRoots.length
    && (rootsTextLength < 240 || (fallbackTextLength > 0 && rootsTextLength < fallbackTextLength * 0.35))
  ) {
    roots = fallbackRoots;
  }
  if (!roots.length) {
    return { ok: false, error: "No readable content container was found." };
  }

  clearReadingModeDom();
  const keepAncestors = new Set([document.documentElement, document.body]);
  roots.forEach((root) => {
    let cursor = root;
    while (cursor && cursor instanceof Element) {
      keepAncestors.add(cursor);
      if (cursor === document.body || cursor === document.documentElement) break;
      cursor = cursor.parentElement;
    }
  });

  let hiddenCount = 0;
  const allNodes = document.body.querySelectorAll("*");
  allNodes.forEach((element) => {
    if (!(element instanceof Element)) return;
    if (readingModeIsAqualElement(element)) return;
    if (keepAncestors.has(element)) return;
    if (readingModeElementInsideRoots(element, roots)) return;
    element.setAttribute("data-aqual-reading-hidden", "1");
    hiddenCount += 1;
  });

  const rootTextBeforeExclude = Math.max(1, readingModeTextLengthOfRoots(roots));
  excludeSelectors.forEach((selector) => {
    if (readingModeSelectorIsAggressiveExclude(selector)) {
      return;
    }
    const matches = readingModeQuerySelectorAll(selector);
    if (matches.length > 180) {
      return;
    }
    let selectorTextLength = 0;
    const candidates = [];
    matches.forEach((element) => {
      if (!(element instanceof Element)) return;
      if (readingModeIsAqualElement(element)) return;
      if (!readingModeElementInsideRoots(element, roots)) return;
      if (roots.some((root) => root === element || element.contains(root))) return;
      const tag = String(element.tagName || "").toUpperCase();
      const criticalTag = /^(ARTICLE|MAIN|SECTION|P|H1|H2|H3|H4|H5|H6|UL|OL|TABLE)$/.test(tag);
      const noisySelector = /(ad|promo|related|recommend|tag|chip|newsletter|share|social|cookie|consent|sponsor|sidebar|rail|card)/.test(String(selector || "").toLowerCase());
      if (criticalTag && !noisySelector) return;
      const textLen = String(element.innerText || "").replace(/\s+/g, " ").trim().length;
      selectorTextLength += textLen;
      candidates.push(element);
    });
    if (selectorTextLength > rootTextBeforeExclude * 0.55) {
      return;
    }
    candidates.forEach((element) => {
      if (element.getAttribute("data-aqual-reading-hidden") !== "1") {
        element.setAttribute("data-aqual-reading-hidden", "1");
        hiddenCount += 1;
      }
    });
  });

  const rootTextAfterExclude = readingModeTextLengthOfRoots(roots);
  if (rootTextAfterExclude < 180) {
    clearReadingModeDom();
    return { ok: false, error: "Reading mode filtered too aggressively on this page." };
  }

  document.documentElement.classList.add("aqual-reading-mode-active");
  return { ok: true, rootCount: roots.length, hiddenCount };
}

function buildReadingModePayload() {
  const root = document.documentElement;
  const fullHtml = root && root.outerHTML ? String(root.outerHTML) : "";
  const truncated = fullHtml.length > READING_MODE_MAX_HTML_CHARS;
  const htmlSource = truncated ? fullHtml.slice(0, READING_MODE_MAX_HTML_CHARS) : fullHtml;
  const visibleTextPreview = document.body
    ? String(document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000)
    : "";
  return {
    pageUrl: window.location.href,
    pageTitle: document.title || "",
    htmlSource,
    visibleTextPreview,
    inputTruncatedClientSide: truncated,
    htmlCharsOriginal: fullHtml.length,
    htmlCharsSent: htmlSource.length,
  };
}

async function fetchReadingModePlan() {
  const payload = buildReadingModePayload();
  if (!payload.htmlSource) {
    throw new Error("Could not read page HTML.");
  }
  readingModeDebug("request_payload_ready", {
    pageTitleChars: String(payload.pageTitle || "").length,
    visibleTextChars: String(payload.visibleTextPreview || "").length,
    htmlCharsOriginal: Number(payload.htmlCharsOriginal || 0),
    htmlCharsSent: Number(payload.htmlCharsSent || 0),
    truncatedClientSide: Boolean(payload.inputTruncatedClientSide),
  });

  const controller = new AbortController();
  readingModeAbortController = controller;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, READING_MODE_REQUEST_TIMEOUT_MS);

  try {
    const startedAt = Date.now();
    const response = await fetch(READING_MODE_PLAN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      readingModeDebug("request_failed", {
        status: response.status,
        error: String(data && data.error ? data.error : ""),
      });
      throw new Error(String(data && data.error ? data.error : `Reading mode request failed (${response.status})`));
    }
    readingModeDebug("request_success", {
      durationMs: Date.now() - startedAt,
      includeCount: Array.isArray(data && data.includeSelectors) ? data.includeSelectors.length : 0,
      excludeCount: Array.isArray(data && data.excludeSelectors) ? data.excludeSelectors.length : 0,
      model: String(data && data.model ? data.model : ""),
      inputTruncatedServerSide: Boolean(data && data.debug && data.debug.inputTruncated),
    });
    return data || {};
  } finally {
    if (readingModeAbortController === controller) {
      readingModeAbortController = null;
    }
    clearTimeout(timeoutId);
  }
}

async function setReadingModeEnabled(enabled) {
  if (!enabled) {
    readingModeRequestId += 1;
    if (readingModeAbortController) {
      try {
        readingModeAbortController.abort();
      } catch (_error) {
        // Ignore abort errors.
      }
      readingModeAbortController = null;
    }
    readingModeRequestInFlight = false;
    readingModeDebug("toggle_off");
    clearReadingModeDom();
    updateReadingModeStatus("disabled", "Reading mode is off.");
    reportReadingModeState(false);
    return;
  }
  if (window.top !== window) {
    return;
  }
  if (readingModeRequestInFlight) {
    readingModeDebug("toggle_on_ignored_inflight");
    return;
  }
  const requestId = ++readingModeRequestId;
  readingModeRequestInFlight = true;
  readingModeDebug("toggle_on", { requestId });
  updateReadingModeStatus("loading", "Analysing page with Gemini Flash...");

  try {
    const plan = await fetchReadingModePlan();
    if (requestId !== readingModeRequestId) return;
    const applied = applyReadingModePlan(plan);
    if (!applied.ok) {
      throw new Error(applied.error || "Could not apply reading mode.");
    }
    readingModeDebug("apply_success", {
      requestId,
      roots: Number(applied.rootCount || 0),
      hidden: Number(applied.hiddenCount || 0),
    });
    updateReadingModeStatus(
      "applied",
      "Reading mode applied.",
      {
        rootCount: Number(applied.rootCount || 0),
        hiddenCount: Number(applied.hiddenCount || 0),
      },
    );
    reportReadingModeState(true);
  } catch (error) {
    if (requestId !== readingModeRequestId) return;
    if (error && error.name === "AbortError") {
      readingModeDebug("request_aborted", { requestId });
      return;
    }
    clearReadingModeDom();
    const message = error && error.message ? error.message : "Failed to apply reading mode.";
    readingModeDebug("apply_error", { requestId, error: message });
    updateReadingModeStatus("error", message);
    reportReadingModeState(false);
    showGeminiLivePanel("Reading mode error", message, { sticky: true, isError: true });
  } finally {
    if (requestId === readingModeRequestId) {
      readingModeRequestInFlight = false;
    }
  }
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
  const safeLevel = Math.max(0, Math.min(0.75, Number(level) || 0));
  const mappedLevel = safeLevel > 0 ? Math.min(0.85, Math.pow(safeLevel, 0.82)) : 0;
  blueOverlay.style.opacity = enabled ? String(mappedLevel) : "0";
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

function applyMediaColorBlindFilter(mode) {
  const id = "aqual-media-colorblind-filter";
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedMode || normalizedMode === "none") {
    removeElement(id);
    return;
  }

  ensureColorFilters();
  const filterId = `aqual-cb-${normalizedMode}`;
  const css = `
img,
video {
  filter: url(#${filterId}) !important;
}
`;
  ensureStyleTag(id, css);
}

function updateRootFilter(settings) {
  const parts = [];
  if (settings.highContrastEnabled) {
    parts.push("contrast(1.45) saturate(1.05)");
  }
  applyMediaColorBlindFilter(settings.colorBlindMode);

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
  const label = altText && altText.trim() ? altText.trim() : "Image";

  const escapeSvgText = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const horizontalPadding = Math.max(12, Math.round(safeWidth * 0.05));
  const verticalPadding = Math.max(12, Math.round(safeHeight * 0.06));
  const maxTextWidth = Math.max(40, safeWidth - (horizontalPadding * 2));
  const maxTextHeight = Math.max(24, safeHeight - (verticalPadding * 2));

  const wrapWords = (text, maxCharsPerLine) => {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return ["Image"];
    const lines = [];
    let current = "";
    words.forEach((word) => {
      if (!current) {
        current = word;
        return;
      }
      const candidate = `${current} ${word}`;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines;
  };

  const lineHeightRatio = 1.32;
  let fontSize = Math.max(11, Math.min(26, Math.round(Math.min(safeWidth / 15, safeHeight / 6))));
  let lines = [label];
  let lineHeight = Math.max(14, Math.round(fontSize * lineHeightRatio));
  let textHeight = lineHeight;

  while (fontSize > 10) {
    const avgCharWidth = fontSize * 0.56;
    const maxCharsPerLine = Math.max(8, Math.floor(maxTextWidth / avgCharWidth));
    lines = wrapWords(label, maxCharsPerLine);
    lineHeight = Math.max(14, Math.round(fontSize * lineHeightRatio));
    textHeight = lines.length * lineHeight;
    if (textHeight <= maxTextHeight) break;
    fontSize -= 1;
  }

  if (textHeight > maxTextHeight) {
    const maxVisibleLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
    lines = lines.slice(0, maxVisibleLines);
    const lastIndex = lines.length - 1;
    if (lastIndex >= 0) {
      lines[lastIndex] = `${lines[lastIndex].replace(/[ .]+$/, "")}...`;
    }
  }

  const firstLineY = Math.round((safeHeight - ((lines.length - 1) * lineHeight)) / 2);
  const tspans = lines
    .map((line, index) => `<tspan x='50%' y='${firstLineY + (index * lineHeight)}'>${escapeSvgText(line)}</tspan>`)
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${safeWidth}' height='${safeHeight}'>` +
    `<rect width='100%' height='100%' fill='#f1f5f9'/>` +
    `<text text-anchor='middle' font-size='${fontSize}' font-family='sans-serif' fill='#334155'>${tspans}</text>` +
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

  if (next.readingModeEnabled !== state.readingModeEnabled) {
    setReadingModeEnabled(next.readingModeEnabled);
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

function normalizeLearnText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeLearnText(value) {
  return normalizeLearnText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function getLearnTextScore(query, candidateText) {
  const queryNormalized = normalizeLearnText(query);
  const candidateNormalized = normalizeLearnText(candidateText);
  if (!queryNormalized || !candidateNormalized) return 0;
  if (candidateNormalized === queryNormalized) return 1;
  if (candidateNormalized.includes(queryNormalized)) return 0.98;

  const queryTokens = tokenizeLearnText(queryNormalized);
  const candidateTokens = tokenizeLearnText(candidateNormalized);
  let tokenHits = 0;
  for (let i = 0; i < queryTokens.length; i += 1) {
    const token = queryTokens[i];
    if (candidateTokens.some((candidateToken) => candidateToken.includes(token) || token.includes(candidateToken))) {
      tokenHits += 1;
    }
  }

  const tokenScore = queryTokens.length ? (tokenHits / queryTokens.length) : 0;
  const fuzzyScore = similarityScore(queryNormalized, candidateNormalized);
  return Math.max(tokenScore, fuzzyScore);
}

function isElementLikelyVisible(element) {
  if (!element || !element.isConnected || !element.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function waitForLearnUi(ms = 350) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function scrollLearnToBottom(maxPasses = 5) {
  let previousHeight = -1;
  for (let i = 0; i < maxPasses; i += 1) {
    const nextHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    window.scrollTo({ top: nextHeight, behavior: "smooth" });
    await waitForLearnUi(450);
    const settledHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    if (settledHeight <= previousHeight + 4) {
      break;
    }
    previousHeight = settledHeight;
  }
}

function activateLearnElement(target) {
  if (!target) return "";

  try {
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch (_error) {
    // Ignore scroll errors.
  }

  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    // Ignore focus errors.
  }

  let href = "";
  if (target.tagName && target.tagName.toLowerCase() === "a") {
    href = parseHttpUrl(getAnchorRawHref(target));
  } else {
    const linked = target.closest && target.closest("a[href]");
    if (linked) {
      href = parseHttpUrl(getAnchorRawHref(linked));
    }
  }

  try {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  } catch (_error) {
    // Ignore synthetic mouse event failures.
  }

  try {
    target.click();
  } catch (_error) {
    // Ignore click errors.
  }

  return href;
}

function collectLearnCourseCandidates() {
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (node, clickable, label) => {
    if (!node) return;
    const normalizedLabel = String(label || "").replace(/\s+/g, " ").trim();
    const clickableHref = clickable && clickable.getAttribute ? (clickable.getAttribute("href") || "") : "";
    const identity = [
      clickable && clickable.tagName ? clickable.tagName : (node.tagName || "node"),
      clickable && clickable.id ? clickable.id : (node.id || ""),
      clickableHref,
      normalizedLabel
    ].join("|");
    if (seen.has(identity)) return;
    seen.add(identity);
    candidates.push({
      node,
      clickable: clickable || node,
      label: normalizedLabel
    });
  };

  const cards = document.querySelectorAll("bb-base-course-card article, bb-base-course-card");
  cards.forEach((card) => {
    const clickable = card.querySelector("a[href*='/ultra/courses/'], a[href], button") || card;
    const label = [
      card.getAttribute("aria-label") || "",
      clickable.getAttribute && clickable.getAttribute("aria-label") ? clickable.getAttribute("aria-label") : "",
      card.textContent || ""
    ].join(" ").replace(/\s+/g, " ").trim();
    pushCandidate(card, clickable, label);
  });

  const legacyCards = document.querySelectorAll(
    "article.course-element-card[data-course-id], article.element-card.course-element-card[data-course-id], article[bb-click-to-invoke-child='a.course-title']"
  );
  legacyCards.forEach((card) => {
    const legacyAnchor = card.querySelector(
      "a.course-title, a[analytics-id*='courseLink'], a[ng-click*='handleCourseLinkClick']"
    );
    const clickable = card.hasAttribute("bb-click-to-invoke-child")
      ? card
      : (legacyAnchor || card.querySelector("a[href], button") || card);
    const titleEl = card.querySelector("h4.js-course-title-element, h4, .course-id");
    const label = [
      card.getAttribute("aria-label") || "",
      titleEl && titleEl.textContent ? titleEl.textContent : "",
      legacyAnchor && legacyAnchor.getAttribute("aria-label") ? legacyAnchor.getAttribute("aria-label") : "",
      card.textContent || ""
    ].join(" ").replace(/\s+/g, " ").trim();
    pushCandidate(card, clickable, label);
  });

  const courseAnchors = document.querySelectorAll("a[href*='/ultra/courses/']");
  courseAnchors.forEach((anchor) => {
    const card = anchor.closest("article, bb-base-course-card, li, div") || anchor;
    const label = [
      anchor.getAttribute("aria-label") || "",
      anchor.textContent || "",
      card && card.textContent ? card.textContent : ""
    ].join(" ").replace(/\s+/g, " ").trim();
    pushCandidate(card, anchor, label);
  });

  const xpathCandidates = [
    "/html/body/div[1]/div[2]/bb-base-layout/div/main/div/section/div[2]/div[1]/div/div/div[9]/div/section[2]/div/div/*/bb-base-course-card/article",
    "/html/body/div[1]/div[2]/bb-base-layout/div/main/div/section/div[2]/div[1]/div/div/div[9]/div/section[2]/div/div[*]/bb-base-course-card/article"
  ];
  xpathCandidates.forEach((expression) => {
    try {
      const snapshot = document.evaluate(
        expression,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      for (let i = 0; i < snapshot.snapshotLength; i += 1) {
        const article = snapshot.snapshotItem(i);
        if (!article) continue;
        const clickable = article.querySelector("a[href*='/ultra/courses/'], a[href], button") || article;
        const label = [
          article.getAttribute("aria-label") || "",
          clickable.getAttribute && clickable.getAttribute("aria-label") ? clickable.getAttribute("aria-label") : "",
          article.textContent || ""
        ].join(" ").replace(/\s+/g, " ").trim();
        pushCandidate(article, clickable, label);
      }
    } catch (_error) {
      // Ignore invalid XPath support edge cases.
    }
  });

  const visible = candidates.filter((candidate) => isElementLikelyVisible(candidate.node) || isElementLikelyVisible(candidate.clickable));
  return visible.length ? visible : candidates;
}

function pickBestLearnCandidate(candidates, query) {
  if (!candidates || !candidates.length) return null;
  const normalizedQuery = normalizeLearnText(query);
  if (!normalizedQuery) return null;

  let best = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = getLearnTextScore(normalizedQuery, candidate.label);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }
  if (!best || best.score < 0.28) {
    return null;
  }
  return {
    ...best.candidate,
    score: Number(best.score.toFixed(3))
  };
}

function collectLearnContentCardCandidates() {
  const cards = document.querySelectorAll("[data-content-id], .content-list-item");
  const results = [];
  cards.forEach((card) => {
    const clickable = card.querySelector(
      "button[id^='learning-module-title-'], button[data-analytics-id*='toggleFolder'], button.ax-focusable-title, a.ax-focusable-title, a[data-analytics-id*='content.item'], button[data-analytics-id*='content.item'], a[href], button"
    ) || card;
    const label = [
      clickable.getAttribute && clickable.getAttribute("aria-label") ? clickable.getAttribute("aria-label") : "",
      clickable.textContent || "",
      card.textContent || ""
    ].join(" ").replace(/\s+/g, " ").trim();
    const controlsId = clickable.getAttribute ? (clickable.getAttribute("aria-controls") || "") : "";
    results.push({
      card,
      clickable,
      label,
      controlsId
    });
  });
  return results.filter((entry) => isElementLikelyVisible(entry.card) || isElementLikelyVisible(entry.clickable));
}

async function openLearnContentCardByQuery(query) {
  const candidates = collectLearnContentCardCandidates();
  const chosen = pickBestLearnCandidate(
    candidates.map((candidate) => ({
      node: candidate.card,
      clickable: candidate.clickable,
      label: candidate.label
    })),
    query
  );
  if (!chosen) {
    return { ok: false, error: `No content card matched "${query}".` };
  }

  const source = candidates.find((candidate) => candidate.card === chosen.node || candidate.clickable === chosen.clickable) || null;
  const clickable = source ? source.clickable : chosen.clickable;
  const controlsId = source ? source.controlsId : "";
  const url = activateLearnElement(clickable);
  await waitForLearnUi(500);

  return {
    ok: true,
    card: source ? source.card : chosen.node,
    clickable,
    controlsId,
    label: chosen.label,
    url: url || ""
  };
}

const LEARN_ASSESSMENT_CARD_XPATH = "//*[@id=\"site-wrap\"]/div[2]/section/div/div/main/div/section/div/div[2]/div/div/course-content-outline/react-course-content-outline/div/div/div[1]/div[2]/div[*]";
const LEARN_COURSEWORK_CARD_XPATH = "/html/body/div[1]/div[2]/section/div/div/main/div/section/div/div[2]/div/div/course-content-outline/react-course-content-outline/div/div/div[1]/div[2]/div[8]/div/div[2]/div/div/div/div/div[1]/div[2]/div[*]";
const LEARN_COURSEWORK_FINAL_CLICK_XPATH = "/html/body/div[1]/div[2]/section/div/div/main/div/section/div/div[2]/div/div/course-content-outline/react-course-content-outline/div/div/div[1]/div[2]/div[8]/div/div[2]/div/div/div/div/div[1]/div[2]/div[5]/div/div[2]/div/div/div/div/div[1]/div[2]";
const LEARN_DEMO_DATA_SCIENCE_XPATH = "/html/body/div[1]/div[2]/bb-base-layout/div/main/div/section/div[2]/div[1]/div/div/div[9]/div/section[2]/div/div[4]/bb-base-course-card/article";

function getLearnNodesByXPath(expression) {
  try {
    const snapshot = document.evaluate(
      expression,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const nodes = [];
    for (let i = 0; i < snapshot.snapshotLength; i += 1) {
      const node = snapshot.snapshotItem(i);
      if (node) nodes.push(node);
    }
    return nodes;
  } catch (_error) {
    return [];
  }
}

function getLearnNodeLabel(node) {
  if (!node) return "";
  return [
    node.getAttribute && node.getAttribute("aria-label") ? node.getAttribute("aria-label") : "",
    node.textContent || ""
  ].join(" ").replace(/\s+/g, " ").trim();
}

function getLearnClickableNode(node) {
  if (!node) return null;
  if (
    node.matches
    && node.matches("a[href], button, [role='button'], [tabindex]")
  ) {
    return node;
  }
  if (!node.querySelector) return null;
  return node.querySelector(
    "button.ax-focusable-title, a.ax-focusable-title, a[data-analytics-id*='content.item'], a[data-analytics-id*='document.link'], a[href], button, [role='button'], [tabindex]"
  );
}

function openLearnXPathCardByQuery(expression, query, fallbackKeyword = "") {
  const nodes = getLearnNodesByXPath(expression);
  if (!nodes.length) {
    return { ok: false, error: `No nodes found for XPath: ${expression}` };
  }

  const normalizedQuery = normalizeLearnText(query);
  const normalizedFallback = normalizeLearnText(fallbackKeyword);
  let best = null;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const label = getLearnNodeLabel(node);
    const labelNormalized = normalizeLearnText(label);
    let score = normalizedQuery ? getLearnTextScore(normalizedQuery, label) : 0;
    if (normalizedFallback && labelNormalized.includes(normalizedFallback)) {
      score = Math.max(score, 0.95);
    }
    if (!best || score > best.score) {
      best = { node, label, score };
    }
  }

  if (!best) {
    return { ok: false, error: `No card matched "${query}".` };
  }
  if (normalizedQuery && best.score < 0.24 && normalizedFallback && !normalizeLearnText(best.label).includes(normalizedFallback)) {
    return { ok: false, error: `No card matched "${query}" in XPath list.` };
  }

  const clickable = getLearnClickableNode(best.node) || best.node;
  const url = activateLearnElement(clickable);
  return {
    ok: true,
    node: best.node,
    clickable,
    label: best.label,
    score: Number(best.score.toFixed(3)),
    url: url || ""
  };
}

function clickLearnNodeByXPath(expression) {
  const nodes = getLearnNodesByXPath(expression);
  if (!nodes.length) {
    return { ok: false, error: `No node found for XPath: ${expression}` };
  }
  const targetNode = nodes[0];
  const clickable = getLearnClickableNode(targetNode) || targetNode;
  const url = activateLearnElement(clickable);
  return {
    ok: true,
    node: targetNode,
    clickable,
    label: getLearnNodeLabel(targetNode),
    url: url || ""
  };
}

async function waitForLearnXPathNode(expression, timeoutMs = 12000, intervalMs = 250) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 12000);
  while (Date.now() < deadline) {
    const nodes = getLearnNodesByXPath(expression);
    if (nodes.length) {
      const node = nodes[0];
      if (node && (isElementLikelyVisible(node) || !node.getBoundingClientRect)) {
        return node;
      }
    }
    await waitForLearnUi(intervalMs);
  }
  return null;
}

function pickFirstLearnFileLink(searchRoots) {
  const selectors = [
    "a[data-analytics-id*='document.link'][href]",
    "a[href*='/outline/edit/document/'][href]",
    "a[href*='/bbcswebdav/'][href]",
    "a.ax-focusable-title[href]",
    "a[href]"
  ];

  for (let i = 0; i < searchRoots.length; i += 1) {
    const root = searchRoots[i];
    if (!root || !root.querySelectorAll) continue;
    for (let j = 0; j < selectors.length; j += 1) {
      const links = root.querySelectorAll(selectors[j]);
      for (let k = 0; k < links.length; k += 1) {
        const link = links[k];
        const href = parseHttpUrl(getAnchorRawHref(link));
        if (!href) continue;
        if (!isElementLikelyVisible(link)) continue;
        return link;
      }
    }
  }
  return null;
}

async function resolveLearnActionFromPayload(payload) {
  const action = String(payload && payload.action ? payload.action : "").trim();
  if (!action) {
    return { ok: false, error: "Missing Learn action." };
  }

  if (action === "open-course") {
    const query = String(payload && payload.query ? payload.query : "").trim();
    if (!query) return { ok: false, error: "Missing course query." };

    const normalizedQuery = normalizeLearnText(query).replace(/\s+/g, " ").trim();
    if (/\bdata\s*science\b/.test(normalizedQuery) || normalizedQuery.includes("datascience")) {
      const demoNode = await waitForLearnXPathNode(LEARN_DEMO_DATA_SCIENCE_XPATH, 14000, 280);
      if (demoNode) {
        const demoTarget = getLearnClickableNode(demoNode) || demoNode;
        const demoUrl = activateLearnElement(demoTarget);
        return {
          ok: true,
          action,
          query,
          label: getLearnNodeLabel(demoNode) || "Data Science (demo hardcoded)",
          score: 1,
          url: demoUrl || ""
        };
      }
    }

    const candidates = collectLearnCourseCandidates();
    const chosen = pickBestLearnCandidate(candidates, query);
    if (!chosen) {
      return { ok: false, error: `No course matched "${query}".` };
    }
    const clickable = chosen.clickable || chosen.node;
    const anchor = (
      clickable
      && clickable.tagName
      && clickable.tagName.toLowerCase() === "a"
    )
      ? clickable
      : (
        (clickable && clickable.closest && clickable.closest("a[href*='/ultra/courses/'], a[href]"))
        || (chosen.node && chosen.node.querySelector ? chosen.node.querySelector("a[href*='/ultra/courses/'], a[href]") : null)
      );
    const anchorRawHref = anchor ? String(getAnchorRawHref(anchor) || "").trim() : "";
    const directUrl = anchor ? parseHttpUrl(anchorRawHref) : "";
    const anchorIsScriptLink = /^javascript:/i.test(anchorRawHref);
    const clickTarget = directUrl
      ? anchor
      : ((anchor && !anchorIsScriptLink) ? anchor : clickable);
    console.info("[aqual-learn-content]", JSON.stringify({
      event: "open_course_click",
      query,
      chosenLabel: chosen.label,
      score: chosen.score,
      clickableTag: clickable && clickable.tagName ? clickable.tagName : "",
      clickTargetTag: clickTarget && clickTarget.tagName ? clickTarget.tagName : "",
      anchorHref: anchorRawHref,
      directUrl
    }));
    const url = directUrl || activateLearnElement(clickTarget);
    return {
      ok: true,
      action,
      query,
      label: chosen.label,
      score: chosen.score,
      url: url || ""
    };
  }

  if (action === "open-assessments") {
    await scrollLearnToBottom(5);
    const query = String(payload && payload.query ? payload.query : "assessment");
    const xpathOpened = openLearnXPathCardByQuery(LEARN_ASSESSMENT_CARD_XPATH, query, "assessment");
    const opened = xpathOpened.ok
      ? xpathOpened
      : await openLearnContentCardByQuery(query);
    if (!opened.ok) return opened;
    return {
      ok: true,
      action,
      label: opened.label,
      url: opened.url || ""
    };
  }

  if (action === "open-coursework") {
    const query = String(payload && payload.query ? payload.query : "").trim();
    if (!query) return { ok: false, error: "Missing coursework query." };
    await scrollLearnToBottom(5);
    const xpathOpened = openLearnXPathCardByQuery(
      LEARN_COURSEWORK_CARD_XPATH,
      query,
      "coursework"
    );
    const opened = xpathOpened.ok
      ? xpathOpened
      : await openLearnContentCardByQuery(query);
    if (!opened.ok) return opened;

    await waitForLearnUi(1500);

    const xpathFinal = clickLearnNodeByXPath(LEARN_COURSEWORK_FINAL_CLICK_XPATH);
    if (xpathFinal.ok) {
      return {
        ok: true,
        action,
        label: opened.label,
        url: xpathFinal.url || ""
      };
    }

    const searchRoots = [];
    if (opened.node) searchRoots.push(opened.node);
    if (opened.card) searchRoots.push(opened.card);
    if (opened.controlsId) {
      const controlsEl = document.getElementById(opened.controlsId);
      if (controlsEl) searchRoots.push(controlsEl);
    }
    if (opened.card && opened.card.parentElement) searchRoots.push(opened.card.parentElement);
    if (opened.node && opened.node.parentElement) searchRoots.push(opened.node.parentElement);
    searchRoots.push(document.body);

    const firstFile = pickFirstLearnFileLink(searchRoots);
    if (!firstFile) {
      return {
        ok: false,
        error: `Opened "${opened.label}" but couldn't find a file link inside it.`
      };
    }

    const fileUrl = activateLearnElement(firstFile);
    return {
      ok: true,
      action,
      label: opened.label,
      url: fileUrl || parseHttpUrl(getAnchorRawHref(firstFile)) || ""
    };
  }

  return { ok: false, error: `Unsupported Learn action "${action}".` };
}

function isEditableTarget(element) {
  if (!element || !element.tagName) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return !(element.disabled || element.readOnly);
  }
  if (element.isContentEditable) return true;
  return false;
}

function getFocusableElements() {
  return Array.from(document.querySelectorAll(
    "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
  )).filter((element) => {
    if (!element || typeof element.focus !== "function") return false;
    if (element.disabled) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function moveFocusByOffset(offset) {
  const focusable = getFocusableElements();
  if (!focusable.length) return;
  const active = document.activeElement;
  const currentIndex = focusable.indexOf(active);
  const fallbackIndex = offset >= 0 ? 0 : focusable.length - 1;
  const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex - offset;
  const nextIndex = Math.min(focusable.length - 1, Math.max(0, baseIndex + offset));
  const target = focusable[nextIndex];
  if (target && typeof target.focus === "function") {
    target.focus({ preventScroll: false });
  }
}

function dispatchSyntheticKeyEvent(target, type, key, code) {
  if (!target || typeof target.dispatchEvent !== "function") return false;
  const event = new KeyboardEvent(type, {
    key,
    code,
    bubbles: true,
    cancelable: true
  });
  return target.dispatchEvent(event);
}

function runRingKeyCommand(action) {
  const command = String(action || "").trim().toLowerCase();
  const active = document.activeElement || document.body;
  const editable = isEditableTarget(active);
  const map = {
    key_arrow_up: { key: "ArrowUp", code: "ArrowUp" },
    key_arrow_down: { key: "ArrowDown", code: "ArrowDown" },
    key_arrow_left: { key: "ArrowLeft", code: "ArrowLeft" },
    key_arrow_right: { key: "ArrowRight", code: "ArrowRight" },
    key_space: { key: " ", code: "Space" },
    key_enter: { key: "Enter", code: "Enter" },
    key_escape: { key: "Escape", code: "Escape" },
    key_tab: { key: "Tab", code: "Tab" },
    key_backspace: { key: "Backspace", code: "Backspace" },
    key_page_up: { key: "PageUp", code: "PageUp" },
    key_page_down: { key: "PageDown", code: "PageDown" },
    key_home: { key: "Home", code: "Home" },
    key_end: { key: "End", code: "End" }
  };
  const descriptor = map[command];
  if (!descriptor) {
    return false;
  }

  dispatchSyntheticKeyEvent(active, "keydown", descriptor.key, descriptor.code);
  dispatchSyntheticKeyEvent(active, "keyup", descriptor.key, descriptor.code);

  if (editable && command !== "key_escape") {
    return true;
  }

  if (command === "key_arrow_up") {
    window.scrollBy({ top: -120, behavior: "smooth" });
  } else if (command === "key_arrow_down") {
    window.scrollBy({ top: 120, behavior: "smooth" });
  } else if (command === "key_arrow_left") {
    window.scrollBy({ left: -120, behavior: "smooth" });
  } else if (command === "key_arrow_right") {
    window.scrollBy({ left: 120, behavior: "smooth" });
  } else if (command === "key_space" || command === "key_page_down") {
    window.scrollBy({ top: Math.max(220, Math.round(window.innerHeight * 0.82)), behavior: "smooth" });
  } else if (command === "key_page_up") {
    window.scrollBy({ top: -Math.max(220, Math.round(window.innerHeight * 0.82)), behavior: "smooth" });
  } else if (command === "key_home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (command === "key_end") {
    const endTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: endTop, behavior: "smooth" });
  } else if (command === "key_enter") {
    if (active && typeof active.click === "function" && !isEditableTarget(active)) {
      active.click();
    }
  } else if (command === "key_escape") {
    if (active && typeof active.blur === "function") {
      active.blur();
    }
  } else if (command === "key_tab") {
    moveFocusByOffset(1);
  } else if (command === "key_backspace") {
    window.history.back();
  }

  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;
  if (message.type === "aqual-reading-mode-state") {
    sendResponse({ enabled: Boolean(state.readingModeEnabled) });
    return false;
  }
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
  if (message.type === "aqual-learn-action") {
    if (window.top !== window) {
      return;
    }
    const payload = message.payload || {};
    (async () => {
      const result = await resolveLearnActionFromPayload(payload);
      sendResponse(result);
    })().catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : "Learn action failed." });
    });
    return true;
  }
  if (message.type === "aqual-gemini-live-status") {
    if (window.top !== window) {
      return;
    }
    const statusText = String(message.status || "Gemini Live");
    const detailText = String(message.detail || "");
    showGeminiLivePanel(statusText, detailText, { sticky: Boolean(message.sticky) });
  }
  if (message.type === "aqual-gemini-live-result") {
    if (window.top !== window) {
      return;
    }
    const ok = Boolean(message.ok);
    if (ok) {
      const transcript = String(message.transcript || "").trim();
      const answer = String(message.answer || "").trim();
      const body = transcript
        ? `You said: ${transcript}\n\n${answer || "No answer returned."}`
        : (answer || "No answer returned.");
      showGeminiLivePanel("Gemini Live response", body, { sticky: true, isError: false });
    } else {
      const error = String(message.error || "Gemini Live request failed.");
      showGeminiLivePanel("Gemini Live error", error, { sticky: true, isError: true });
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
  if (message.type === "aqual-ring-key-command") {
    if (window.top !== window) {
      sendResponse({ ok: true, ignored: true });
      return false;
    }
    runRingKeyCommand(message.action || "");
    sendResponse({ ok: true });
    return false;
  }
});

chrome.storage.sync.get({ ...DEFAULTS, aqualRingButtonActions: RING_BUTTON_ACTION_DEFAULTS }, (stored) => {
  const initialSettings = { ...(stored || {}), readingModeEnabled: false };
  applySettings(initialSettings);
  updateReadingModeStatus("disabled", "Reading mode is off.");
  reportReadingModeState(false);
  ringButtonActionOverrides = normalizeRingButtonActions(stored ? stored.aqualRingButtonActions : null);
  chrome.storage.local.get(RING_EVENT_POLL_DEFAULTS, (localStored) => {
    if (!localStored || localStored.aqualRingBackendPollingEnabled !== false) {
      startRingBackendPolling();
    } else {
      stopRingBackendPolling();
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!changes) {
    return;
  }
  if (areaName === "local" && changes.aqualRingBackendPollingEnabled) {
    const nextValue = changes.aqualRingBackendPollingEnabled.newValue;
    if (nextValue !== false) {
      startRingBackendPolling();
    } else {
      stopRingBackendPolling();
    }
    return;
  }
  if (areaName === "sync" && changes.aqualRingButtonActions) {
    ringButtonActionOverrides = normalizeRingButtonActions(changes.aqualRingButtonActions.newValue);
  }
});

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isImageAssistEvent(event) {
  const target = event && event.target;
  return Boolean(target && target.closest && target.closest(".aqual-inline-image-caption"));
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

function clearInlineImageCaption() {
  if (describedImage) {
    describedImage.classList.remove("aqual-inline-image-described");
  }
  if (describedImageCaptionEl && describedImageCaptionEl.isConnected) {
    describedImageCaptionEl.remove();
  }
  describedImage = null;
  describedImageCaptionEl = null;
  describedImageText = "";
}

function resolveInlineCaptionAnchor(image) {
  if (!image || !image.isConnected) return image;

  const figure = image.closest("figure");
  if (figure) {
    const figureImages = figure.querySelectorAll("img");
    if (figureImages.length === 1 && figureImages[0] === image) {
      return figure;
    }
  }

  const parent = image.parentElement;
  if (parent && parent.tagName && parent.tagName.toLowerCase() === "a" && parent.children.length === 1) {
    return parent;
  }

  return image;
}

function syncInlineCaptionGeometry(image, caption) {
  if (!image || !caption || !image.isConnected || !caption.isConnected) return;
  const imageRect = image.getBoundingClientRect();
  const width = Math.round(imageRect.width);
  if (width > 0) {
    caption.style.width = `${width}px`;
    caption.style.maxWidth = `${width}px`;
  } else {
    caption.style.width = "";
    caption.style.maxWidth = "";
  }

  const imageStyle = window.getComputedStyle(image);
  const captionParent = caption.parentElement;
  const parentStyle = captionParent ? window.getComputedStyle(captionParent) : null;
  const centeredByMargins = imageStyle.marginLeft === "auto" && imageStyle.marginRight === "auto";
  const centeredByTextAlign = parentStyle && parentStyle.textAlign === "center";
  const centered = centeredByMargins || centeredByTextAlign;
  caption.style.marginLeft = centered ? "auto" : "";
  caption.style.marginRight = centered ? "auto" : "";
}

function ensureInlineImageCaption(image) {
  if (!image || !image.isConnected) return null;
  const captionAnchor = resolveInlineCaptionAnchor(image);
  if (!captionAnchor) return null;

  const existing = captionAnchor.nextElementSibling;
  if (existing && existing.classList && existing.classList.contains("aqual-inline-image-caption")) {
    describedImageCaptionEl = existing;
    return existing;
  }

  if (describedImageCaptionEl && describedImageCaptionEl.isConnected) {
    describedImageCaptionEl.remove();
  }

  const caption = document.createElement("div");
  caption.className = "aqual-inline-image-caption";
  caption.innerHTML = `
    <span class="aqual-inline-image-caption-label">Image description</span>
    <div class="aqual-inline-image-caption-text"></div>
  `;
  captionAnchor.insertAdjacentElement("afterend", caption);
  describedImageCaptionEl = caption;
  syncInlineCaptionGeometry(image, caption);
  return caption;
}

function showInlineImageCaption(image, message) {
  if (!image || !image.isConnected) return;

  if (describedImage && describedImage !== image) {
    describedImage.classList.remove("aqual-inline-image-described");
  }

  describedImage = image;
  describedImage.classList.add("aqual-inline-image-described");

  const caption = ensureInlineImageCaption(image);
  if (!caption) return;
  syncInlineCaptionGeometry(image, caption);
  const textEl = caption.querySelector(".aqual-inline-image-caption-text");
  if (textEl) {
    textEl.textContent = message;
  }
}

function showCaptionLoading(image) {
  showInlineImageCaption(image, "Describing image...");
}

function showCaptionError(image, message) {
  showInlineImageCaption(image, message);
}

function showCaptionDescription(image, description) {
  showInlineImageCaption(image, description);
}

async function describeImageFromPage(image) {
  if (!isDescribableImage(image)) return;
  if (describedImage && describedImage !== image) {
    clearInlineImageCaption();
  }

  describedImageText = "";
  showCaptionLoading(image);

  const requestId = ++describeRequestSerial;
  try {
    const payload = await buildDescribedImagePayload(image);
    const data = await fetchJson(`${DOC_SERVER_BASE}/describe-web-image`, payload);
    if (requestId !== describeRequestSerial) return;

    describedImageText = (data.description || "").trim();
    if (!describedImageText) {
      throw new Error("No description returned");
    }
    showCaptionDescription(image, describedImageText);
  } catch (error) {
    if (requestId !== describeRequestSerial) return;
    showCaptionError(image, `Couldn't describe this image: ${error.message}`);
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
  window.addEventListener("resize", () => {
    if (!describedImage || !describedImageCaptionEl) return;
    syncInlineCaptionGeometry(describedImage, describedImageCaptionEl);
  }, true);

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

function ensureGeminiLiveUi() {
  if (geminiLiveHost && geminiLiveEls) return;

  geminiLiveHost = document.createElement("div");
  geminiLiveHost.id = "aqual-gemini-live-host";
  geminiLiveHost.style.position = "fixed";
  geminiLiveHost.style.right = "14px";
  geminiLiveHost.style.bottom = "14px";
  geminiLiveHost.style.width = "min(92vw, 380px)";
  geminiLiveHost.style.zIndex = "2147483647";
  geminiLiveHost.style.display = "none";

  const shadow = geminiLiveHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        font-family: "Lexend", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .card {
        background: #ffffff;
        color: #1f2937;
        border: 1px solid #bbf7d0;
        border-radius: 12px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 11px;
        border-bottom: 1px solid #dcfce7;
        background: #ecfdf5;
      }
      .title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.01em;
        text-transform: none;
        color: #166534;
      }
      .close {
        border: 0;
        background: transparent;
        color: #475569;
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
      }
      .close:hover {
        color: #0f172a;
      }
      .body {
        padding: 10px 12px;
      }
      .status {
        font-size: 12px;
        font-weight: 600;
        color: #166534;
        margin-bottom: 6px;
      }
      .text {
        font-size: 13px;
        line-height: 1.5;
        color: #334155;
        white-space: pre-wrap;
      }
      .text.error {
        color: #b91c1c;
        background: #fef2f2;
        border-left: 3px solid #ef4444;
        padding: 8px 10px;
        border-radius: 6px;
      }
    </style>
    <div class="card" role="status" aria-live="polite">
      <div class="head">
        <span class="title">Gemini Live</span>
        <button id="closeBtn" class="close" type="button" aria-label="Close Gemini Live panel">&times;</button>
      </div>
      <div class="body">
        <div id="status" class="status"></div>
        <div id="text" class="text"></div>
      </div>
    </div>
  `;

  geminiLiveEls = {
    closeBtn: shadow.getElementById("closeBtn"),
    status: shadow.getElementById("status"),
    text: shadow.getElementById("text")
  };

  geminiLiveEls.closeBtn.addEventListener("click", () => {
    if (geminiLiveHideTimer) {
      clearTimeout(geminiLiveHideTimer);
      geminiLiveHideTimer = null;
    }
    geminiLiveHost.style.display = "none";
  });

  (document.body || document.documentElement).appendChild(geminiLiveHost);
}

function showGeminiLivePanel(statusText, bodyText, options = {}) {
  ensureGeminiLiveUi();
  if (!geminiLiveHost || !geminiLiveEls) return;

  const sticky = Boolean(options.sticky);
  const isError = Boolean(options.isError);

  geminiLiveEls.status.textContent = String(statusText || "");
  geminiLiveEls.text.textContent = String(bodyText || "");
  geminiLiveEls.text.classList.toggle("error", isError);
  geminiLiveHost.style.display = "block";

  if (geminiLiveHideTimer) {
    clearTimeout(geminiLiveHideTimer);
    geminiLiveHideTimer = null;
  }
  if (!sticky) {
    geminiLiveHideTimer = setTimeout(() => {
      geminiLiveHideTimer = null;
      if (geminiLiveHost) {
        geminiLiveHost.style.display = "none";
      }
    }, 2600);
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

async function pollRingBackendEvents() {
  if (ringEventPollInFlight) return;
  if (window.top !== window) return;
  if (document.visibilityState !== "visible") return;

  ringEventPollInFlight = true;
  try {
    const url = `${RING_EVENT_POLL_ENDPOINT}?cursor=${encodeURIComponent(String(ringEventCursor || 0))}`;
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const nextCursor = Number(data && data.cursor);
    const delta = Number(data && data.delta);
    const events = Array.isArray(data && data.events) ? data.events : [];
    if (Number.isFinite(nextCursor) && nextCursor >= 0) {
      ringEventCursor = nextCursor;
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }

    if (events.length > 0) {
      for (const entry of events) {
        const payload = entry && typeof entry === "object" ? (entry.payload || {}) : {};
        const actionToken = String(payload.action || "").trim().toLowerCase();
        const buttonLabel = String(payload.buttonLabel || "").trim().toLowerCase();
        const action = resolveRingActionForPayload(buttonLabel, actionToken);
        if (!action || action === "none") {
          continue;
        }
        const now = Date.now();
        const lastAt = Number(ringEventLastActionAt[action] || 0);
        if (now - lastAt < RING_EVENT_LOCAL_DEBOUNCE_MS) {
          continue;
        }
        ringEventLastActionAt[action] = now;
        safeRuntimeMessage({
          type: "aqual-ring-backend-action",
          source: "ring-event-poll",
          action,
          buttonLabel
        });
      }
      return;
    }

    // Each button press toggles mic listening. If we missed multiple events, parity preserves net state.
    if (Math.abs(Math.trunc(delta)) % 2 !== 1) {
      return;
    }

    const now = Date.now();
    if (now - ringEventLastToggleAt < RING_EVENT_LOCAL_DEBOUNCE_MS) {
      return;
    }
    ringEventLastToggleAt = now;
    ringEventLastActionAt.toggle_voice_mic = now;
    safeRuntimeMessage({
      type: "aqual-ring-backend-action",
      source: "ring-event-poll",
      action: "toggle_voice_mic"
    });
  } catch (_error) {
    // Ignore backend polling errors to keep page interaction smooth.
  } finally {
    ringEventPollInFlight = false;
  }
}

function startRingBackendPolling() {
  if (window.top !== window) return;
  if (ringEventPollTimer) return;

  pollRingBackendEvents().catch(() => {
    // Ignore first-poll errors.
  });
  ringEventPollTimer = setInterval(() => {
    pollRingBackendEvents().catch(() => {
      // Ignore interval errors.
    });
  }, RING_EVENT_POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollRingBackendEvents().catch(() => {
        // Ignore wake-up polling errors.
      });
    }
  });
}

function stopRingBackendPolling() {
  if (!ringEventPollTimer) return;
  clearInterval(ringEventPollTimer);
  ringEventPollTimer = null;
  ringEventPollInFlight = false;
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

function stopAudioHotkeySession() {
  if (!audioHotkeyActive) return;
  audioHotkeyActive = false;
  stopAudioHoldPing();
  safeRuntimeMessage({ type: "aqual-audio-hold", action: "stop", holdId: activeAudioHoldId });
  activeAudioHoldId = 0;
}

document.addEventListener("keydown", (event) => {
  pressedKeys.add(event.code);
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight") || event.altKey;
  const isCDown = pressedKeys.has("KeyC") || event.code === "KeyC" || (event.key && event.key.toLowerCase() === "c");
  const isBDown = pressedKeys.has("KeyB") || event.code === "KeyB" || (event.key && event.key.toLowerCase() === "b");
  const isADown = pressedKeys.has("KeyA") || event.code === "KeyA" || (event.key && event.key.toLowerCase() === "a");
  const isDDown = pressedKeys.has("KeyD") || event.code === "KeyD" || (event.key && event.key.toLowerCase() === "d");
  if (event.ctrlKey || event.metaKey) return;

  if (!event.repeat && isAltDown && isCDown) {
    event.preventDefault();
    speakSelectedTextWithElevenLabs();
    return;
  }

  if (!event.repeat && isAltDown && isBDown) {
    event.preventDefault();
    const nextEnabled = !lineGuideEnabled;
    setLineGuideEnabled(nextEnabled);
    state = { ...state, lineGuideEnabled: nextEnabled };
    persistLineGuideSetting(nextEnabled);
    return;
  }

  if (!event.repeat && isAltDown && isDDown) {
    event.preventDefault();
    stopAudioHotkeySession();
    safeRuntimeMessage({ type: "aqual-gemini-live-toggle" });
    showGeminiLivePanel("Gemini Live", "Toggling live call...", { sticky: false });
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
  const isAltDown = pressedKeys.has("AltLeft") || pressedKeys.has("AltRight");

  if (audioHotkeyActive) {
    const isADown = pressedKeys.has("KeyA");
    if (!(isAltDown && isADown)) {
      stopAudioHotkeySession();
    }
  }
}, true);

window.addEventListener("blur", () => {
  stopAudioHotkeySession();
  stopSelectionSpeechPlayback();
  if (lineGuideOverlay) {
    lineGuideOverlay.style.opacity = "0";
  }
  pressedKeys.clear();
});
