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

const COLOR_PALETTE = [
  "#1FBC9C",
  "#1CA085",
  "#2ECC70",
  "#27AF60",
  "#3398DB",
  "#2980B9",
  "#A463BF",
  "#3D556E",
  "#222F3D",
  "#F2C511",
  "#F39C19",
  "#E84A3C",
  "#C0382B",
  "#DDE6E8",
  "#BDC3C8"
];

const FONT_CHOICES = [
  { value: "open-dyslexic", label: "Open Dyslexic" },
  { value: "lexend", label: "Lexend" },
  { value: "sign-language", label: "Sign Language" },
  { value: "arial", label: "Arial" },
  { value: "verdana", label: "Verdana" },
  { value: "impact", label: "Impact" },
  { value: "comic-sans", label: "Comic Sans MS" }
];

const CURSOR_CHOICES = [
  { value: "arrow-large.png", label: "Large Arrow" },
  { value: "black-large.cur", label: "High-Contrast Black" },
  { value: "pencil-large.png", label: "Pencil Pointer" }
];

const COLOR_VISION_CHOICES = [
  { value: "none", label: "None" },
  { value: "protanopia", label: "Protanopia (red-weak)" },
  { value: "deuteranopia", label: "Deuteranopia (green-weak)" },
  { value: "tritanopia", label: "Tritanopia (blue-weak)" }
];

const AUDIO_SERVER_HOST = "localhost:8000";
const DOC_SERVER_BASE = "http://localhost:8080";
const RING_HID_FILTERS = [
  { usagePage: 0x000d, usage: 0x0032 },
  { usagePage: 0x000d, usage: 0x0042 },
  { usagePage: 0x000d }
];
const RING_HID_DEFAULT_STATUS = "Not connected. Press Connect and choose your ring.";
const RING_BUTTON_ORDER = ["right", "left", "bottom", "top", "center", "home"];
const RING_BUTTON_ACTION_DEFAULTS = {
  right: "toggle_image_veil",
  left: "toggle_line_guide",
  bottom: "toggle_font_color",
  top: "toggle_reduced_crowding",
  center: "toggle_voice_mic",
  home: "toggle_high_contrast"
};
const RING_ACTION_OPTIONS = [
  { value: "toggle_voice_mic", label: "Toggle: Voice Commands mic" },
  { value: "toggle_gemini_live", label: "Toggle: Gemini Live call" },
  { value: "toggle_reading_mode", label: "Toggle: AI reading mode" },
  { value: "toggle_high_contrast", label: "Toggle: High contrast" },
  { value: "toggle_night_mode", label: "Toggle: Night reading mode" },
  { value: "toggle_blue_light", label: "Toggle: Blue-light filter" },
  { value: "toggle_dimming", label: "Toggle: Brightness dimming" },
  { value: "toggle_font_family", label: "Toggle: Font family" },
  { value: "toggle_font_size", label: "Toggle: Font size" },
  { value: "toggle_font_color", label: "Toggle: Font colour" },
  { value: "toggle_text_stroke", label: "Toggle: Text stroke" },
  { value: "toggle_reduced_crowding", label: "Toggle: Reduced text crowding" },
  { value: "toggle_link_emphasis", label: "Toggle: Emphasise links" },
  { value: "toggle_cursor", label: "Toggle: Pointer style" },
  { value: "toggle_image_veil", label: "Toggle: Image veil" },
  { value: "toggle_highlight", label: "Toggle: Highlight words" },
  { value: "toggle_line_guide", label: "Toggle: BeeLine line guide" },
  { value: "toggle_drawing", label: "Toggle: Draw on page" },
  { value: "toggle_magnifier", label: "Toggle: Magnifier" },
  { value: "cycle_color_vision", label: "Cycle: Colour vision mode" },
  { value: "cycle_font_family", label: "Cycle: Font family" },
  { value: "cycle_cursor", label: "Cycle: Pointer style" },
  { value: "cycle_font_size", label: "Cycle: Font size" },
  { value: "cycle_magnifier_size", label: "Cycle: Magnifier size" },
  { value: "cycle_magnifier_zoom", label: "Cycle: Magnification" },
  { value: "cycle_dimming_level", label: "Cycle: Dimming level" },
  { value: "cycle_blue_light_level", label: "Cycle: Blue-light level" },
  { value: "cycle_font_color", label: "Cycle: Font colour" },
  { value: "cycle_text_stroke_color", label: "Cycle: Text stroke colour" },
  { value: "clear_drawings", label: "Action: Clear drawings" },
  { value: "print_page", label: "Action: Print page" },
  { value: "capture_screenshot", label: "Action: Capture screenshot" },
  { value: "key_arrow_up", label: "Key: Arrow Up" },
  { value: "key_arrow_down", label: "Key: Arrow Down" },
  { value: "key_arrow_left", label: "Key: Arrow Left" },
  { value: "key_arrow_right", label: "Key: Arrow Right" },
  { value: "key_space", label: "Key: Space" },
  { value: "key_enter", label: "Key: Enter" },
  { value: "key_escape", label: "Key: Escape" },
  { value: "key_tab", label: "Key: Tab" },
  { value: "key_backspace", label: "Key: Backspace" },
  { value: "key_page_up", label: "Key: Page Up" },
  { value: "key_page_down", label: "Key: Page Down" },
  { value: "key_home", label: "Key: Home" },
  { value: "key_end", label: "Key: End" },
  { value: "none", label: "Do nothing" }
];
const RING_ACTION_OPTION_VALUES = new Set(RING_ACTION_OPTIONS.map((item) => item.value));
const FEATURE_ICON_BY_PRIMARY_ID = {
  fontFamilySelect: "text",
  fontSizeRange: "size",
  fontColorPalette: "colour",
  textStrokePalette: "outline",
  reducedCrowdingEnabled: "spacing",
  linkEmphasisEnabled: "link",
  cursorTypeSelect: "pointer",
  readingModeEnabled: "spark",
  docUploadInput: "document",
  imageVeilEnabled: "image",
  highlightEnabled: "highlight",
  lineGuideEnabled: "lineguide",
  drawingEnabled: "draw",
  clearDrawings: "clear",
  magnifierEnabled: "magnifier",
  magnifierSizeRange: "lenssize",
  magnifierZoomRange: "zoom",
  highContrastEnabled: "contrast",
  colorBlindModeSelect: "palette",
  ringHidConnect: "ring",
  nightModeEnabled: "moon",
  dimmingRange: "dim",
  blueLightRange: "warm",
  printPage: "print",
  captureScreenshot: "camera"
};
const FEATURE_ICON_SVG = {
  text: "<path d='M4 6h16M8 11h8M10 16h4' />",
  size: "<path d='M6 18l3-10 3 10M7.2 14h3.6M14.5 8h4M16.5 8v8M14.5 12h4' />",
  colour: "<path d='M12 3c-3 3-6 6-6 9a6 6 0 0 0 12 0c0-3-3-6-6-9z' />",
  outline: "<rect x='5' y='5' width='14' height='14' rx='2' /><path d='M8 8h8v8H8z' />",
  spacing: "<path d='M7 6v12M11 6v12M13 6v12M17 6v12' />",
  link: "<path d='M10 14l4-4' /><path d='M7 15a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 0' /><path d='M17 9a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6 0' />",
  pointer: "<path d='M6 3l10 10-4 1 2 6-2 1-2-6-4 3z' />",
  document: "<path d='M8 3h8l4 4v14H8z' /><path d='M16 3v5h4M11 12h6M11 16h6' />",
  image: "<rect x='4' y='5' width='16' height='14' rx='2' /><path d='M8 14l2-2 2 2 3-3 3 4' /><circle cx='9' cy='9' r='1.2' />",
  highlight: "<path d='M4 20h6M7 17l7-7 3 3-7 7H7zM13 7l2-2 4 4-2 2' />",
  lineguide: "<path d='M4 7h16M4 12h16M4 17h10' /><circle cx='17' cy='17' r='2' />",
  draw: "<path d='M4 20l4-1 10-10-3-3L5 16zM13 6l3 3' />",
  eraser: "<path d='M5 15l6-6 6 6-4 4H9zM14 19h5' />",
  clear: "<path d='M9 6h6M10 6V4h4v2M7 6h10l-1 13H8zM11 10v6M13 10v6' />",
  magnifier: "<circle cx='11' cy='11' r='5' /><path d='M15.5 15.5L20 20' />",
  lenssize: "<circle cx='12' cy='12' r='4' /><path d='M12 4v3M12 17v3M4 12h3M17 12h3' />",
  zoom: "<circle cx='11' cy='11' r='5' /><path d='M11 9v4M9 11h4M15.5 15.5L20 20' />",
  contrast: "<circle cx='12' cy='12' r='8' /><path d='M12 4a8 8 0 0 1 0 16z' />",
  palette: "<path d='M12 4a8 8 0 1 0 0 16h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h2a4 4 0 0 0 0-8z' /><circle cx='8' cy='10' r='1' /><circle cx='11' cy='8' r='1' /><circle cx='15' cy='10' r='1' />",
  ring: "<circle cx='12' cy='12' r='7' /><circle cx='12' cy='12' r='3' />",
  moon: "<path d='M15 3a8 8 0 1 0 6 12 7 7 0 0 1-6-12z' />",
  dim: "<circle cx='12' cy='12' r='3' /><path d='M12 4v2M12 18v2M4 12h2M18 12h2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4' />",
  warm: "<circle cx='12' cy='12' r='4' /><path d='M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1' />",
  print: "<path d='M7 8V4h10v4' /><rect x='6' y='9' width='12' height='7' rx='1.5' /><path d='M8 16h8v4H8z' />",
  camera: "<path d='M4 8h4l2-2h4l2 2h4v10H4z' /><circle cx='12' cy='13' r='3' />",
  spark: "<path d='M12 4l2 4 4 2-4 2-2 4-2-4-4-2 4-2z' />"
};

let state = { ...DEFAULTS };
let ringButtonActions = { ...RING_BUTTON_ACTION_DEFAULTS };
let readingModeStatus = { status: "", detail: "", pageUrl: "" };
let readingModeUnavailableTimer = null;
let scrollPersistTimer = null;
let activeTab = "visual";
let visualSearchActive = false;
let visualSectionOpenSnapshot = null;
let popupInitUiReady = false;
let popupInitAssetsReady = false;
let popupInitCompleted = false;
let popupInitFinalizing = false;

let audioWs = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let analyser = null;
let animationId = null;
let currentMode = "elevenlabs";
let fullTranscript = "";
let transcriptAutoScroll = true;
let isRecording = false;

function normalizeAudioMode(mode) {
  const token = String(mode || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (token === "local" || token === "localwhisper" || token === "whisper") {
    return "local";
  }
  if (token === "elevenlabs" || token === "elevenlab" || token === "eleven" || token === "11labs") {
    return "elevenlabs";
  }
  return "elevenlabs";
}

function setRecordingState(recording) {
  const changed = isRecording !== recording;
  isRecording = recording;
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.disabled = recording;
  });
  const startBtn = byId("audioStart");
  const stopBtn = byId("audioStop");
  if (startBtn) startBtn.disabled = recording;
  if (stopBtn) stopBtn.disabled = !recording;
  updateAudioStatus({ recording });
  if (changed) {
    chrome.storage.local.set({ aqualAudioRecording: recording });
  }
}

function applyModeSelection(mode) {
  const normalizedMode = normalizeAudioMode(mode);
  currentMode = normalizedMode;
  document.querySelectorAll(".mode-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === normalizedMode);
  });
  chrome.storage.sync.set({ aqualAudioMode: normalizedMode });
  chrome.storage.local.set({ aqualAudioMode: normalizedMode });
  chrome.runtime.sendMessage({ type: "aqual-audio-mode", mode: normalizedMode }, () => {
    if (chrome.runtime.lastError) {
      // Ignore if background listener is temporarily unavailable.
    }
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const toggle = byId("themeToggle");
  if (toggle) {
    toggle.textContent = theme === "light" ? "Dark" : "Light";
  }
  chrome.storage.sync.set({ aqualTheme: theme });
}

const byId = (id) => document.getElementById(id);

function setPopupLoadingState(loading) {
  const panel = byId("popupPanel");
  const loadingScreen = byId("popupLoadingScreen");
  if (panel) {
    panel.classList.toggle("is-loading", Boolean(loading));
  }
  if (document.body) {
    document.body.classList.toggle("popup-loading-lock", Boolean(loading));
  }
  if (loading) {
    setScrollTop(0);
  }
  if (loadingScreen) {
    loadingScreen.hidden = !loading;
  }
}

function tryCompletePopupInit() {
  if (popupInitCompleted || popupInitFinalizing) return;
  if (!popupInitUiReady || !popupInitAssetsReady) return;
  popupInitFinalizing = true;
  waitForAnimationFrames(2).then(() => {
    popupInitCompleted = true;
    popupInitFinalizing = false;
    setPopupLoadingState(false);
  });
}

function preloadImageAsset(fileName) {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => {
        if (typeof image.decode === "function") {
          image.decode().then(() => resolve()).catch(() => resolve());
          return;
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = chrome.runtime.getURL(fileName);
      if (image.complete && image.naturalWidth > 0) {
        if (typeof image.decode === "function") {
          image.decode().then(() => resolve()).catch(() => resolve());
          return;
        }
        resolve();
      }
    } catch (_error) {
      resolve();
    }
  });
}

function waitForAnimationFrames(count = 1) {
  return new Promise((resolve) => {
    const remaining = Math.max(1, Number(count) || 1);
    const step = (left) => {
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(left - 1));
    };
    step(remaining);
  });
}

async function waitForCriticalFonts() {
  if (!document.fonts) return;
  const fontPromises = [
    document.fonts.ready.catch(() => {}),
    document.fonts.load('400 14px "Aqual UI"').catch(() => {}),
    document.fonts.load('600 14px "Aqual UI"').catch(() => {}),
    document.fonts.load('700 14px "Aqual UI"').catch(() => {})
  ];
  await Promise.all(fontPromises);
  for (let attempts = 0; attempts < 8; attempts += 1) {
    if (document.fonts.check('14px "Aqual UI"')) {
      return;
    }
    await waitForAnimationFrames(1);
  }
}

async function waitForPopupAssets() {
  const tasks = [
    waitForCriticalFonts(),
    preloadImageAsset("assets/images/linkedin-logo.png"),
    preloadImageAsset("assets/images/aqual-logo.png"),
    waitForAnimationFrames(2)
  ];
  await Promise.all(tasks);
}

function createFeatureIconElement(token) {
  const iconToken = FEATURE_ICON_SVG[token] ? token : "spark";
  const wrapper = document.createElement("span");
  wrapper.className = "feature-icon";
  wrapper.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.classList.add("feature-icon-svg");
  svg.innerHTML = FEATURE_ICON_SVG[iconToken];
  wrapper.appendChild(svg);
  return wrapper;
}

function decorateControlTitlesWithIcons() {
  document.querySelectorAll("#tab-visual .control").forEach((control) => {
    const title = control.querySelector(".control-title");
    if (!title || title.dataset.aqualIconDecorated === "1") {
      return;
    }
    const primaryControl = control.querySelector(".control-actions [id], .palette[id]");
    const primaryId = primaryControl ? primaryControl.id : "";
    const iconToken = FEATURE_ICON_BY_PRIMARY_ID[primaryId] || "spark";
    title.prepend(createFeatureIconElement(iconToken));
    title.dataset.aqualIconDecorated = "1";
  });
}

function getScrollContainer() {
  return document.scrollingElement
    || document.documentElement
    || document.body;
}

function getScrollTop() {
  const container = getScrollContainer();
  return container ? container.scrollTop : 0;
}

function setScrollTop(value) {
  const container = getScrollContainer();
  if (container) {
    container.scrollTop = value;
  }
}

function setToggleText(id, enabled) {
  const el = byId(id);
  if (el) {
    el.textContent = enabled ? "On" : "Off";
  }
}

function applyReadingModeStateText() {
  const el = byId("readingModeEnabledState");
  if (!el) return;
  if (!state.readingModeEnabled) {
    el.textContent = "Off";
    return;
  }
  const statusToken = String(readingModeStatus && readingModeStatus.status ? readingModeStatus.status : "").toLowerCase();
  if (statusToken === "loading") {
    el.textContent = "Loading...";
    return;
  }
  if (statusToken === "error") {
    el.textContent = "Error";
    return;
  }
  if (statusToken === "disabled") {
    el.textContent = "Off";
    return;
  }
  el.textContent = "On";
}

function clearReadingModeUnavailableTimer() {
  if (readingModeUnavailableTimer) {
    clearTimeout(readingModeUnavailableTimer);
    readingModeUnavailableTimer = null;
  }
}

function scheduleReadingModeUnavailableFallback(referenceTs) {
  clearReadingModeUnavailableTimer();
  const baselineTs = Number(referenceTs || Date.now());
  readingModeUnavailableTimer = setTimeout(() => {
    readingModeUnavailableTimer = null;
    if (!state.readingModeEnabled) return;
    const latestTs = Number(readingModeStatus && readingModeStatus.updatedAt ? readingModeStatus.updatedAt : 0);
    const statusToken = String(readingModeStatus && readingModeStatus.status ? readingModeStatus.status : "").toLowerCase();
    if (latestTs > baselineTs) return;
    if (statusToken === "applied" || statusToken === "disabled") return;
    setReadingModeStatusLocal("error", "Reading mode is unavailable on this page.");
  }, 20000);
}

function setReadingModeStatusLocal(status, detail = "") {
  const payload = {
    status: String(status || ""),
    detail: String(detail || ""),
    pageUrl: "",
    updatedAt: Date.now()
  };
  chrome.storage.local.set({ aqualReadingModeStatus: payload });
  readingModeStatus = payload;
  const token = String(payload.status || "").toLowerCase();
  if (token === "applied" || token === "error" || token === "disabled") {
    clearReadingModeUnavailableTimer();
  }
  applyReadingModeStateText();
}

function renderPalette(containerId, name, selected) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = "";

  COLOR_PALETTE.forEach((color, index) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.id = `${name}-${index}`;
    input.value = color;
    if (color.toLowerCase() === (selected || "").toLowerCase()) {
      input.checked = true;
    }

    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.className = "swatch";

    const swatch = document.createElement("span");
    swatch.style.backgroundColor = color;
    label.appendChild(swatch);

    container.appendChild(input);
    container.appendChild(label);
  });
}

function renderSelectOptions(selectId, options, selected) {
  const select = byId(selectId);
  if (!select) return;
  select.innerHTML = "";
  options.forEach((option) => {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (option.value === selected) {
      el.selected = true;
    }
    select.appendChild(el);
  });
}

function persistSettings(partial) {
  chrome.storage.sync.set(partial);
}

function pushStateToActive() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) return;
    const sentAt = Date.now();
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "aqual-apply",
      settings: state
    }, () => {
      if (!chrome.runtime.lastError) return;
      if (!state.readingModeEnabled) return;
      setReadingModeStatusLocal("loading", "Analysing page with Gemini Flash...");
      scheduleReadingModeUnavailableFallback(sentAt);
    });
  });
}

function refreshReadingModeStateFromActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length || typeof tabs[0].id !== "number") {
      state.readingModeEnabled = false;
      const input = byId("readingModeEnabled");
      if (input) input.checked = false;
      applyReadingModeStateText();
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: "aqual-reading-mode-state" }, (response) => {
      if (chrome.runtime.lastError) {
        state.readingModeEnabled = false;
      } else {
        state.readingModeEnabled = Boolean(response && response.enabled);
      }
      const input = byId("readingModeEnabled");
      if (input) input.checked = state.readingModeEnabled;
      applyReadingModeStateText();
    });
  });
}

function updateRangeValue(id, value) {
  const el = byId(id);
  if (el) {
    el.textContent = value;
  }
}

function setActiveTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
  chrome.storage.sync.set({ aqualUiTab: tabId });

  const scrollKey = tabId === "audio" ? "aqualUiScrollTopAudio" : "aqualUiScrollTopVisual";
  chrome.storage.sync.get({ [scrollKey]: 0 }, (stored) => {
    requestAnimationFrame(() => {
      setScrollTop(stored[scrollKey] || 0);
    });
  });
}

function setAboutPanelOpen(open) {
  const panel = document.querySelector("main.panel");
  const aboutPanel = byId("aboutPanel");
  const aboutToggle = byId("aboutToggle");
  if (!panel || !aboutPanel || !aboutToggle) {
    return;
  }
  panel.classList.toggle("about-open", Boolean(open));
  aboutPanel.hidden = !open;
  aboutToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function updateAudioStatus({ recording }) {
  const label = byId("audioStatusText");
  if (label) {
    label.textContent = recording ? "Recording" : "Idle";
  }
}

function openMicPermissionPage() {
  const url = chrome.runtime.getURL("pages/mic-permission/mic-permission.html?auto=1");
  chrome.tabs.create({ url });
}

function toHexId(value) {
  return Number(value || 0).toString(16).padStart(4, "0").toUpperCase();
}

function formatRingHidDeviceLabel(device) {
  if (!device) return "ring device";
  const name = String(device.productName || "").trim();
  const ids = `VID ${toHexId(device.vendorId)} PID ${toHexId(device.productId)}`;
  return name ? `${name} (${ids})` : ids;
}

function normalizeRingButtonActions(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const button of RING_BUTTON_ORDER) {
    const fallback = RING_BUTTON_ACTION_DEFAULTS[button];
    const requested = String(source[button] || "").trim().toLowerCase();
    normalized[button] = RING_ACTION_OPTION_VALUES.has(requested) ? requested : fallback;
  }
  return normalized;
}

function renderRingButtonActionSelect(selectEl, selectedAction) {
  if (!selectEl) return;
  const selected = String(selectedAction || "").trim().toLowerCase();
  selectEl.innerHTML = "";
  for (const option of RING_ACTION_OPTIONS) {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    if (option.value === selected) {
      item.selected = true;
    }
    selectEl.appendChild(item);
  }
}

function hydrateRingButtonActions(rawActions) {
  ringButtonActions = normalizeRingButtonActions(rawActions);
  document.querySelectorAll(".ring-button-action-select").forEach((selectEl) => {
    const button = String(selectEl.dataset.ringButton || "").trim().toLowerCase();
    const selected = ringButtonActions[button] || RING_BUTTON_ACTION_DEFAULTS[button] || "toggle_voice_mic";
    renderRingButtonActionSelect(selectEl, selected);
  });
}

function persistRingButtonActions() {
  chrome.storage.sync.set({ aqualRingButtonActions: { ...ringButtonActions } });
}

function setRingSettingsOpen(open) {
  const panel = byId("ringHidSettingsPanel");
  const settingsButton = byId("ringHidSettingsToggle");
  if (!panel) return;
  panel.hidden = !open;
  if (settingsButton) {
    settingsButton.setAttribute("aria-expanded", open ? "true" : "false");
  }
}

function openRingSettings() {
  setRingSettingsOpen(true);
}

function closeRingSettings() {
  setRingSettingsOpen(false);
}

function renderRingHidState(stored = {}) {
  const statusEl = byId("ringHidStatus");
  const connectBtn = byId("ringHidConnect");
  const forgetBtn = byId("ringHidForget");
  if (!statusEl || !connectBtn || !forgetBtn) return;

  const enabled = Boolean(stored.aqualRingHidEnabled);
  const statusText = String(stored.aqualRingHidStatus || "").trim();
  const hasDevice = Boolean(stored.aqualRingHidDevice);

  if (statusText) {
    statusEl.textContent = statusText;
  } else if (enabled && hasDevice) {
    statusEl.textContent = `Connected: ${formatRingHidDeviceLabel(stored.aqualRingHidDevice)}`;
  } else {
    statusEl.textContent = RING_HID_DEFAULT_STATUS;
  }

  connectBtn.textContent = enabled ? "Reconnect ring" : "Connect ring";
  forgetBtn.disabled = !enabled && !hasDevice;
}

function refreshRingHidState() {
  chrome.storage.local.get({
    aqualRingHidEnabled: false,
    aqualRingHidDevice: null,
    aqualRingHidStatus: ""
  }, (stored) => {
    renderRingHidState(stored);
  });
}

function setRingStatusText(text) {
  const statusEl = byId("ringHidStatus");
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : "";
      resolve({ response, error });
    });
  });
}

async function connectRingHid() {
  if (!navigator.hid || !navigator.hid.requestDevice) {
    setRingStatusText("WebHID is unavailable in this browser context.");
    return;
  }

  setRingStatusText("Choose your ring in the HID picker...");
  let selectedDevice = null;
  try {
    const devices = await navigator.hid.requestDevice({ filters: RING_HID_FILTERS });
    if (!devices || !devices.length) {
      setRingStatusText("No ring selected.");
      return;
    }
    selectedDevice = devices[0];
  } catch (_error) {
    setRingStatusText("Device picker closed.");
    return;
  }

  const deviceInfo = {
    vendorId: Number(selectedDevice.vendorId || 0),
    productId: Number(selectedDevice.productId || 0),
    productName: String(selectedDevice.productName || "Ring HID device")
  };

  chrome.storage.local.set({
    aqualRingHidEnabled: true,
    aqualRingHidDevice: deviceInfo,
    aqualRingHidStatus: `Connecting ${formatRingHidDeviceLabel(deviceInfo)}...`
  });

  const { response, error } = await sendRuntimeMessage({
    type: "aqual-ring-hid-connect",
    device: deviceInfo
  });

  if (error) {
    setRingStatusText(`Ring setup failed: ${error}`);
    return;
  }
  if (!response || !response.ok) {
    const message = (response && response.error) ? response.error : "unknown error";
    setRingStatusText(`Ring setup failed: ${message}`);
    return;
  }

  refreshRingHidState();
}

async function forgetRingHid() {
  setRingStatusText("Forgetting ring...");
  const { response, error } = await sendRuntimeMessage({ type: "aqual-ring-hid-disconnect" });
  if (error) {
    setRingStatusText(`Forget failed: ${error}`);
    return;
  }
  if (!response || !response.ok) {
    const message = (response && response.error) ? response.error : "unknown error";
    setRingStatusText(`Forget failed: ${message}`);
    return;
  }
  refreshRingHidState();
}

async function refreshMicPermissionState() {
  const button = byId("audioPermission");
  const note = byId("audioPermissionNote");
  if (!button || !note) return;

  const setDisplay = (visible, message) => {
    button.style.display = visible ? "inline-flex" : "none";
    note.textContent = message;
    note.style.display = visible ? "block" : "none";
  };

  if (!navigator.permissions || !navigator.permissions.query) {
    chrome.storage.local.get({ aqualMicPermissionGranted: null }, (stored) => {
      if (stored.aqualMicPermissionGranted === true) {
        setDisplay(false, "Microphone access granted.");
      } else {
        setDisplay(true, "Microphone permission required. Open the permission page to grant access.");
      }
    });
    return;
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    if (status.state === "granted") {
      setDisplay(false, "");
    } else if (status.state === "denied") {
      setDisplay(true, "Microphone blocked. Open the permission page to grant access.");
    } else {
      setDisplay(true, "Microphone permission required. Open the permission page to grant access.");
    }
    status.onchange = () => {
      refreshMicPermissionState();
    };
  } catch (err) {
    chrome.storage.local.get({ aqualMicPermissionGranted: null }, (stored) => {
      if (stored.aqualMicPermissionGranted === true) {
        setDisplay(false, "");
      } else {
        setDisplay(true, "Microphone permission required. Open the permission page to grant access.");
      }
    });
  }
}

function resizeAudioCanvas() {
  const canvas = byId("audioVisualizer");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
}

function shouldStickToBottom(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
}

function setTranscriptText(text) {
  const transcript = byId("audioTranscript");
  if (!transcript) return;
  const stick = transcriptAutoScroll || shouldStickToBottom(transcript);
  transcript.textContent = text;
  if (stick) {
    transcript.scrollTop = transcript.scrollHeight;
  }
}


function drawAudioVisualizer() {
  if (!analyser) return;
  const canvas = byId("audioVisualizer");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const barWidth = (canvas.width / bufferLength) * 2.5;
  let x = 0;
  for (let i = 0; i < bufferLength; i += 1) {
    const barHeight = (dataArray[i] / 255) * canvas.height;
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
    gradient.addColorStop(0, "#22d3ee");
    gradient.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
  animationId = requestAnimationFrame(drawAudioVisualizer);
}

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function downsample(buffer, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }
  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    result[i] = buffer[Math.round(i * ratio)];
  }
  return result;
}

async function startRecording() {
  if (isRecording) return;
  fullTranscript = "";
  transcriptAutoScroll = true;
  setTranscriptText("Connecting...");
  setRecordingState(true);
  try {
    if (currentMode === "elevenlabs") {
      await startElevenLabs();
    } else {
      await startLocalWhisper();
    }
  } catch (err) {
    setRecordingState(false);
    throw err;
  }
}

async function startElevenLabs() {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/elevenlabs`;
  audioWs = new WebSocket(wsUrl);

  audioWs.onopen = () => {
    setTranscriptText("Listening...");
  };

  audioWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.message_type === "partial_transcript") {
      const displayText = `${fullTranscript} ${data.text || ""}`.trim();
      setTranscriptText(displayText || "Listening...");
    } else if (data.message_type === "committed_transcript" || data.message_type === "final_transcript") {
      if (data.text) {
        fullTranscript = `${fullTranscript} ${data.text}`.trim();
        setTranscriptText(fullTranscript);
      }
    } else if (data.error) {
      setRecordingState(false);
      setTranscriptText(`Error: ${data.error}`);
    }
  };

  audioWs.onclose = () => {
    setRecordingState(false);
  };

  audioWs.onerror = () => {
    cleanupAudioSession();
    setRecordingState(false);
    setTranscriptText("Connection error. Is the audio server running?");
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    handleAudioInitError(err);
    return;
  }

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  processor = audioContext.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (e) => {
    if (audioWs && audioWs.readyState === WebSocket.OPEN) {
      const inputData = e.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, audioContext.sampleRate, 16000);
      const pcmData = floatTo16BitPCM(resampled);
      const base64Audio = arrayBufferToBase64(pcmData.buffer);
      audioWs.send(JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: base64Audio,
        sample_rate: 16000
      }));
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  resizeAudioCanvas();
  drawAudioVisualizer();
}

async function startLocalWhisper() {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/audio`;
  audioWs = new WebSocket(wsUrl);

  audioWs.onopen = () => {
    setTranscriptText("Listening...");
  };

  audioWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.text) {
      setTranscriptText(data.text);
    }
  };

  audioWs.onclose = () => {
    setRecordingState(false);
  };

  audioWs.onerror = () => {
    cleanupAudioSession();
    setRecordingState(false);
    setTranscriptText("Connection error. Is the audio server running?");
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
  } catch (err) {
    handleAudioInitError(err);
    return;
  }

  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (audioWs && audioWs.readyState === WebSocket.OPEN) {
      const inputData = e.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, audioContext.sampleRate, 16000);
      const pcmData = floatTo16BitPCM(resampled);
      audioWs.send(pcmData.buffer);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  resizeAudioCanvas();
  drawAudioVisualizer();
}

function cleanupAudioSession() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (audioWs) {
    audioWs.close();
    audioWs = null;
  }
  analyser = null;
}

function handleAudioInitError(err) {
  cleanupAudioSession();
  let message = "Microphone permission required.";
  if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    message = "Microphone permission denied. Allow access and try again.";
  } else if (err && err.message) {
    message = `Audio error: ${err.message}`;
  }
  setRecordingState(false);
  setTranscriptText(message);
  refreshMicPermissionState();
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: "aqual-audio-stop" });
  if (audioWs || mediaStream || audioContext || processor) {
    cleanupAudioSession();
    setRecordingState(false);
  }
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  });

  document.querySelectorAll("details.group").forEach((section) => {
    section.addEventListener("toggle", () => {
      if (visualSearchActive) {
        updateToggleSectionsLabel();
        return;
      }
      const openState = {};
      document.querySelectorAll("#tab-visual details.group").forEach((item) => {
        if (item.id) {
          openState[item.id] = item.open;
        }
      });
      chrome.storage.sync.set({ aqualUiSections: openState });
      updateToggleSectionsLabel();
    });
  });

  const scrollContainer = getScrollContainer();
  if (scrollContainer) {
    scrollContainer.addEventListener("scroll", () => {
      if (scrollPersistTimer) {
        clearTimeout(scrollPersistTimer);
      }
      scrollPersistTimer = setTimeout(() => {
        const scrollTop = getScrollTop();
        const scrollKey = activeTab === "audio" ? "aqualUiScrollTopAudio" : "aqualUiScrollTopVisual";
        chrome.storage.sync.set({ [scrollKey]: scrollTop });
      }, 120);
    });
  }

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (isRecording) {
        return;
      }
      applyModeSelection(button.dataset.mode);
    });
  });

  const permissionButton = byId("audioPermission");
  if (permissionButton) {
    permissionButton.addEventListener("click", () => {
      openMicPermissionPage();
    });
  }

  const ringConnectButton = byId("ringHidConnect");
  if (ringConnectButton) {
    ringConnectButton.addEventListener("click", () => {
      connectRingHid().catch((error) => {
        setRingStatusText(`Ring setup failed: ${error.message}`);
      });
    });
  }

  const ringForgetButton = byId("ringHidForget");
  if (ringForgetButton) {
    ringForgetButton.addEventListener("click", () => {
      forgetRingHid().catch((error) => {
        setRingStatusText(`Forget failed: ${error.message}`);
      });
    });
  }

  const ringSettingsButton = byId("ringHidSettingsToggle");
  if (ringSettingsButton) {
    ringSettingsButton.addEventListener("click", () => {
      openRingSettings();
    });
  }
  const ringSettingsDoneButton = byId("ringHidSettingsDone");
  if (ringSettingsDoneButton) {
    ringSettingsDoneButton.addEventListener("click", () => {
      closeRingSettings();
    });
  }

  document.querySelectorAll(".ring-button-action-select").forEach((selectEl) => {
    selectEl.addEventListener("change", (event) => {
      const button = String(selectEl.dataset.ringButton || "").trim().toLowerCase();
      if (!button || !Object.prototype.hasOwnProperty.call(RING_BUTTON_ACTION_DEFAULTS, button)) {
        return;
      }
      const nextAction = String(event.target.value || "").trim().toLowerCase();
      ringButtonActions[button] = RING_ACTION_OPTION_VALUES.has(nextAction)
        ? nextAction
        : RING_BUTTON_ACTION_DEFAULTS[button];
      persistRingButtonActions();
    });
  });

  const themeToggle = byId("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "light" ? "dark" : "light");
    });
  }

  const aboutToggle = byId("aboutToggle");
  if (aboutToggle) {
    aboutToggle.addEventListener("click", () => {
      const expanded = aboutToggle.getAttribute("aria-expanded") === "true";
      setAboutPanelOpen(!expanded);
    });
  }

  const aboutBackButton = byId("aboutBackButton");
  if (aboutBackButton) {
    aboutBackButton.addEventListener("click", () => {
      setAboutPanelOpen(false);
    });
  }

  const transcript = byId("audioTranscript");
  if (transcript) {
    transcript.addEventListener("scroll", () => {
      transcriptAutoScroll = shouldStickToBottom(transcript);
    });
  }

  byId("audioStart").addEventListener("click", () => {
    startRecording().catch((error) => {
      setRecordingState(false);
      setTranscriptText(`Error: ${error.message}`);
    });
  });

  byId("audioStop").addEventListener("click", () => {
    stopRecording();
  });

  const toggleSections = byId("toggleSections");
  if (toggleSections) {
    toggleSections.addEventListener("click", () => {
      if (visualSearchActive) {
        return;
      }
      const sections = Array.from(document.querySelectorAll("#tab-visual details.group"));
      const allOpen = sections.length > 0 && sections.every((section) => section.open);
      setAllSections(!allOpen);
    });
  }

  const visualSearchInput = byId("visualSearchInput");
  if (visualSearchInput) {
    visualSearchInput.addEventListener("input", (event) => {
      applyVisualSearchFilter(event.target.value);
    });
    visualSearchInput.addEventListener("search", (event) => {
      applyVisualSearchFilter(event.target.value);
    });
  }

  byId("docUploadButton").addEventListener("click", async () => {
    const input = byId("docUploadInput");
    const status = byId("docUploadStatus");
    if (!input || !input.files || input.files.length === 0) {
      status.textContent = "Select a DOCX file first.";
      return;
    }

    const file = input.files[0];
    status.textContent = "Uploading document...";

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${DOC_SERVER_BASE}/convert`, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (data.error) {
        status.textContent = `Upload failed: ${data.error}`;
        return;
      }

      chrome.storage.local.set({
        aqualBionicDocument: {
          html: data.html,
          filename: data.filename,
          docId: data.docId
        }
      }, () => {
        status.textContent = "Opening Reading Assist viewer...";
        chrome.tabs.create({ url: chrome.runtime.getURL("pages/bionic-viewer/bionic-viewer.html") });
      });
    } catch (error) {
      status.textContent = `Upload error: ${error.message}`;
    }
  });

  byId("docUploadInput").addEventListener("change", (e) => {
    const status = byId("docUploadStatus");
    if (!e.target.files || e.target.files.length === 0) {
      status.textContent = "Waiting for a file.";
      return;
    }
    status.textContent = `Ready: ${e.target.files[0].name}`;
  });

  byId("fontEnabled").addEventListener("change", (e) => {
    state.fontEnabled = e.target.checked;
    setToggleText("fontEnabledState", state.fontEnabled);
    persistSettings({ fontEnabled: state.fontEnabled });
    pushStateToActive();
  });

  byId("fontFamilySelect").addEventListener("change", (e) => {
    state.fontFamily = e.target.value;
    persistSettings({ fontFamily: state.fontFamily });
    pushStateToActive();
  });

  byId("fontSizeRange").addEventListener("input", (e) => {
    state.fontSizePx = Number(e.target.value);
    updateRangeValue("fontSizeValue", `${state.fontSizePx}px`);
    persistSettings({ fontSizePx: state.fontSizePx });
    pushStateToActive();
  });

  byId("fontSizeEnabled").addEventListener("change", (e) => {
    state.fontSizeEnabled = e.target.checked;
    setToggleText("fontSizeEnabledState", state.fontSizeEnabled);
    persistSettings({ fontSizeEnabled: state.fontSizeEnabled });
    pushStateToActive();
  });

  byId("fontColorEnabled").addEventListener("change", (e) => {
    state.fontColorEnabled = e.target.checked;
    setToggleText("fontColorEnabledState", state.fontColorEnabled);
    persistSettings({ fontColorEnabled: state.fontColorEnabled });
    pushStateToActive();
  });

  byId("textStrokeEnabled").addEventListener("change", (e) => {
    state.textStrokeEnabled = e.target.checked;
    setToggleText("textStrokeEnabledState", state.textStrokeEnabled);
    persistSettings({ textStrokeEnabled: state.textStrokeEnabled });
    pushStateToActive();
  });

  byId("magnifierEnabled").addEventListener("change", (e) => {
    state.magnifierEnabled = e.target.checked;
    setToggleText("magnifierEnabledState", state.magnifierEnabled);
    persistSettings({ magnifierEnabled: state.magnifierEnabled });
    pushStateToActive();
  });

  byId("magnifierSizeRange").addEventListener("input", (e) => {
    state.magnifierSize = Number(e.target.value);
    updateRangeValue("magnifierSizeValue", `${state.magnifierSize}px`);
    persistSettings({ magnifierSize: state.magnifierSize });
    pushStateToActive();
  });

  byId("magnifierZoomRange").addEventListener("input", (e) => {
    state.magnifierZoom = Number(e.target.value);
    updateRangeValue("magnifierZoomValue", `${state.magnifierZoom}x`);
    persistSettings({ magnifierZoom: state.magnifierZoom });
    pushStateToActive();
  });

  byId("imageVeilEnabled").addEventListener("change", (e) => {
    state.imageVeilEnabled = e.target.checked;
    setToggleText("imageVeilEnabledState", state.imageVeilEnabled);
    persistSettings({ imageVeilEnabled: state.imageVeilEnabled });
    pushStateToActive();
  });

  byId("highlightEnabled").addEventListener("change", (e) => {
    state.highlightEnabled = e.target.checked;
    setToggleText("highlightEnabledState", state.highlightEnabled);
    persistSettings({ highlightEnabled: state.highlightEnabled });
    pushStateToActive();
  });

  byId("linkEmphasisEnabled").addEventListener("change", (e) => {
    state.linkEmphasisEnabled = e.target.checked;
    setToggleText("linkEmphasisEnabledState", state.linkEmphasisEnabled);
    persistSettings({ linkEmphasisEnabled: state.linkEmphasisEnabled });
    pushStateToActive();
  });

  byId("cursorEnabled").addEventListener("change", (e) => {
    state.cursorEnabled = e.target.checked;
    setToggleText("cursorEnabledState", state.cursorEnabled);
    persistSettings({ cursorEnabled: state.cursorEnabled });
    pushStateToActive();
  });

  byId("cursorTypeSelect").addEventListener("change", (e) => {
    state.cursorType = e.target.value;
    persistSettings({ cursorType: state.cursorType });
    pushStateToActive();
  });

  byId("readingModeEnabled").addEventListener("change", (e) => {
    state.readingModeEnabled = e.target.checked;
    if (state.readingModeEnabled) {
      setReadingModeStatusLocal("loading", "Analysing page with Gemini Flash...");
    } else {
      clearReadingModeUnavailableTimer();
      setReadingModeStatusLocal("disabled", "Reading mode is off.");
    }
    pushStateToActive();
  });

  byId("reducedCrowdingEnabled").addEventListener("change", (e) => {
    state.reducedCrowdingEnabled = e.target.checked;
    setToggleText("reducedCrowdingEnabledState", state.reducedCrowdingEnabled);
    persistSettings({ reducedCrowdingEnabled: state.reducedCrowdingEnabled });
    pushStateToActive();
  });

  byId("drawingEnabled").addEventListener("change", (e) => {
    state.drawingEnabled = e.target.checked;
    setToggleText("drawingEnabledState", state.drawingEnabled);
    persistSettings({ drawingEnabled: state.drawingEnabled });
    pushStateToActive();
  });

  byId("lineGuideEnabled").addEventListener("change", (e) => {
    state.lineGuideEnabled = e.target.checked;
    setToggleText("lineGuideEnabledState", state.lineGuideEnabled);
    persistSettings({ lineGuideEnabled: state.lineGuideEnabled });
    pushStateToActive();
  });

  byId("highContrastEnabled").addEventListener("change", (e) => {
    state.highContrastEnabled = e.target.checked;
    setToggleText("highContrastEnabledState", state.highContrastEnabled);
    persistSettings({ highContrastEnabled: state.highContrastEnabled });
    pushStateToActive();
  });

  byId("nightModeEnabled").addEventListener("change", (e) => {
    state.nightModeEnabled = e.target.checked;
    setToggleText("nightModeEnabledState", state.nightModeEnabled);
    persistSettings({ nightModeEnabled: state.nightModeEnabled });
    pushStateToActive();
  });

  byId("dimmingEnabled").addEventListener("change", (e) => {
    state.dimmingEnabled = e.target.checked;
    setToggleText("dimmingEnabledState", state.dimmingEnabled);
    persistSettings({ dimmingEnabled: state.dimmingEnabled });
    pushStateToActive();
  });

  byId("dimmingRange").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    state.dimmingLevel = value / 100;
    updateRangeValue("dimmingValue", `${value}%`);
    persistSettings({ dimmingLevel: state.dimmingLevel });
    pushStateToActive();
  });

  byId("blueLightEnabled").addEventListener("change", (e) => {
    state.blueLightEnabled = e.target.checked;
    setToggleText("blueLightEnabledState", state.blueLightEnabled);
    persistSettings({ blueLightEnabled: state.blueLightEnabled });
    pushStateToActive();
  });

  byId("blueLightRange").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    state.blueLightLevel = value / 100;
    updateRangeValue("blueLightValue", `${value}%`);
    persistSettings({ blueLightLevel: state.blueLightLevel });
    pushStateToActive();
  });

  byId("colorBlindModeSelect").addEventListener("change", (e) => {
    state.colorBlindMode = e.target.value;
    persistSettings({ colorBlindMode: state.colorBlindMode });
    pushStateToActive();
  });

  byId("printPage").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "aqual-print" });
    });
  });

  byId("captureScreenshot").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "aqual-screenshot" });
  });

  byId("clearDrawings").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "aqual-clear-drawings" });
    });
  });

  byId("resetDefaults").addEventListener("click", () => {
    const searchInput = byId("visualSearchInput");
    if (searchInput) {
      searchInput.value = "";
    }
    applyVisualSearchFilter("");
    state = { ...DEFAULTS };
    chrome.storage.sync.set({ ...DEFAULTS }, () => {
      hydrateUI(state);
      pushStateToActive();
    });
  });

  byId("fontColorPalette").addEventListener("change", (e) => {
    if (e.target && e.target.name === "fontColor") {
      state.fontColor = e.target.value;
      persistSettings({ fontColor: state.fontColor });
      pushStateToActive();
    }
  });

  byId("textStrokePalette").addEventListener("change", (e) => {
    if (e.target && e.target.name === "textStroke") {
      state.textStrokeColor = e.target.value;
      persistSettings({ textStrokeColor: state.textStrokeColor });
      pushStateToActive();
    }
  });
}

function hydrateUI(settings) {
  state = { ...DEFAULTS, ...settings, readingModeEnabled: false };

  renderSelectOptions("fontFamilySelect", FONT_CHOICES, state.fontFamily);
  renderSelectOptions("cursorTypeSelect", CURSOR_CHOICES, state.cursorType);
  renderSelectOptions("colorBlindModeSelect", COLOR_VISION_CHOICES, state.colorBlindMode);

  renderPalette("fontColorPalette", "fontColor", state.fontColor);
  renderPalette("textStrokePalette", "textStroke", state.textStrokeColor);

  byId("fontEnabled").checked = state.fontEnabled;
  byId("fontSizeEnabled").checked = state.fontSizeEnabled;
  byId("fontColorEnabled").checked = state.fontColorEnabled;
  byId("textStrokeEnabled").checked = state.textStrokeEnabled;
  byId("magnifierEnabled").checked = state.magnifierEnabled;
  byId("imageVeilEnabled").checked = state.imageVeilEnabled;
  byId("highlightEnabled").checked = state.highlightEnabled;
  byId("linkEmphasisEnabled").checked = state.linkEmphasisEnabled;
  byId("cursorEnabled").checked = state.cursorEnabled;
  byId("readingModeEnabled").checked = false;
  byId("reducedCrowdingEnabled").checked = state.reducedCrowdingEnabled;
  byId("drawingEnabled").checked = state.drawingEnabled;
  byId("lineGuideEnabled").checked = state.lineGuideEnabled;
  byId("highContrastEnabled").checked = state.highContrastEnabled;
  byId("nightModeEnabled").checked = state.nightModeEnabled;
  byId("dimmingEnabled").checked = state.dimmingEnabled;
  byId("blueLightEnabled").checked = state.blueLightEnabled;

  byId("fontSizeRange").value = state.fontSizePx;
  byId("magnifierSizeRange").value = state.magnifierSize;
  byId("magnifierZoomRange").value = state.magnifierZoom;
  byId("dimmingRange").value = Math.round(state.dimmingLevel * 100);
  byId("blueLightRange").value = Math.round(state.blueLightLevel * 100);

  updateRangeValue("fontSizeValue", `${state.fontSizePx}px`);
  updateRangeValue("magnifierSizeValue", `${state.magnifierSize}px`);
  updateRangeValue("magnifierZoomValue", `${state.magnifierZoom}x`);
  updateRangeValue("dimmingValue", `${Math.round(state.dimmingLevel * 100)}%`);
  updateRangeValue("blueLightValue", `${Math.round(state.blueLightLevel * 100)}%`);

  setToggleText("fontEnabledState", state.fontEnabled);
  setToggleText("fontSizeEnabledState", state.fontSizeEnabled);
  setToggleText("fontColorEnabledState", state.fontColorEnabled);
  setToggleText("textStrokeEnabledState", state.textStrokeEnabled);
  setToggleText("magnifierEnabledState", state.magnifierEnabled);
  setToggleText("imageVeilEnabledState", state.imageVeilEnabled);
  setToggleText("highlightEnabledState", state.highlightEnabled);
  setToggleText("linkEmphasisEnabledState", state.linkEmphasisEnabled);
  setToggleText("cursorEnabledState", state.cursorEnabled);
  applyReadingModeStateText();
  setToggleText("reducedCrowdingEnabledState", state.reducedCrowdingEnabled);
  setToggleText("drawingEnabledState", state.drawingEnabled);
  setToggleText("lineGuideEnabledState", state.lineGuideEnabled);
  setToggleText("highContrastEnabledState", state.highContrastEnabled);
  setToggleText("nightModeEnabledState", state.nightModeEnabled);
  setToggleText("dimmingEnabledState", state.dimmingEnabled);
  setToggleText("blueLightEnabledState", state.blueLightEnabled);
}

function restoreUiState() {
  chrome.storage.sync.get({
    aqualUiSections: null,
    aqualUiTab: "visual",
    aqualUiScrollTopVisual: 0,
    aqualUiScrollTopAudio: 0
  }, (stored) => {
    const sections = stored.aqualUiSections;
    if (sections) {
      Object.entries(sections).forEach(([id, open]) => {
        const el = byId(id);
        if (el) {
          el.open = Boolean(open);
        }
      });
    }

    setActiveTab(stored.aqualUiTab || "visual");
    requestAnimationFrame(() => {
      const scrollKey = activeTab === "audio" ? "aqualUiScrollTopAudio" : "aqualUiScrollTopVisual";
      const scrollTop = stored[scrollKey] || 0;
      setScrollTop(scrollTop);
    });
    updateToggleSectionsLabel();
  });
}

function updateToggleSectionsLabel() {
  const button = byId("toggleSections");
  if (!button) return;
  if (visualSearchActive) {
    button.textContent = "Search active";
    return;
  }
  const sections = Array.from(document.querySelectorAll("#tab-visual details.group"));
  const allOpen = sections.length > 0 && sections.every((section) => section.open);
  button.textContent = allOpen ? "Collapse all" : "Expand all";
}

function setAllSections(open) {
  const sections = Array.from(document.querySelectorAll("#tab-visual details.group"));
  const openState = {};
  sections.forEach((section) => {
    if (section.style.display === "none") {
      return;
    }
    section.open = open;
    if (section.id) {
      openState[section.id] = open;
    }
  });
  chrome.storage.sync.set({ aqualUiSections: openState });
  updateToggleSectionsLabel();
}

function getVisualSections() {
  return Array.from(document.querySelectorAll("#tab-visual details.group"));
}

function normalizeSearchValue(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getControlSearchText(control, sectionSummaryText) {
  if (!control) return "";
  if (!control.dataset.aqualSearchText) {
    const rawText = `${sectionSummaryText} ${control.textContent || ""}`;
    control.dataset.aqualSearchText = normalizeSearchValue(rawText);
  }
  return control.dataset.aqualSearchText;
}

function setVisualSearchActive(active) {
  visualSearchActive = active;
  const toggleButton = byId("toggleSections");
  if (toggleButton) {
    toggleButton.disabled = active;
  }
  updateToggleSectionsLabel();
}

function applyVisualSearchFilter(rawQuery) {
  const query = normalizeSearchValue(rawQuery);
  const sections = getVisualSections();
  const emptyState = byId("visualSearchEmpty");

  if (!query) {
    sections.forEach((section) => {
      section.style.display = "";
      const controls = Array.from(section.querySelectorAll(":scope > .control"));
      controls.forEach((control) => {
        control.style.display = "";
      });
    });

    if (visualSectionOpenSnapshot) {
      sections.forEach((section) => {
        if (section.id && Object.prototype.hasOwnProperty.call(visualSectionOpenSnapshot, section.id)) {
          section.open = Boolean(visualSectionOpenSnapshot[section.id]);
        }
      });
    }

    visualSectionOpenSnapshot = null;
    setVisualSearchActive(false);
    if (emptyState) {
      emptyState.hidden = true;
    }
    return;
  }

  if (!visualSearchActive) {
    visualSectionOpenSnapshot = {};
    sections.forEach((section) => {
      if (section.id) {
        visualSectionOpenSnapshot[section.id] = section.open;
      }
    });
  }

  setVisualSearchActive(true);

  let totalMatches = 0;
  sections.forEach((section) => {
    const summaryEl = section.querySelector("summary");
    const sectionSummaryText = normalizeSearchValue(summaryEl ? summaryEl.textContent : "");
    const controls = Array.from(section.querySelectorAll(":scope > .control"));
    let sectionMatchCount = 0;

    controls.forEach((control) => {
      const text = getControlSearchText(control, sectionSummaryText);
      const isMatch = text.includes(query);
      control.style.display = isMatch ? "" : "none";
      if (isMatch) {
        sectionMatchCount += 1;
      }
    });

    const hasMatch = sectionMatchCount > 0;
    section.style.display = hasMatch ? "" : "none";
    section.open = hasMatch;
    totalMatches += sectionMatchCount;
  });

  if (emptyState) {
    emptyState.hidden = totalMatches !== 0;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setPopupLoadingState(true);
  waitForPopupAssets()
    .then(() => {
      popupInitAssetsReady = true;
      tryCompletePopupInit();
    })
    .catch(() => {
      popupInitAssetsReady = true;
      tryCompletePopupInit();
    });

  chrome.storage.sync.get({ ...DEFAULTS, aqualRingButtonActions: RING_BUTTON_ACTION_DEFAULTS }, (stored) => {
    hydrateUI(stored || {});
    decorateControlTitlesWithIcons();
    hydrateRingButtonActions(stored ? stored.aqualRingButtonActions : null);
    setRingSettingsOpen(false);
    setAboutPanelOpen(false);
    bindEvents();
    restoreUiState();
    resizeAudioCanvas();
    refreshMicPermissionState();
    refreshRingHidState();
    popupInitUiReady = true;
    tryCompletePopupInit();
    refreshReadingModeStateFromActiveTab();
  });

  chrome.storage.local.get({ aqualAudioMode: null }, (localStored) => {
    chrome.storage.sync.get({ aqualAudioMode: "elevenlabs", aqualTheme: "dark" }, (syncStored) => {
      const persistedMode = normalizeAudioMode(localStored.aqualAudioMode || syncStored.aqualAudioMode);
      applyModeSelection(persistedMode);
      applyTheme(syncStored.aqualTheme || "dark");
    });
  });

  chrome.storage.local.get({ aqualAudioRecording: false, aqualAudioTranscript: "" }, (stored) => {
    setRecordingState(Boolean(stored.aqualAudioRecording));
    if (stored.aqualAudioTranscript) {
      setTranscriptText(stored.aqualAudioTranscript);
    }
  });

  chrome.storage.local.get({ aqualReadingModeStatus: null }, (stored) => {
    readingModeStatus = stored && stored.aqualReadingModeStatus && typeof stored.aqualReadingModeStatus === "object"
      ? stored.aqualReadingModeStatus
      : { status: "", detail: "", pageUrl: "" };
    applyReadingModeStateText();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.aqualAudioRecording) {
        setRecordingState(Boolean(changes.aqualAudioRecording.newValue));
      }
      if (changes.aqualAudioTranscript && changes.aqualAudioTranscript.newValue) {
        setTranscriptText(changes.aqualAudioTranscript.newValue);
      }
      if (changes.aqualRingHidEnabled || changes.aqualRingHidDevice || changes.aqualRingHidStatus) {
        refreshRingHidState();
      }
      if (changes.aqualReadingModeStatus) {
        readingModeStatus = changes.aqualReadingModeStatus.newValue && typeof changes.aqualReadingModeStatus.newValue === "object"
          ? changes.aqualReadingModeStatus.newValue
          : { status: "", detail: "", pageUrl: "" };
        const statusToken = String(readingModeStatus && readingModeStatus.status ? readingModeStatus.status : "").toLowerCase();
        if (statusToken === "applied" || statusToken === "error" || statusToken === "disabled") {
          clearReadingModeUnavailableTimer();
        }
        applyReadingModeStateText();
      }
    }
    if (area === "sync" && changes.highContrastEnabled) {
      state.highContrastEnabled = Boolean(changes.highContrastEnabled.newValue);
      const input = byId("highContrastEnabled");
      if (input) {
        input.checked = state.highContrastEnabled;
      }
      setToggleText("highContrastEnabledState", state.highContrastEnabled);
    }
    if (area === "sync" && changes.aqualRingButtonActions) {
      hydrateRingButtonActions(changes.aqualRingButtonActions.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "aqual-audio-stop" && isRecording) {
      stopRecording();
    }
  });

  window.addEventListener("resize", resizeAudioCanvas);
  window.addEventListener("beforeunload", () => {
    stopRecording();
  });
});
