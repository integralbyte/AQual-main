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

const SITE_VISUAL_SETTINGS_KEY = "aqualSiteSettingsByDomain";
const VISUAL_SETTING_KEYS = Object.keys(DEFAULTS).filter((key) => key !== "readingModeEnabled");
const VISUAL_STORAGE_DEFAULTS = (() => {
  const defaults = { [SITE_VISUAL_SETTINGS_KEY]: {} };
  VISUAL_SETTING_KEYS.forEach((key) => {
    defaults[key] = DEFAULTS[key];
  });
  return defaults;
})();

function normalizeDomainKeyFromHostname(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/\.+$/g, "");
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  return host;
}

function getDomainKeyFromUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(String(rawUrl));
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return normalizeDomainKeyFromHostname(parsed.hostname);
  } catch (_error) {
    return "";
  }
}

function pickVisualSettingsPatch(input) {
  const patch = {};
  const source = input && typeof input === "object" ? input : {};
  VISUAL_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      patch[key] = source[key];
    }
  });
  return patch;
}

function getDomainVisualSettingsFromStored(stored, domainKey) {
  const source = stored && typeof stored === "object" ? stored : {};
  const mapRaw = source[SITE_VISUAL_SETTINGS_KEY];
  const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
  const domainEntryRaw = domainKey && map[domainKey];
  const domainEntry = domainEntryRaw && typeof domainEntryRaw === "object" ? domainEntryRaw : {};
  const resolved = { ...DEFAULTS };
  VISUAL_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(domainEntry, key)) {
      resolved[key] = domainEntry[key];
    } else {
      resolved[key] = DEFAULTS[key];
    }
  });
  resolved.readingModeEnabled = false;
  return resolved;
}

function getSettingsForUrl(url, callback) {
  const domainKey = getDomainKeyFromUrl(url);
  chrome.storage.sync.get(VISUAL_STORAGE_DEFAULTS, (stored) => {
    callback(getDomainVisualSettingsFromStored(stored, domainKey));
  });
}

function updateSettingsForUrl(url, patch, callback, replace = false) {
  const domainKey = getDomainKeyFromUrl(url);
  if (!domainKey) {
    const resolved = { ...DEFAULTS, ...pickVisualSettingsPatch(patch), readingModeEnabled: false };
    callback(resolved, false);
    return;
  }

  const safePatch = pickVisualSettingsPatch(patch);
  chrome.storage.sync.get(VISUAL_STORAGE_DEFAULTS, (stored) => {
    const current = stored && typeof stored === "object" ? stored : {};
    const mapRaw = current[SITE_VISUAL_SETTINGS_KEY];
    const map = mapRaw && typeof mapRaw === "object" ? mapRaw : {};
    const existingEntryRaw = map[domainKey];
    const existingEntry = existingEntryRaw && typeof existingEntryRaw === "object" ? existingEntryRaw : {};
    const nextEntry = replace
      ? { ...safePatch }
      : { ...existingEntry, ...safePatch };
    const nextMap = { ...map, [domainKey]: nextEntry };
    chrome.storage.sync.set({ [SITE_VISUAL_SETTINGS_KEY]: nextMap }, () => {
      const nextStored = { ...current, [SITE_VISUAL_SETTINGS_KEY]: nextMap };
      callback(getDomainVisualSettingsFromStored(nextStored, domainKey), true);
    });
  });
}

function sendToTab(tabId, settings, meta = null) {
  const message = { type: "aqual-apply", settings };
  if (meta && typeof meta === "object") {
    message.meta = meta;
  }
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      return;
    }
  });
}

function applySettingsToTab(tabId, reason = "tab_sync") {
  if (!Number.isFinite(tabId) || tabId <= 0) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      return;
    }
    getSettingsForUrl(tab.url || "", (settings) => {
      sendToTab(tabId, settings, {
        source: "service-worker",
        reason
      });
    });
  });
}

let liveAudioMode = null;
let lastGoogleSearchQuery = "";
const FLIGHT_STT_LOCATION_CORRECTIONS = [
  { pattern: /\bthe blend\b/gi, replacement: "dublin" }
];
const LEARN_HOME_URL = "https://www.learn.ed.ac.uk";
const DOC_SERVER_BASE = "http://localhost:8080";
const GEMINI_LIVE_ENDPOINT = `${DOC_SERVER_BASE}/gemini-live-query`;
const FEATURE_TRACE_LOGS = true;

function featureTrace(eventName, details) {
  if (!FEATURE_TRACE_LOGS) return;
  const payload = {
    event: String(eventName || ""),
    ts: Date.now(),
    ...(details && typeof details === "object" ? details : {})
  };
  try {
    console.info("[aqual-feature-trace]", JSON.stringify(payload));
  } catch (_error) {
    console.info("[aqual-feature-trace]", eventName, details || "");
  }
}

function parseAudioMode(mode) {
  const token = String(mode || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (token === "local" || token === "localwhisper" || token === "whisper") {
    return "local";
  }
  if (token === "elevenlabs" || token === "elevenlab" || token === "eleven" || token === "11labs") {
    return "elevenlabs";
  }
  return null;
}

function normalizeAudioMode(mode) {
  return parseAudioMode(mode) || "elevenlabs";
}

function getPreferredAudioMode(callback) {
  if (liveAudioMode) {
    callback(liveAudioMode);
    return;
  }

  chrome.storage.local.get({ aqualAudioMode: null }, (localStored) => {
    chrome.storage.sync.get({ aqualAudioMode: null }, (syncStored) => {
      const localMode = parseAudioMode(localStored ? localStored.aqualAudioMode : null);
      const syncMode = parseAudioMode(syncStored ? syncStored.aqualAudioMode : null);

      // Prefer Local if either store indicates it, then fall back to known values.
      const resolvedMode = (localMode === "local" || syncMode === "local")
        ? "local"
        : (localMode || syncMode || "elevenlabs");

      liveAudioMode = resolvedMode;
      chrome.storage.local.set({ aqualAudioMode: resolvedMode }, () => {
        chrome.storage.sync.set({ aqualAudioMode: resolvedMode }, () => {
          callback(resolvedMode);
        });
      });
    });
  });
}

let lastVoiceCommand = { key: "", timestamp: 0 };
let holdActive = false;
let activeHoldId = 0;
let holdTranscript = "";
let holdStartedAt = 0;
let holdBestLength = 0;
let holdPendingUntil = 0;
let holdLastTranscriptAt = 0;
let holdRecordStopped = false;
let holdFinalizeTimer = null;
let holdStopTimer = null;
let pendingLearnIntent = null;
let geminiLiveHoldActive = false;
let geminiLiveActiveHoldId = 0;
let geminiLivePending = null;
let geminiLiveTimeoutTimer = null;
let geminiLiveLastTabId = 0;
let geminiLiveCallActive = false;
let geminiLiveCallSessionId = 0;
let geminiLiveCallTabId = 0;
let geminiLiveCallWindowId = chrome.windows.WINDOW_ID_CURRENT;
let geminiLiveConversationId = "";
let geminiLiveQueue = [];
let geminiLiveQueueProcessing = false;
let geminiLiveInFlightController = null;
let geminiLiveInFlightSequence = 0;
let geminiLiveCachedScreenshotDataUrl = "";
let geminiLiveCachedScreenshotCapturedAt = 0;
let geminiLiveCachedScreenshotPageUrl = "";
let geminiLiveLastToggleAt = 0;
let geminiLiveLastSpeechStartTurnId = 0;

const GEMINI_LIVE_SCREENSHOT_REFRESH_MS = 12000;
const GEMINI_LIVE_MAX_QUEUE_SIZE = 2;
const GEMINI_LIVE_REQUEST_TIMEOUT_MS = 20000;
const GEMINI_LIVE_TOGGLE_DEBOUNCE_MS = 500;
const RING_HID_USAGE_PAGE = 0x000d;
const RING_HID_DEBOUNCE_MS = 320;
const RING_HID_DEFAULT_STATUS = "Not connected. Press Connect and choose your ring.";
const BACKEND_RING_TOGGLE_DEBOUNCE_MS = 240;
const RING_FONT_SIZE_STEPS = [24, 32, 40, 50, 60, 72];
const RING_MAGNIFIER_SIZE_STEPS = [30, 40, 50, 60, 70, 80, 90, 100];
const RING_MAGNIFIER_ZOOM_STEPS = [1, 2, 3, 4, 5];
const RING_DIMMING_STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
const RING_BLUE_LIGHT_STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const RING_FONT_FAMILY_STEPS = [
  "open-dyslexic",
  "lexend",
  "sign-language",
  "arial",
  "verdana",
  "impact",
  "comic-sans"
];
const RING_CURSOR_STEPS = ["arrow-large.png", "black-large.cur", "pencil-large.png"];
const RING_COLOUR_VISION_STEPS = ["none", "protanopia", "deuteranopia", "tritanopia"];
const RING_FONT_COLOUR_STEPS = [
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
const RING_ACTION_TOGGLE_MAP = {
  toggle_reading_mode: { key: "readingModeEnabled", label: "AI reading mode" },
  toggle_high_contrast: { key: "highContrastEnabled", label: "high contrast" },
  toggle_night_mode: { key: "nightModeEnabled", label: "night reading mode" },
  toggle_blue_light: { key: "blueLightEnabled", label: "blue-light filter" },
  toggle_dimming: { key: "dimmingEnabled", label: "brightness dimming" },
  toggle_font_family: { key: "fontEnabled", label: "font family" },
  toggle_font_size: { key: "fontSizeEnabled", label: "font size" },
  toggle_font_color: { key: "fontColorEnabled", label: "font colour" },
  toggle_text_stroke: { key: "textStrokeEnabled", label: "text stroke" },
  toggle_reduced_crowding: { key: "reducedCrowdingEnabled", label: "reduced text crowding" },
  toggle_link_emphasis: { key: "linkEmphasisEnabled", label: "link emphasis" },
  toggle_cursor: { key: "cursorEnabled", label: "pointer style" },
  toggle_image_veil: { key: "imageVeilEnabled", label: "image veil" },
  toggle_highlight: { key: "highlightEnabled", label: "highlight words" },
  toggle_line_guide: { key: "lineGuideEnabled", label: "BeeLine line guide" },
  toggle_drawing: { key: "drawingEnabled", label: "drawing mode" },
  toggle_magnifier: { key: "magnifierEnabled", label: "magnifier" }
};
const RING_KEY_ACTION_LABELS = {
  key_arrow_up: "Arrow Up",
  key_arrow_down: "Arrow Down",
  key_arrow_left: "Arrow Left",
  key_arrow_right: "Arrow Right",
  key_space: "Space",
  key_enter: "Enter",
  key_escape: "Escape",
  key_tab: "Tab",
  key_backspace: "Backspace",
  key_page_up: "Page Up",
  key_page_down: "Page Down",
  key_home: "Home",
  key_end: "End"
};

let ringHidHandlersByKey = new Map();
let ringHidPressedByKey = new Map();
let ringHidEventsAttached = false;
let ringHidLastToggleAt = 0;
let backendRingLastToggleAtByAction = new Map();
let backendRingPollingEnabled = true;
let readingModeStateByTab = new Map();

function localGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (stored) => {
      resolve(stored || {});
    });
  });
}

function localSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
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

function normalizeRingHidDeviceInfo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const vendorId = Number(raw.vendorId);
  const productId = Number(raw.productId);
  if (!Number.isFinite(vendorId) || !Number.isFinite(productId)) {
    return null;
  }
  return {
    vendorId,
    productId,
    productName: String(raw.productName || "Ring HID device")
  };
}

function toRingHidDeviceInfo(device) {
  if (!device) return null;
  return normalizeRingHidDeviceInfo({
    vendorId: Number(device.vendorId || 0),
    productId: Number(device.productId || 0),
    productName: String(device.productName || "Ring HID device")
  });
}

function isLikelyRingHidDevice(device) {
  if (!device) return false;
  if (!device.collections || !device.collections.length) {
    return false;
  }

  return device.collections.some((collection) => {
    return Number(collection.usagePage) === RING_HID_USAGE_PAGE;
  });
}

async function getGrantedRingHidDevices() {
  if (!navigator.hid || !navigator.hid.getDevices) return [];
  const allDevices = await navigator.hid.getDevices();
  return allDevices.filter((device) => isLikelyRingHidDevice(device));
}

function ringHidDeviceKey(device) {
  if (!device || typeof device !== "object") return "";
  return `${Number(device.vendorId || 0)}:${Number(device.productId || 0)}`;
}

function isSameRingHidDevice(device, selected) {
  if (!device || !selected) return false;
  return Number(device.vendorId || 0) === Number(selected.vendorId || 0)
    && Number(device.productId || 0) === Number(selected.productId || 0);
}

function hasRingPressSignal(dataView) {
  if (!dataView || typeof dataView.byteLength !== "number") return false;
  for (let i = 0; i < dataView.byteLength; i += 1) {
    if (dataView.getUint8(i) !== 0) {
      return true;
    }
  }
  return false;
}

function toggleVoiceCommandMicFromRing(source = "ring", device = null) {
  const sourceLabel = String(source || "ring");
  const deviceLabel = device ? formatRingHidDeviceLabel(device) : "";
  if (holdActive) {
    stopAudioHoldSession(activeHoldId || 0);
    featureTrace("voice_mic_toggle", {
      source: sourceLabel,
      enabled: false,
      holdId: Number(activeHoldId || 0)
    });
    localSet({
      aqualRingHidStatus: `${deviceLabel || "Ring"} mic OFF (${sourceLabel}).`,
      aqualRingHidLastToggleAt: Date.now()
    });
    return;
  }

  if (geminiLiveCallActive) {
    stopGeminiLiveCall("Live call OFF.", true);
  }

  const holdId = Date.now();
  startAudioHoldSession(holdId);
  featureTrace("voice_mic_toggle", {
    source: sourceLabel,
    enabled: true,
    holdId: Number(holdId || 0)
  });
  localSet({
    aqualRingHidStatus: `${deviceLabel || "Ring"} mic ON (${sourceLabel}).`,
    aqualRingHidLastToggleAt: Date.now()
  });
}

function shouldIgnoreBackendRingToggle(action, buttonLabel = "") {
  const actionKeyBase = String(action || "").trim().toLowerCase() || "ring-action";
  const ringButton = String(buttonLabel || "").trim().toLowerCase();
  const actionKey = ringButton ? `${actionKeyBase}:${ringButton}` : actionKeyBase;
  const now = Date.now();
  const lastAt = Number(backendRingLastToggleAtByAction.get(actionKey) || 0);
  if (now - lastAt < BACKEND_RING_TOGGLE_DEBOUNCE_MS) {
    featureTrace("ring_backend_action_ignored", {
      action: actionKeyBase,
      buttonLabel: ringButton || "",
      reason: "debounce"
    });
    return true;
  }
  backendRingLastToggleAtByAction.set(actionKey, now);
  return false;
}

function isRingEventPollMessage(message) {
  return String(message && message.source ? message.source : "").trim().toLowerCase() === "ring-event-poll";
}

async function fetchRingBackendPoll(cursor = 0) {
  const safeCursor = Math.max(0, Number(cursor) || 0);
  const endpoint = `${DOC_SERVER_BASE}/ring-event/poll?cursor=${encodeURIComponent(String(safeCursor))}`;
  const response = await fetch(endpoint, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Ring backend poll failed (${response.status}).`);
  }
  return response.json();
}

function ringButtonPrefix(buttonLabel) {
  const ringButton = String(buttonLabel || "").trim().toLowerCase();
  return ringButton ? `${ringButton} button ` : "";
}

function getRingTargetTabId(sender) {
  if (sender && sender.tab && typeof sender.tab.id === "number") {
    return sender.tab.id;
  }
  return 0;
}

function withResolvedTargetTab(preferredTabId, callback) {
  if (Number.isFinite(preferredTabId) && preferredTabId > 0) {
    chrome.tabs.get(preferredTabId, (tab) => {
      if (chrome.runtime.lastError || !tab || typeof tab.id !== "number") {
        callback(null);
        return;
      }
      callback(tab);
    });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;
    if (!activeTab || typeof activeTab.id !== "number") {
      callback(null);
      return;
    }
    callback(activeTab);
  });
}

function setRingStatus(statusText) {
  localSet({
    aqualRingHidStatus: statusText,
    aqualRingHidLastToggleAt: Date.now()
  });
}

function toggleAccessibilitySettingFromRing(settingKey, featureLabel, source = "ring-backend-monitor", buttonLabel = "", targetTabId = 0) {
  const sourceLabel = String(source || "ring");
  const buttonPrefix = ringButtonPrefix(buttonLabel);
  if (settingKey === "readingModeEnabled") {
    withResolvedTargetTab(targetTabId, (targetTab) => {
      if (!targetTab || typeof targetTab.id !== "number") return;
      getSettingsForUrl(targetTab.url || "", (settings) => {
        const previous = Boolean(readingModeStateByTab.get(targetTab.id));
        const nextEnabled = !previous;
        readingModeStateByTab.set(targetTab.id, nextEnabled);
        const nextSettings = { ...settings, readingModeEnabled: nextEnabled };
        sendToTab(targetTab.id, nextSettings, {
          source: sourceLabel,
          reason: "ring_toggle",
          settingKey,
          buttonLabel: String(buttonLabel || "")
        });
        featureTrace("visual_setting_toggle", {
          settingKey,
          enabled: nextEnabled,
          source: sourceLabel,
          tabId: targetTab.id,
          buttonLabel: String(buttonLabel || "")
        });
        setRingStatus(`Ring ${buttonPrefix}${featureLabel} ${nextEnabled ? "ON" : "OFF"} (${sourceLabel}).`);
      });
    });
    return;
  }

  withResolvedTargetTab(targetTabId, (targetTab) => {
    if (!targetTab || typeof targetTab.id !== "number") return;
    getSettingsForUrl(targetTab.url || "", (settings) => {
      const nextEnabled = !Boolean(settings[settingKey]);
      const patch = { [settingKey]: nextEnabled };
      updateSettingsForUrl(targetTab.url || "", patch, (nextSettings) => {
        sendToTab(targetTab.id, nextSettings, {
          source: sourceLabel,
          reason: "ring_toggle",
          settingKey,
          buttonLabel: String(buttonLabel || "")
        });
        featureTrace("visual_setting_toggle", {
          settingKey,
          enabled: nextEnabled,
          source: sourceLabel,
          tabId: targetTab.id,
          buttonLabel: String(buttonLabel || "")
        });
        setRingStatus(`Ring ${buttonPrefix}${featureLabel} ${nextEnabled ? "ON" : "OFF"} (${sourceLabel}).`);
      });
    });
  });
}

function normalizeRingComparableValue(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number") return Number(value.toFixed(4));
  return value;
}

function findRingCycleIndex(values, currentValue) {
  const currentComparable = normalizeRingComparableValue(currentValue);
  for (let i = 0; i < values.length; i += 1) {
    if (normalizeRingComparableValue(values[i]) === currentComparable) {
      return i;
    }
  }
  return -1;
}

function cycleRingSettingFromList({
  settingKey,
  values,
  featureLabel,
  source = "ring-backend-monitor",
  buttonLabel = "",
  targetTabId = 0,
  forceEnableKey = "",
  valueFormatter = null
}) {
  if (!Array.isArray(values) || values.length === 0) return;
  const sourceLabel = String(source || "ring");
  const buttonPrefix = ringButtonPrefix(buttonLabel);

  withResolvedTargetTab(targetTabId, (targetTab) => {
    if (!targetTab || typeof targetTab.id !== "number") return;
    getSettingsForUrl(targetTab.url || "", (settings) => {
      const currentValue = settings[settingKey];
      const currentIndex = findRingCycleIndex(values, currentValue);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % values.length : 0;
      const nextValue = values[nextIndex];
      const patch = { [settingKey]: nextValue };
      if (forceEnableKey) {
        patch[forceEnableKey] = true;
      }
      updateSettingsForUrl(targetTab.url || "", patch, (nextSettings) => {
        sendToTab(targetTab.id, nextSettings, {
          source: sourceLabel,
          reason: "ring_cycle",
          settingKey,
          buttonLabel: String(buttonLabel || "")
        });
        featureTrace("visual_setting_cycle", {
          settingKey,
          value: nextValue,
          source: sourceLabel,
          tabId: targetTab.id,
          buttonLabel: String(buttonLabel || "")
        });
        const rawLabel = typeof valueFormatter === "function" ? valueFormatter(nextValue) : String(nextValue);
        setRingStatus(`Ring ${buttonPrefix}${featureLabel}: ${rawLabel} (${sourceLabel}).`);
      });
    });
  });
}

function sendRingCommandToTargetTab(payload, source = "ring-backend-monitor", buttonLabel = "", sender = null, statusLabel = "") {
  const sourceLabel = String(source || "ring");
  const buttonPrefix = ringButtonPrefix(buttonLabel);
  const targetTabId = getRingTargetTabId(sender);
  const finish = () => {
    if (statusLabel) {
      setRingStatus(`Ring ${buttonPrefix}${statusLabel} (${sourceLabel}).`);
    }
  };
  if (targetTabId > 0) {
    chrome.tabs.sendMessage(targetTabId, payload, () => {
      finish();
    });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length && tabs[0] && typeof tabs[0].id === "number") {
      chrome.tabs.sendMessage(tabs[0].id, payload, () => {
        finish();
      });
      return;
    }
    finish();
  });
}

function maybeHandleSkyscannerRingNavigationOverride(source = "ring-backend-monitor", buttonLabel = "", sender = null) {
  const ringButton = String(buttonLabel || "").trim().toLowerCase();
  const navAction = (ringButton === "top" || ringButton === "up")
    ? "move-up"
    : (ringButton === "bottom" || ringButton === "down")
      ? "move-down"
      : (ringButton === "center" || ringButton === "middle" || ringButton === "enter")
        ? "activate"
        : "";
  if (!navAction) {
    return false;
  }

  const tabId = getRingTargetTabId(sender);
  const tabUrl = String(sender && sender.tab && sender.tab.url ? sender.tab.url : "");
  if (!(Number.isFinite(tabId) && tabId > 0)) {
    return false;
  }
  if (!tabUrl || !isSkyscannerFlightsTabUrl(tabUrl) || isSkyscannerConfigTabUrl(tabUrl)) {
    return false;
  }

  const sourceLabel = String(source || "ring");
  chrome.tabs.sendMessage(
    tabId,
    { type: "aqual-skyscanner-ring-nav", payload: { action: navAction } },
    { frameId: 0 },
    (response) => {
      const hasRuntimeError = Boolean(chrome.runtime.lastError);
      if (hasRuntimeError || !response || !response.ok) {
        const errorText = !hasRuntimeError && response && response.error
          ? String(response.error)
          : "navigation unavailable";
        setRingStatus(`Ring ${ringButtonPrefix(buttonLabel)}Skyscanner ${errorText} (${sourceLabel}).`);
        return;
      }
      const actionLabel = navAction === "activate"
        ? "select"
        : navAction === "move-up"
          ? "move up"
          : "move down";
      const position = Number.isFinite(Number(response.index)) && Number.isFinite(Number(response.total))
        ? ` ${Number(response.index)}/${Number(response.total)}`
        : "";
      setRingStatus(`Ring ${ringButtonPrefix(buttonLabel)}Skyscanner ${actionLabel}${position} (${sourceLabel}).`);
    }
  );
  return true;
}

function maybeHandleGoogleDocsRingArrowOverride(source = "ring-backend-monitor", buttonLabel = "", sender = null) {
  const ringButton = String(buttonLabel || "").trim().toLowerCase();
  const keyAction = (ringButton === "left" || ringButton === "prev" || ringButton === "previous" || ringButton === "back")
    ? "key_arrow_left"
    : (ringButton === "right" || ringButton === "next" || ringButton === "forward")
      ? "key_arrow_right"
      : "";
  if (!keyAction) {
    return false;
  }

  const tabId = getRingTargetTabId(sender);
  const tabUrl = String(sender && sender.tab && sender.tab.url ? sender.tab.url : "");
  if (!(Number.isFinite(tabId) && tabId > 0)) {
    return false;
  }
  if (!tabUrl || !isGoogleDocsTabUrl(tabUrl)) {
    return false;
  }

  const statusLabel = keyAction === "key_arrow_left"
    ? "Google Docs arrow left"
    : "Google Docs arrow right";
  sendRingCommandToTargetTab(
    { type: "aqual-ring-key-command", action: keyAction },
    source,
    buttonLabel,
    sender,
    statusLabel
  );
  return true;
}

function executeRingBackendAction(action, source = "ring-backend-monitor", buttonLabel = "", sender = null) {
  const actionToken = String(action || "").trim().toLowerCase();
  const sourceLabel = String(source || "ring");
  const targetTabId = getRingTargetTabId(sender);

  if (maybeHandleGoogleDocsRingArrowOverride(source, buttonLabel, sender)) {
    return true;
  }

  if (!actionToken || actionToken === "none") {
    return true;
  }

  featureTrace("ring_backend_action_received", {
    action: actionToken,
    source: sourceLabel,
    buttonLabel: String(buttonLabel || ""),
    tabId: targetTabId
  });

  if (maybeHandleSkyscannerRingNavigationOverride(source, buttonLabel, sender)) {
    return true;
  }

  const toggleDescriptor = RING_ACTION_TOGGLE_MAP[actionToken];
  if (toggleDescriptor) {
    toggleAccessibilitySettingFromRing(
      toggleDescriptor.key,
      toggleDescriptor.label,
      source,
      buttonLabel,
      targetTabId
    );
    return true;
  }

  if (actionToken === "toggle_voice_mic") {
    toggleVoiceCommandMicFromRing(sourceLabel, null);
    return true;
  }
  if (actionToken === "toggle_gemini_live") {
    const nextStateOn = !geminiLiveCallActive;
    const now = Date.now();
    if (now - geminiLiveLastToggleAt < GEMINI_LIVE_TOGGLE_DEBOUNCE_MS) {
      return true;
    }
    geminiLiveLastToggleAt = now;
    toggleGeminiLiveCall(sender);
    setRingStatus(`Ring ${ringButtonPrefix(buttonLabel)}Gemini Live call ${nextStateOn ? "ON" : "OFF"} (${sourceLabel}).`);
    return true;
  }

  if (actionToken === "cycle_color_vision") {
    cycleRingSettingFromList({
      settingKey: "colorBlindMode",
      values: RING_COLOUR_VISION_STEPS,
      featureLabel: "colour vision mode",
      source,
      buttonLabel,
      targetTabId
    });
    return true;
  }
  if (actionToken === "cycle_font_family") {
    cycleRingSettingFromList({
      settingKey: "fontFamily",
      values: RING_FONT_FAMILY_STEPS,
      featureLabel: "font family",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "fontEnabled"
    });
    return true;
  }
  if (actionToken === "cycle_cursor") {
    cycleRingSettingFromList({
      settingKey: "cursorType",
      values: RING_CURSOR_STEPS,
      featureLabel: "pointer style",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "cursorEnabled"
    });
    return true;
  }
  if (actionToken === "cycle_font_size") {
    cycleRingSettingFromList({
      settingKey: "fontSizePx",
      values: RING_FONT_SIZE_STEPS,
      featureLabel: "font size",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "fontSizeEnabled",
      valueFormatter: (value) => `${value}px`
    });
    return true;
  }
  if (actionToken === "cycle_magnifier_size") {
    cycleRingSettingFromList({
      settingKey: "magnifierSize",
      values: RING_MAGNIFIER_SIZE_STEPS,
      featureLabel: "magnifier size",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "magnifierEnabled",
      valueFormatter: (value) => `${value}px`
    });
    return true;
  }
  if (actionToken === "cycle_magnifier_zoom") {
    cycleRingSettingFromList({
      settingKey: "magnifierZoom",
      values: RING_MAGNIFIER_ZOOM_STEPS,
      featureLabel: "magnification",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "magnifierEnabled",
      valueFormatter: (value) => `${value}x`
    });
    return true;
  }
  if (actionToken === "cycle_dimming_level") {
    cycleRingSettingFromList({
      settingKey: "dimmingLevel",
      values: RING_DIMMING_STEPS,
      featureLabel: "dimming level",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "dimmingEnabled",
      valueFormatter: (value) => `${Math.round(Number(value) * 100)}%`
    });
    return true;
  }
  if (actionToken === "cycle_blue_light_level") {
    cycleRingSettingFromList({
      settingKey: "blueLightLevel",
      values: RING_BLUE_LIGHT_STEPS,
      featureLabel: "blue-light level",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "blueLightEnabled",
      valueFormatter: (value) => `${Math.round(Number(value) * 100)}%`
    });
    return true;
  }
  if (actionToken === "cycle_font_color") {
    cycleRingSettingFromList({
      settingKey: "fontColor",
      values: RING_FONT_COLOUR_STEPS,
      featureLabel: "font colour",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "fontColorEnabled",
      valueFormatter: (value) => String(value || "").toUpperCase()
    });
    return true;
  }
  if (actionToken === "cycle_text_stroke_color") {
    cycleRingSettingFromList({
      settingKey: "textStrokeColor",
      values: RING_FONT_COLOUR_STEPS,
      featureLabel: "text stroke colour",
      source,
      buttonLabel,
      targetTabId,
      forceEnableKey: "textStrokeEnabled",
      valueFormatter: (value) => String(value || "").toUpperCase()
    });
    return true;
  }

  if (actionToken === "clear_drawings") {
    sendRingCommandToTargetTab({ type: "aqual-clear-drawings" }, source, buttonLabel, sender, "clear drawings");
    return true;
  }
  if (actionToken === "print_page") {
    sendRingCommandToTargetTab({ type: "aqual-print" }, source, buttonLabel, sender, "print page");
    return true;
  }
  if (actionToken === "capture_screenshot") {
    captureScreenshot();
    setRingStatus(`Ring ${ringButtonPrefix(buttonLabel)}capture screenshot (${sourceLabel}).`);
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(RING_KEY_ACTION_LABELS, actionToken)) {
    sendRingCommandToTargetTab(
      { type: "aqual-ring-key-command", action: actionToken },
      source,
      buttonLabel,
      sender,
      `key ${RING_KEY_ACTION_LABELS[actionToken]}`
    );
    return true;
  }

  return false;
}

function handleRingHidInputReport(event) {
  const device = event ? event.device : null;
  const key = ringHidDeviceKey(device);
  if (!key) return;

  const pressed = hasRingPressSignal(event ? event.data : null);
  const wasPressed = Boolean(ringHidPressedByKey.get(key));
  ringHidPressedByKey.set(key, pressed);

  if (!pressed || wasPressed) {
    return;
  }

  const now = Date.now();
  if (now - ringHidLastToggleAt < RING_HID_DEBOUNCE_MS) {
    return;
  }
  ringHidLastToggleAt = now;
  toggleVoiceCommandMicFromRing("webhid", device);
}

async function detachRingHidDevice(device) {
  const key = ringHidDeviceKey(device);
  if (!key) return;

  const handler = ringHidHandlersByKey.get(key);
  if (handler) {
    try {
      device.removeEventListener("inputreport", handler);
    } catch (_error) {
      // Ignore event detachment errors.
    }
    ringHidHandlersByKey.delete(key);
  }
  ringHidPressedByKey.delete(key);

  if (device.opened) {
    try {
      await device.close();
    } catch (_error) {
      // Ignore close errors.
    }
  }
}

async function attachRingHidDevice(device) {
  if (!device) return;
  const key = ringHidDeviceKey(device);
  if (!key) return;

  if (device.collections && device.collections.length > 0) {
    const hasExpectedUsagePage = device.collections.some((collection) => {
      return Number(collection.usagePage) === RING_HID_USAGE_PAGE;
    });
    if (!hasExpectedUsagePage) {
      throw new Error("Selected device does not expose usage page 0x000D.");
    }
  }

  if (!device.opened) {
    await device.open();
  }

  if (!ringHidHandlersByKey.has(key)) {
    const handler = (event) => {
      handleRingHidInputReport(event);
    };
    device.addEventListener("inputreport", handler);
    ringHidHandlersByKey.set(key, handler);
  }
}

async function detachAllRingHidExcept(selectedKey) {
  if (!navigator.hid || !navigator.hid.getDevices) return;
  const devices = await navigator.hid.getDevices();
  for (let i = 0; i < devices.length; i += 1) {
    const device = devices[i];
    const key = ringHidDeviceKey(device);
    if (!key) continue;
    if (key === selectedKey) continue;
    if (ringHidHandlersByKey.has(key)) {
      await detachRingHidDevice(device);
    }
  }
}

async function connectRingHidDevice(selection) {
  if (backendRingPollingEnabled) {
    await localSet({
      aqualRingHidEnabled: false,
      aqualRingHidStatus: "WebHID ring input disabled while backend ring monitor polling is active."
    });
    return { ok: false, error: "Backend ring monitor polling is active." };
  }

  const selected = normalizeRingHidDeviceInfo(selection);
  if (!selected) {
    return { ok: false, error: "Invalid ring HID device info." };
  }

  if (!navigator.hid || !navigator.hid.getDevices) {
    await localSet({
      aqualRingHidEnabled: false,
      aqualRingHidStatus: "WebHID is unavailable in this extension context."
    });
    return { ok: false, error: "WebHID unavailable." };
  }

  const grantedDevices = await getGrantedRingHidDevices();
  const device = grantedDevices.find((candidate) => isSameRingHidDevice(candidate, selected));
  if (!device) {
    await localSet({
      aqualRingHidEnabled: true,
      aqualRingHidDevice: selected,
      aqualRingHidStatus: "Ring access missing. Press Connect ring again in the popup."
    });
    return { ok: false, error: "Ring permission not available. Reconnect from popup." };
  }

  await detachAllRingHidExcept(ringHidDeviceKey(selected));
  await attachRingHidDevice(device);
  await localSet({
    aqualRingHidEnabled: true,
    aqualRingHidDevice: {
      vendorId: Number(device.vendorId || selected.vendorId),
      productId: Number(device.productId || selected.productId),
      productName: String(device.productName || selected.productName || "Ring HID device")
    },
    aqualRingHidStatus: `${formatRingHidDeviceLabel(device)} connected. Configure button actions from Ring Settings in the popup.`
  });

  return { ok: true };
}

async function disconnectRingHid(clearStored = true) {
  if (navigator.hid && navigator.hid.getDevices) {
    const devices = await navigator.hid.getDevices();
    for (let i = 0; i < devices.length; i += 1) {
      const key = ringHidDeviceKey(devices[i]);
      if (key && ringHidHandlersByKey.has(key)) {
        await detachRingHidDevice(devices[i]);
      }
    }
  }

  ringHidLastToggleAt = 0;
  if (clearStored) {
    await localSet({
      aqualRingHidEnabled: false,
      aqualRingHidDevice: null,
      aqualRingHidStatus: RING_HID_DEFAULT_STATUS
    });
  } else {
    await localSet({
      aqualRingHidEnabled: true,
      aqualRingHidStatus: "Ring disconnected. Reconnect in popup."
    });
  }
}

function ensureRingHidEvents() {
  if (ringHidEventsAttached) return;
  if (!navigator.hid || !navigator.hid.addEventListener) return;
  ringHidEventsAttached = true;

  navigator.hid.addEventListener("disconnect", (event) => {
    const disconnected = event ? event.device : null;
    const key = ringHidDeviceKey(disconnected);
    if (key && ringHidHandlersByKey.has(key)) {
      ringHidHandlersByKey.delete(key);
      ringHidPressedByKey.delete(key);
      localSet({
        aqualRingHidEnabled: true,
        aqualRingHidStatus: "Ring disconnected. Reconnect in popup."
      });
    }
  });

  navigator.hid.addEventListener("connect", async (event) => {
    const connected = event ? event.device : null;
    const stored = await localGet({
      aqualRingHidEnabled: false,
      aqualRingHidDevice: null
    });
    if (!stored.aqualRingHidEnabled || !stored.aqualRingHidDevice) return;
    const selected = normalizeRingHidDeviceInfo(stored.aqualRingHidDevice);
    if (!selected) return;
    if (!isSameRingHidDevice(connected, selected)) return;
    connectRingHidDevice(selected).catch(() => {
      // Ignore auto-reconnect errors.
    });
  });
}

async function initializeRingHid() {
  ensureRingHidEvents();
  const stored = await localGet({
    aqualRingBackendPollingEnabled: true,
    aqualRingHidEnabled: false,
    aqualRingHidDevice: null,
    aqualRingHidStatus: RING_HID_DEFAULT_STATUS
  });
  backendRingPollingEnabled = stored.aqualRingBackendPollingEnabled !== false;

  if (backendRingPollingEnabled) {
    if (stored.aqualRingHidEnabled || ringHidHandlersByKey.size > 0) {
      await disconnectRingHid(true);
    }
    await localSet({
      aqualRingHidEnabled: false,
      aqualRingHidStatus: "WebHID ring input disabled while backend ring monitor polling is active."
    });
    return;
  }

  const selected = normalizeRingHidDeviceInfo(stored.aqualRingHidDevice);
  if (stored.aqualRingHidEnabled && selected) {
    await connectRingHidDevice(selected);
    return;
  }

  if (stored.aqualRingHidEnabled && !selected) {
    await localSet({
      aqualRingHidEnabled: false,
      aqualRingHidDevice: null,
      aqualRingHidStatus: "Saved ring device info is invalid. Connect ring again."
    });
    return;
  }

  // Auto-adopt a previously granted ring device so users don't need popup interaction each run.
  const candidates = await getGrantedRingHidDevices();
  if (candidates.length > 0) {
    const autoDeviceInfo = toRingHidDeviceInfo(candidates[0]);
    if (autoDeviceInfo) {
      await localSet({
        aqualRingHidEnabled: true,
        aqualRingHidDevice: autoDeviceInfo,
        aqualRingHidStatus: `Auto-connecting ${formatRingHidDeviceLabel(autoDeviceInfo)}...`
      });
      await connectRingHidDevice(autoDeviceInfo);
      return;
    }
  }

  if (!stored.aqualRingHidStatus) {
    await localSet({ aqualRingHidStatus: RING_HID_DEFAULT_STATUS });
  }
}

function normalizeSpeech(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function looksLikeGoogle(word) {
  if (!word) return false;
  const cleaned = word.replace(/[^a-z]/g, "");
  if (!cleaned) return false;
  if (cleaned.startsWith("googl")) return true;
  return levenshtein(cleaned, "google") <= 2;
}

function isDurationQuery(normalized) {
  if (!normalized) return false;
  const patterns = [
    /\bhow long\b/,
    /\bhow much time\b/,
    /\btime to\b/,
    /\bhow long does it take\b/,
    /\bhow long would it take\b/,
    /\bhow long will it take\b/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function normalizeLocationToken(token) {
  return token ? token.replace(/[^a-z0-9.-]/g, "") : "";
}

function trimFillerWords(text) {
  if (!text) return "";
  const filler = new Set([
    "please",
    "now",
    "today",
    "hey",
    "okay",
    "ok",
    "thanks",
    "thank",
    "you"
  ]);
  const tokens = text.trim().split(/\s+/);
  while (tokens.length > 0 && filler.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens[0] === "to") {
    tokens.shift();
  }
  return tokens.join(" ").trim();
}

function normalizeOriginText(origin) {
  if (!origin) return null;
  const cleaned = trimFillerWords(origin);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (
    lower === "my location" ||
    lower === "current location" ||
    lower === "current position" ||
    lower === "here"
  ) {
    return "My Location";
  }
  return normalized;
}

function detectTravelMode(tokens) {
  const drivingTokens = new Set(["drive", "driving", "car", "bycar", "by-car"]);
  const walkingTokens = new Set(["walk", "walking", "walkto", "onfoot", "on-foot", "foot"]);
  if (tokens.some((token) => drivingTokens.has(normalizeLocationToken(token)))) {
    return "driving";
  }
  if (tokens.some((token) => walkingTokens.has(normalizeLocationToken(token)))) {
    return "walking";
  }
  return "walking";
}

function extractDestination(normalized, tokens) {
  if (!normalized) return null;
  let destination = null;
  const fromToMatch = normalized.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\b|$)/);
  if (fromToMatch) {
    return trimFillerWords(fromToMatch[2]);
  }
  const toFromMatch = normalized.match(/\bto\s+(.+?)\s+from\s+(.+?)(?:\b|$)/);
  if (toFromMatch) {
    return trimFillerWords(toFromMatch[1]);
  }

  const modeTokens = new Set(["walk", "walking", "drive", "driving", "go", "travel", "get", "reach"]);
  let toIndex = -1;
  const modeIndex = tokens.findIndex((token) => modeTokens.has(normalizeLocationToken(token)));
  if (modeIndex !== -1) {
    for (let i = modeIndex + 1; i < tokens.length; i += 1) {
      if (tokens[i] === "to") {
        toIndex = i;
        break;
      }
    }
  }
  if (toIndex === -1) {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (tokens[i] === "to") {
        toIndex = i;
        break;
      }
    }
  }
  if (toIndex === -1 || toIndex >= tokens.length - 1) {
    return null;
  }
  destination = trimFillerWords(tokens.slice(toIndex + 1).join(" "));
  return destination || null;
}

function parseMapsRequest(text) {
  if (!text) return null;
  const normalized = normalizeSpeech(text);
  if (!normalized || !isDurationQuery(normalized)) return null;

  const tokens = normalized.split(" ");
  const mode = detectTravelMode(tokens);
  let origin = null;
  let destination = null;

  const fromToMatch = normalized.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\b|$)/);
  if (fromToMatch) {
    origin = normalizeOriginText(fromToMatch[1]);
    destination = trimFillerWords(fromToMatch[2]);
  } else {
    const toFromMatch = normalized.match(/\bto\s+(.+?)\s+from\s+(.+?)(?:\b|$)/);
    if (toFromMatch) {
      origin = normalizeOriginText(toFromMatch[2]);
      destination = trimFillerWords(toFromMatch[1]);
    } else {
      destination = extractDestination(normalized, tokens);
    }
  }

  if (!destination) return null;
  if (!origin) origin = "My Location";

  return {
    origin,
    destination,
    mode
  };
}

function containsOpenGoogle(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return false;
  const tokens = normalized.split(" ");
  const triggerWords = new Set(["open", "goto", "go", "visit", "launch"]);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!triggerWords.has(token)) continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 5); j += 1) {
      if (looksLikeGoogle(tokens[j])) {
        return true;
      }
    }
  }
  return normalized.includes("open google");
}

function isGoogleHost(hostname) {
  return String(hostname || "").toLowerCase().includes("google.");
}

function isYouTubeHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "youtu.be" || host.includes("youtube.com") || host.includes("youtube-nocookie.com");
}

function getHostnameSafe(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function parseAbsoluteHttpUrl(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(input)) return "";
  try {
    const parsed = new URL(input);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return parsed.href;
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

function unwrapGoogleNavigationUrl(rawUrl) {
  let current = parseAbsoluteHttpUrl(rawUrl);
  if (!current) return "";

  const visited = new Set();
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || visited.has(current)) {
      break;
    }
    visited.add(current);

    let parsed;
    try {
      parsed = new URL(current);
    } catch (_error) {
      break;
    }

    if (!isGoogleHost(parsed.hostname)) {
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
      const rawValue = parsed.searchParams.get(redirectParams[i]) || "";
      if (!rawValue) continue;
      const decodedValue = tryDecodeURIComponent(rawValue);
      const resolved = parseAbsoluteHttpUrl(decodedValue) || parseAbsoluteHttpUrl(rawValue);
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

  return current;
}

function extractYouTubeVideoId(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return id.trim();
    }
    if (!host.includes("youtube.com") && !host.includes("youtube-nocookie.com")) {
      return "";
    }
    const watchId = parsed.searchParams.get("v") || "";
    if (watchId) {
      return watchId.trim();
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0].toLowerCase();
    if ((first === "shorts" || first === "embed" || first === "live") && parts[1]) {
      return parts[1].trim();
    }
    return "";
  } catch (_error) {
    return "";
  }
}

function buildDirectYouTubeUrl(videoId) {
  const cleaned = String(videoId || "").trim();
  if (!cleaned) return "";
  return `https://youtu.be/${encodeURIComponent(cleaned)}`;
}

function prepareVoiceOpenResultUrl(rawUrl) {
  const unwrappedUrl = unwrapGoogleNavigationUrl(rawUrl);
  const host = getHostnameSafe(unwrappedUrl);
  if (!unwrappedUrl || isGoogleHost(host)) {
    return "";
  }
  const ytVideoId = extractYouTubeVideoId(unwrappedUrl);
  if (ytVideoId) {
    return buildDirectYouTubeUrl(ytVideoId) || unwrappedUrl;
  }
  return unwrappedUrl;
}

function navigateToResolvedResult(activeTab, resolvedUrl) {
  if (!resolvedUrl) return;
  const targetHost = getHostnameSafe(resolvedUrl);
  if (isYouTubeHost(targetHost)) {
    chrome.tabs.create({
      url: resolvedUrl,
      active: true,
      openerTabId: activeTab && activeTab.id ? activeTab.id : undefined
    });
    return;
  }
  if (activeTab && activeTab.id) {
    chrome.tabs.update(activeTab.id, { url: resolvedUrl });
  } else {
    chrome.tabs.create({ url: resolvedUrl, active: true });
  }
}

function isGoogleSearchTabUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!isGoogleHost(parsed.hostname)) return false;
    if (parsed.pathname === "/search") return true;
    if (parsed.pathname === "/" && parsed.searchParams.get("q")) return true;
    if (parsed.pathname === "/webhp" && parsed.searchParams.get("q")) return true;
    if (parsed.pathname.startsWith("/imgres")) return true;
    return false;
  } catch (_error) {
    return false;
  }
}

function isLearnTabUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("learn.ed.ac.uk")) {
      return true;
    }
    if (host.includes("blackboard") && parsed.pathname.includes("/ultra/")) {
      return true;
    }
    return false;
  } catch (_error) {
    return false;
  }
}

function parseLearnVoiceIntent(text) {
  const courseworkNumberWords = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10"
  };
  const normalizedRaw = normalizeSpeech(text)
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedRaw) return null;

  // STT often collapses "open ..." into one token; normalize those first.
  const normalized = normalizedRaw
    .replace(/\bopenlearn\b/g, "open learn")
    .replace(/\bopenassessments?\b/g, "open assessments")
    .replace(/\bopencourse\s*work([a-z0-9]+)?\b/g, (_match, suffix) => (
      suffix ? `open coursework ${suffix}` : "open coursework"
    ))
    .replace(/\bopencoursework([a-z0-9]+)?\b/g, (_match, suffix) => (
      suffix ? `open coursework ${suffix}` : "open coursework"
    ))
    .replace(/\bopencw([a-z0-9]+)?\b/g, (_match, suffix) => (
      suffix ? `open cw ${suffix}` : "open cw"
    ))
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "open learn") {
    return { action: "open-learn" };
  }

  if (!/\bopen\b/.test(normalized)) {
    return null;
  }

  if (/\bopen\s+assessments?\b/.test(normalized)) {
    return { action: "open-assessments", query: "assessment" };
  }

  if (/\bopen\s+(?:the\s+)?(?:course\s*work|coursework|cw)\b/.test(normalized)) {
    const explicitCoursework = normalized.match(/\bopen\s+(?:the\s+)?((?:course\s*work|coursework|cw)\s*[a-z0-9]+(?:\s+[a-z0-9]+)*)\b/i);
    if (!explicitCoursework || !explicitCoursework[1]) {
      return { action: "open-coursework", query: "coursework" };
    }
  }

  const courseworkMatch = normalized.match(/\bopen\s+(?:the\s+)?((?:course\s*work|coursework|cw)\s*[a-z0-9]+(?:\s+[a-z0-9]+)*)\b/i);
  if (courseworkMatch && courseworkMatch[1]) {
    const query = String(courseworkMatch[1])
      .replace(/\b(?:please|now|the)\b/g, " ")
      .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => courseworkNumberWords[match.toLowerCase()] || match)
      .replace(/\s+/g, " ")
      .trim();
    if (query) {
      return { action: "open-coursework", query };
    }
  }

  const genericOpenMatch = normalized.match(/\bopen\s+(.+)$/i);
  if (!genericOpenMatch || !genericOpenMatch[1]) {
    return null;
  }

  const query = String(genericOpenMatch[1])
    .replace(/\b(?:the|course|subject|module|name|called|please|now)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!query) {
    return null;
  }
  if (query === "learn") {
    return { action: "open-learn" };
  }
  return { action: "open-course", query };
}

function dispatchLearnIntentToTab(tabId, intent, retryCount = 14) {
  if (!tabId || !intent || !intent.action || intent.action === "open-learn") {
    return;
  }

  console.info("[aqual-learn-voice]", JSON.stringify({
    event: "dispatch",
    tabId,
    action: intent.action,
    query: intent.query || ""
  }));

  chrome.tabs.sendMessage(
    tabId,
    { type: "aqual-learn-action", payload: intent },
    { frameId: 0 },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        console.warn("[aqual-learn-voice]", JSON.stringify({
          event: "dispatch_failed",
          tabId,
          action: intent.action,
          query: intent.query || "",
          error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "",
          response: response || null
        }));
        if (retryCount > 0) {
          setTimeout(() => {
            dispatchLearnIntentToTab(tabId, intent, retryCount - 1);
          }, 550);
        }
        return;
      }
      if (!response.url) {
        console.info("[aqual-learn-voice]", JSON.stringify({
          event: "dispatch_no_url",
          tabId,
          action: intent.action,
          query: intent.query || "",
          response
        }));
        return;
      }

      const targetUrl = parseAbsoluteHttpUrl(response.url);
      if (!targetUrl) {
        console.warn("[aqual-learn-voice]", JSON.stringify({
          event: "invalid_target_url",
          tabId,
          action: intent.action,
          query: intent.query || "",
          responseUrl: response.url
        }));
        return;
      }

      const now = Date.now();
      if (lastVoiceCommand.key === targetUrl && now - lastVoiceCommand.timestamp < 4000) {
        return;
      }
      lastVoiceCommand = { key: targetUrl, timestamp: now };
      console.info("[aqual-learn-voice]", JSON.stringify({
        event: "navigate",
        tabId,
        action: intent.action,
        query: intent.query || "",
        url: targetUrl
      }));
      chrome.tabs.update(tabId, { url: targetUrl });
    }
  );
}

function maybeHandleLearnVoiceCommand(text, activeTab = null) {
  const intent = parseLearnVoiceIntent(text);
  if (!intent) return false;
  const activeTabUrl = activeTab && activeTab.url ? String(activeTab.url) : "";
  const activeTabId = activeTab && activeTab.id ? Number(activeTab.id) : 0;
  const onLearnTab = Boolean(activeTabUrl && isLearnTabUrl(activeTabUrl));

  if (intent.action === "open-learn") {
    // If already on Learn, treat as handled without opening another tab.
    if (onLearnTab) {
      return true;
    }
    const now = Date.now();
    if (lastVoiceCommand.key === LEARN_HOME_URL && now - lastVoiceCommand.timestamp < 4000) {
      return true;
    }
    lastVoiceCommand = { key: LEARN_HOME_URL, timestamp: now };
    chrome.tabs.create({ url: LEARN_HOME_URL });
    return true;
  }

  // Only allow generic Learn "open ..." actions when user is already on Learn.
  if (!onLearnTab || !(activeTabId > 0)) {
    return false;
  }
  dispatchLearnIntentToTab(activeTabId, intent);

  return true;
}

function isForcedOpenLearnCommand(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (/openlearn/i.test(raw)) return true;

  const normalized = normalizeSpeech(raw);
  if (!normalized) return false;
  return /\bopen\b[\s\w-]*\blearn\b/.test(normalized);
}

function extractGoogleQueryFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return (parsed.searchParams.get("q") || "").trim();
  } catch (_error) {
    return "";
  }
}

function buildGoogleSearchUrl(query, tabKind) {
  const url = new URL("https://www.google.com/search");
  const safeQuery = String(query || "").trim();
  if (safeQuery) {
    url.searchParams.set("q", safeQuery);
  }
  if (tabKind === "images") {
    url.searchParams.set("udm", "2");
  } else if (tabKind === "videos") {
    url.searchParams.set("udm", "7");
  } else if (tabKind === "all") {
    url.searchParams.set("udm", "web");
  }
  return url.toString();
}

function cleanGoogleQueryText(rawText) {
  let query = String(rawText || "").trim();
  if (!query) return "";
  query = query.replace(/\b(?:on|in)\s+google\b/g, " ");
  query = query.replace(/\b(?:please|now)\b/g, " ");
  query = query.replace(/[\s.,!?;:]+$/g, "");
  query = query.replace(/\s+/g, " ").trim();
  return query;
}

function parseGoogleSearchIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;

  const patterns = [
    /^google search for (.+)$/i,
    /^google search (.+)$/i,
    /^search for (.+)$/i,
    /^search (.+)$/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = normalized.match(patterns[i]);
    if (!match) continue;
    const query = cleanGoogleQueryText(match[1]);
    if (!query) continue;
    if (query === "images tab" || query === "videos tab" || query === "photos tab") {
      continue;
    }
    return { query };
  }

  const inlineMatch = normalized.match(/\bsearch for (.+)$/i);
  if (inlineMatch) {
    const query = cleanGoogleQueryText(inlineMatch[1]);
    if (query) {
      return { query };
    }
  }

  return null;
}

function parseGoogleTabIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;

  let tabKind = null;
  if (includesAny(normalized, ["videos tab", "video tab", "videos results", "video results", "to videos", "to video", "videos", "video"])) {
    tabKind = "videos";
  } else if (includesAny(normalized, ["images tab", "image tab", "photos tab", "photo tab", "pictures tab", "images results", "image results", "photos results", "to images", "to image", "to photos", "to photo", "to pictures", "images", "image", "photos", "photo", "pictures"])) {
    tabKind = "images";
  } else if (includesAny(normalized, ["all tab", "web tab", "all results", "main results", "standard results", "to all", "to web", "web results"])) {
    tabKind = "all";
  }
  if (!tabKind) return null;

  const hasSwitchLanguage = includesAny(normalized, ["switch", "change", "go", "move"]);
  const hasTabLanguage = includesAny(normalized, ["tab", "results"]);
  if (!hasSwitchLanguage && !hasTabLanguage) {
    return null;
  }

  return { tabKind };
}

function parseGoogleResultIndex(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;

  const numeric = normalized.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (numeric) {
    const value = Number(numeric[1]);
    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }

  const ordinalEntries = Object.entries(ORDINAL_WORDS);
  for (let i = 0; i < ordinalEntries.length; i += 1) {
    const [word, value] = ordinalEntries[i];
    if (normalized.includes(word)) {
      return value;
    }
  }

  return null;
}

function extractGoogleDomainKeyword(text) {
  const normalized = normalizeSpeech(text)
    .replace(/\b(?:please|now)\b/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const patterns = [
    /\bresult\s+(?:on|from|at)\s+([a-z0-9.\- ]+)$/i,
    /\bopen\s+(?:the\s+)?result\s+(?:on|from|at)\s+([a-z0-9.\- ]+)$/i,
    /\bopen\s+(?:the\s+)?([a-z0-9.\- ]+)\s+one$/i,
    /\bopen\s+(?:the\s+)?([a-z0-9.\- ]+)\s+result$/i,
    /\bopen\s+result\s+from\s+([a-z0-9.\- ]+)$/i
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = normalized.match(patterns[i]);
    if (!match) continue;
    const cleaned = String(match[1] || "")
      .replace(/\b(?:the|result|results|one|website|site|domain)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function parseHardcodedGoogleOpenOnIntent(text) {
  const normalized = normalizeSpeech(text)
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^open\s+(?:the\s+)?result\s+(?:on|from|at)\s+(.+)$/i);
  if (!match) return null;

  const keyword = String(match[1] || "")
    .replace(/\b(?:the|website|site|domain)\b/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!keyword) return null;

  return { domainKeyword: keyword };
}

function parseGoogleOpenResultIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;
  if (!normalized.startsWith("open ")) return null;
  if (!includesAny(normalized, ["result", "one", "link", "video", "videos", "image", "images", "photo", "photos", "picture", "pictures"])) {
    return null;
  }

  const index = parseGoogleResultIndex(normalized);
  const domainKeyword = extractGoogleDomainKeyword(normalized);
  if (!index && !domainKeyword) {
    return null;
  }

  return {
    index: index || null,
    domainKeyword: domainKeyword || ""
  };
}

function isSkyscannerFlightsTabUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("skyscanner.")
      && parsed.pathname.includes("/transport/flights/");
  } catch (_error) {
    return false;
  }
}

function isGoogleDocsTabUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol.toLowerCase() === "https:"
      && parsed.hostname.toLowerCase() === "docs.google.com";
  } catch (_error) {
    return false;
  }
}

function isSkyscannerConfigTabUrl(url) {
  if (!isSkyscannerFlightsTabUrl(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/config/");
  } catch (_error) {
    return false;
  }
}

function normalizeClockTime(hours, minutes) {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(Math.floor(hours)).padStart(2, "0")}:${String(Math.floor(minutes)).padStart(2, "0")}`;
}

function parseSpokenNumberToken(tokens, index) {
  const token = tokens[index];
  if (!token) return null;

  const numericMatch = token.match(/^(\d{1,3})(?:st|nd|rd|th)?$/);
  if (numericMatch) {
    return {
      value: Number(numericMatch[1]),
      consumed: 1
    };
  }

  const normalizedToken = token === "oh" ? "zero" : token;
  if (!(normalizedToken in NUMBER_WORDS)) {
    return null;
  }

  let value = NUMBER_WORDS[normalizedToken];
  let consumed = 1;

  const nextToken = tokens[index + 1];
  if (nextToken) {
    const nextNormalized = nextToken === "oh" ? "zero" : nextToken;
    if (nextNormalized in NUMBER_WORDS) {
      const nextValue = NUMBER_WORDS[nextNormalized];
      if (value >= 20 && value % 10 === 0 && nextValue >= 0 && nextValue <= 9) {
        value += nextValue;
        consumed = 2;
      }
    }
  }

  return { value, consumed };
}

function parseSkyscannerMinuteToken(tokens, index) {
  const base = parseSpokenNumberToken(tokens, index);
  if (!base) return null;

  let value = base.value;
  let consumed = base.consumed;
  const next = parseSpokenNumberToken(tokens, index + consumed);

  // "twenty five" -> 25
  if (value >= 20 && value <= 50 && value % 10 === 0 && next && next.value >= 0 && next.value <= 9) {
    value += next.value;
    consumed += next.consumed;
    return { value, consumed };
  }

  // "oh five" / "zero five" / "zero 5" -> 05
  if (value >= 0 && value <= 9 && next && next.value >= 0 && next.value <= 9) {
    value = (value * 10) + next.value;
    consumed += next.consumed;
    return { value, consumed };
  }

  if (value >= 0 && value <= 59) {
    return { value, consumed };
  }
  return null;
}

function parseSkyscannerDepartureTime(text) {
  const raw = String(text || "");
  const normalized = normalizeSpeech(raw);
  if (!normalized) return "";

  const colonMatch = raw.match(/\b([0-2]?\d)\s*[:.]\s*([0-5]\d)\b/);
  if (colonMatch) {
    return normalizeClockTime(Number(colonMatch[1]), Number(colonMatch[2]));
  }

  const actionDetected = /\b(?:open|select|choose|click|tap|pick)\b/.test(normalized);
  const flightContextDetected = includesAny(normalized, [
    "flight",
    "result",
    "results",
    "option",
    "itinerary",
    "departing",
    "departure",
    "leaving"
  ]);

  const compactFlightMatch = normalized.match(/\b(?:open|select|choose|click|tap|pick)\s+(?:the\s+)?([0-2]?\d)([0-5]\d)\s+flight\b/);
  if (compactFlightMatch) {
    const compact = normalizeClockTime(Number(compactFlightMatch[1]), Number(compactFlightMatch[2]));
    if (compact) return compact;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let bestCandidate = null;

  // Handle compact token style: "open the 1025 flight"
  if (actionDetected && flightContextDetected) {
    for (let i = 0; i < tokens.length; i += 1) {
      const compactMatch = tokens[i].match(/^([0-2]?\d)([0-5]\d)$/);
      if (!compactMatch) continue;
      const clock = normalizeClockTime(Number(compactMatch[1]), Number(compactMatch[2]));
      if (clock) {
        return clock;
      }
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const hourToken = parseSpokenNumberToken(tokens, i);
    if (!hourToken) continue;
    const hour = hourToken.value;
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;

    const minuteStart = i + hourToken.consumed;
    const minuteToken = parseSkyscannerMinuteToken(tokens, minuteStart);
    if (!minuteToken) continue;
    const minute = minuteToken.value;
    const consumed = minuteToken.consumed;

    const clock = normalizeClockTime(hour, minute);
    if (!clock) continue;

    const contextStart = Math.max(0, i - 4);
    const contextEnd = Math.min(tokens.length, minuteStart + consumed + 5);
    const context = tokens.slice(contextStart, contextEnd).join(" ");
    const hasFlightContext = includesAny(context, ["flight", "result", "results", "option", "itinerary", "departing", "departure", "leaving"])
      || flightContextDetected;
    const hasAtContext = includesAny(context, [" at ", " departing ", " departure ", " leaving "]);
    const hasActionLead = /^(?:open|select|choose|click|tap|pick)\b/.test(normalized);

    let score = 0;
    if (hasFlightContext) score += 2;
    if (hasAtContext) score += 1;
    if (hasActionLead) score += 1;
    if (i <= 4) score += 0.5;

    const candidate = { clock, score };
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  if (bestCandidate && (bestCandidate.score >= 1 || (actionDetected && flightContextDetected))) {
    return bestCandidate.clock;
  }

  return "";
}

function parseSkyscannerResultIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;
  const hasActionVerb = /\b(?:open|select|choose|click|tap|pick)\b/.test(normalized);
  if (!hasActionVerb) return null;

  const departureTime = parseSkyscannerDepartureTime(text);
  if (departureTime) {
    return { action: "resolve-flight", departureTime };
  }

  const index = parseGoogleResultIndex(normalized);
  if (index) {
    return { action: "resolve-flight", index };
  }

  return null;
}

function parseSkyscannerProviderIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;
  if (!/\b(?:open|select|choose|click|tap|pick|book|use|go)\b/.test(normalized)) return null;
  if (includesAny(normalized, ["result", "results", "option", "flight", "itinerary"])) {
    return null;
  }
  if (parseSkyscannerDepartureTime(text)) {
    return null;
  }

  const actionPattern = /\b(?:open|select|choose|click|tap|pick|book|use|go)\b(?:\s+to|\s+on|\s+with)?\s+([a-z0-9.\- ]+)/i;
  let rawTarget = "";
  const directMatch = normalized.match(actionPattern);
  if (directMatch && directMatch[1]) {
    rawTarget = directMatch[1];
  } else {
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const actionTokens = new Set(["open", "select", "choose", "click", "tap", "pick", "book", "use", "go"]);
    for (let i = 0; i < tokens.length; i += 1) {
      if (!actionTokens.has(tokens[i])) continue;
      const tail = tokens.slice(i + 1).join(" ").trim();
      if (tail) {
        rawTarget = tail;
      }
    }
  }
  if (!rawTarget) return null;

  const keyword = String(rawTarget || "")
    .replace(/\b(?:the|website|site|provider|booking|offer|one)\b/g, " ")
    .replace(/\b(?:please|can|could|you|me|now|thanks|thank)\b/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!keyword || parseGoogleResultIndex(keyword)) {
    return null;
  }

  return { action: "resolve-provider", providerKeyword: keyword };
}

function routeSkyscannerVoiceIntentForTab(activeTab, resultIntent, providerIntent) {
  if (!activeTab || !activeTab.id || !isSkyscannerFlightsTabUrl(activeTab.url || "")) {
    return false;
  }

  const onConfigPage = isSkyscannerConfigTabUrl(activeTab.url || "");
  const payload = onConfigPage ? providerIntent : resultIntent;
  if (!payload) return false;
  console.info("[aqual-skyscanner-voice]", JSON.stringify({
    event: "intent",
    payload,
    tabUrl: activeTab.url || "",
    onConfigPage
  }));

  chrome.tabs.sendMessage(
    activeTab.id,
    { type: "aqual-skyscanner-action", payload },
    { frameId: 0 },
    (response) => {
      if (chrome.runtime.lastError || !response || !response.ok || !response.url) {
        console.warn("[aqual-skyscanner-voice]", JSON.stringify({
          event: "resolve_failed",
          error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "",
          response: response || null,
          payload
        }));
        return;
      }

      const targetUrl = parseAbsoluteHttpUrl(response.url);
      if (!targetUrl) {
        console.warn("[aqual-skyscanner-voice]", JSON.stringify({
          event: "invalid_url",
          responseUrl: response.url,
          payload
        }));
        return;
      }

      const now = Date.now();
      if (lastVoiceCommand.key === targetUrl && now - lastVoiceCommand.timestamp < 4000) {
        return;
      }
      lastVoiceCommand = { key: targetUrl, timestamp: now };

      if (payload.action === "resolve-provider") {
        chrome.tabs.create({
          url: targetUrl,
          active: true,
          openerTabId: activeTab.id
        });
        return;
      }

      chrome.tabs.update(activeTab.id, { url: targetUrl });
    }
  );
  return true;
}

function maybeHandleSkyscannerVoiceCommand(text, activeTab = null) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return false;

  const resultIntent = parseSkyscannerResultIntent(text);
  const providerIntent = parseSkyscannerProviderIntent(text);
  if (!resultIntent && !providerIntent) {
    return false;
  }

  if (activeTab && typeof activeTab.id === "number") {
    return routeSkyscannerVoiceIntentForTab(activeTab, resultIntent, providerIntent);
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;
    routeSkyscannerVoiceIntentForTab(activeTab, resultIntent, providerIntent);
  });

  // Keep routing active so Google-specific intent parsing can still run in parallel
  // when the current tab is not a Skyscanner flights page.
  return false;
}

function maybeHandleGoogleSearchVoiceCommand(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return false;

  const hardcodedOpenOnIntent = parseHardcodedGoogleOpenOnIntent(normalized);
  if (hardcodedOpenOnIntent) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs.length ? tabs[0] : null;
      if (!activeTab || !activeTab.id || !isGoogleSearchTabUrl(activeTab.url || "")) {
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        {
          type: "aqual-google-search-action",
          payload: {
            action: "resolve-result",
            domainKeyword: hardcodedOpenOnIntent.domainKeyword,
            forceDomainMatch: true
          }
        },
        { frameId: 0 },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok || !response.url) {
            return;
          }
          const finalUrl = prepareVoiceOpenResultUrl(response.url);
          const finalHost = getHostnameSafe(finalUrl);
          console.info("[aqual-google-open]", JSON.stringify({
            mode: "open-result-on-domain",
            rawUrl: response.url,
            finalUrl,
            blockedGoogleHost: !finalUrl || isGoogleHost(finalHost)
          }));
          if (!finalUrl || isGoogleHost(finalHost)) {
            return;
          }
          const now = Date.now();
          if (lastVoiceCommand.key === finalUrl && now - lastVoiceCommand.timestamp < 4000) {
            return;
          }
          lastVoiceCommand = { key: finalUrl, timestamp: now };
          navigateToResolvedResult(activeTab, finalUrl);
        }
      );
    });
    return true;
  }

  const searchIntent = parseGoogleSearchIntent(normalized);
  if (searchIntent) {
    const searchUrl = buildGoogleSearchUrl(searchIntent.query, "all");
    const now = Date.now();
    if (lastVoiceCommand.key === searchUrl && now - lastVoiceCommand.timestamp < 4000) {
      return true;
    }
    lastGoogleSearchQuery = searchIntent.query;
    lastVoiceCommand = { key: searchUrl, timestamp: now };
    chrome.tabs.create({ url: searchUrl });
    return true;
  }

  const openIntent = parseGoogleOpenResultIntent(normalized);
  if (openIntent) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs.length ? tabs[0] : null;
      if (!activeTab || !activeTab.id || !isGoogleSearchTabUrl(activeTab.url || "")) {
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        {
          type: "aqual-google-search-action",
          payload: {
            action: "resolve-result",
            index: openIntent.index,
            domainKeyword: openIntent.domainKeyword
          }
        },
        { frameId: 0 },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok || !response.url) {
            return;
          }
          const finalUrl = prepareVoiceOpenResultUrl(response.url);
          const finalHost = getHostnameSafe(finalUrl);
          console.info("[aqual-google-open]", JSON.stringify({
            mode: "open-result-by-index",
            requestedIndex: openIntent.index,
            rawUrl: response.url,
            finalUrl,
            blockedGoogleHost: !finalUrl || isGoogleHost(finalHost)
          }));
          if (!finalUrl || isGoogleHost(finalHost)) {
            return;
          }
          const now = Date.now();
          if (lastVoiceCommand.key === finalUrl && now - lastVoiceCommand.timestamp < 4000) {
            return;
          }
          lastVoiceCommand = { key: finalUrl, timestamp: now };
          navigateToResolvedResult(activeTab, finalUrl);
        }
      );
    });
    return true;
  }

  const tabIntent = parseGoogleTabIntent(normalized);
  if (tabIntent) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs.length ? tabs[0] : null;
      let query = extractGoogleQueryFromUrl(activeTab ? activeTab.url : "");
      if (!query) {
        query = lastGoogleSearchQuery;
      }
      if (!query) {
        return;
      }

      const tabUrl = buildGoogleSearchUrl(query, tabIntent.tabKind);
      const now = Date.now();
      if (lastVoiceCommand.key === tabUrl && now - lastVoiceCommand.timestamp < 4000) {
        return;
      }
      lastGoogleSearchQuery = query;
      lastVoiceCommand = { key: tabUrl, timestamp: now };

      if (activeTab && activeTab.id) {
        chrome.tabs.update(activeTab.id, { url: tabUrl });
      } else {
        chrome.tabs.create({ url: tabUrl });
      }
    });
    return true;
  }

  return false;
}

const ON_INTENT_PATTERNS = [
  "turn on",
  "switch on",
  "enable",
  "activate",
  "start",
  "show"
];

const OFF_INTENT_PATTERNS = [
  "turn off",
  "switch off",
  "disable",
  "deactivate",
  "stop",
  "hide"
];

const TOGGLE_INTENT_PATTERNS = [
  "toggle",
  "flip"
];

const SET_INTENT_PATTERNS = [
  "set",
  "change",
  "choose",
  "select",
  "use",
  "switch to",
  "make"
];

const RESET_INTENT_PATTERNS = [
  "reset",
  "restore",
  "default",
  "normal",
  "original"
];

const FONT_ALIASES = [
  { value: "open-dyslexic", phrases: ["open dyslexic", "dyslexic", "open dyslexia"] },
  { value: "lexend", phrases: ["lexend"] },
  { value: "sign-language", phrases: ["sign language", "sign-language"] },
  { value: "arial", phrases: ["arial"] },
  { value: "verdana", phrases: ["verdana"] },
  { value: "impact", phrases: ["impact"] },
  { value: "comic-sans", phrases: ["comic sans", "comic-sans", "comic"] }
];

const CURSOR_ALIASES = [
  {
    value: "arrow-large.png",
    phrases: [
      "large arrow",
      "arrow",
      "large cursor",
      "big cursor",
      "large pointer",
      "big pointer",
      "default cursor",
      "normal cursor"
    ]
  },
  { value: "black-large.cur", phrases: ["high contrast black", "black cursor", "contrast cursor", "black pointer"] },
  { value: "pencil-large.png", phrases: ["pencil", "pen cursor", "pencil pointer"] }
];

const COLOR_VISION_ALIASES = [
  { value: "none", phrases: ["none", "off", "normal", "default"] },
  { value: "protanopia", phrases: ["protanopia", "protan", "red weak", "red blindness", "red blind"] },
  { value: "deuteranopia", phrases: ["deuteranopia", "deuteran", "green weak", "green blindness", "green blind"] },
  { value: "tritanopia", phrases: ["tritanopia", "tritan", "blue weak", "blue blindness", "blue blind"] }
];

const COLOR_NAME_MAP = {
  white: "#ffffff",
  black: "#000000",
  red: "#ef4444",
  orange: "#f39c19",
  yellow: "#f2c511",
  green: "#2ecc70",
  blue: "#3398db",
  cyan: "#06b6d4",
  teal: "#1ca085",
  purple: "#a463bf",
  pink: "#ec4899",
  magenta: "#d946ef",
  gray: "#6b7280",
  grey: "#6b7280",
  brown: "#8b5e3c"
};

const VISUAL_COMMAND_KEYWORDS = [
  "font",
  "text",
  "stroke",
  "crowding",
  "image veil",
  "highlight",
  "beeline",
  "line guide",
  "line guidance",
  "reading line",
  "drawing",
  "draw",
  "magnifier",
  "magnification",
  "zoom",
  "contrast",
  "night mode",
  "reading mode",
  "dimming",
  "brightness",
  "blue light",
  "color vision",
  "color blind",
  "link",
  "cursor",
  "pointer",
  "print",
  "capture",
  "screenshot",
  "reset"
];

const FUZZY_FEATURE_DEFINITIONS = [
  { key: "fontEnabled", phrases: ["font", "font family", "custom font", "typeface"] },
  { key: "fontSizeEnabled", phrases: ["font size", "text size", "text scaling", "large text", "small text"] },
  { key: "fontColorEnabled", phrases: ["font color", "text color", "font colour", "text colour"] },
  { key: "textStrokeEnabled", phrases: ["text stroke", "stroke", "text outline", "outline text"] },
  { key: "reducedCrowdingEnabled", phrases: ["reduced text crowding", "text crowding", "word spacing", "letter spacing"] },
  { key: "imageVeilEnabled", phrases: ["image veil", "hide images", "replace images", "veil images"] },
  { key: "highlightEnabled", phrases: ["highlight words", "word highlight", "highlight text", "bionic reading"] },
  { key: "lineGuideEnabled", phrases: ["beeline", "line guide", "line guidance", "reading line", "focus line", "tracking line"] },
  { key: "readingModeEnabled", phrases: ["reading mode", "ai reading mode", "article mode", "reader mode", "focus reading mode"] },
  { key: "drawingEnabled", phrases: ["drawing mode", "draw on page", "annotation mode", "draw mode"] },
  { key: "magnifierEnabled", phrases: ["magnifier", "zoom lens", "image magnifier", "magnification"] },
  { key: "linkEmphasisEnabled", phrases: ["link emphasis", "emphasize links", "emphasise links", "underline links"] },
  { key: "cursorEnabled", phrases: ["cursor", "pointer", "mouse pointer", "mouse cursor"] },
  { key: "highContrastEnabled", phrases: ["high contrast mode", "high contrast", "contrast mode", "high con", "high con trust", "con trust mode", "contrast"] },
  { key: "nightModeEnabled", phrases: ["night mode", "low vision mode", "dark reading mode"] },
  { key: "dimmingEnabled", phrases: ["dimming", "brightness dimming", "reduce glare", "dim screen"] },
  { key: "blueLightEnabled", phrases: ["blue light filter", "blue light", "warm filter", "night shift"] },
  { key: "colorBlindMode", phrases: ["color vision", "colour vision", "color blind mode", "colour blind mode", "protanopia", "deuteranopia", "tritanopia"] }
];

const FUZZY_INTENT_STOP_WORDS = new Set([
  "can",
  "could",
  "would",
  "you",
  "me",
  "my",
  "please",
  "just",
  "now",
  "the",
  "a",
  "an",
  "this",
  "that",
  "it",
  "for",
  "to",
  "of",
  "in",
  "on",
  "off",
  "with",
  "and",
  "then",
  "feature",
  "features",
  "setting",
  "settings",
  "option",
  "options",
  "state",
  "mode",
  "modes",
  "turn",
  "switch",
  "set",
  "choose",
  "select",
  "use",
  "make",
  "do",
  "toggle",
  "activate",
  "deactivate",
  "enable",
  "disable",
  "show",
  "hide"
]);

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100
};

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function containsWord(text, word) {
  return new RegExp(`\\b${word}\\b`).test(text);
}

function isResetIntent(text) {
  return includesAny(text, RESET_INTENT_PATTERNS);
}

function detectSwitchIntent(text) {
  if (includesAny(text, OFF_INTENT_PATTERNS) || /\b(?:off|disabled?)\b/.test(text)) {
    return "off";
  }
  if (includesAny(text, ON_INTENT_PATTERNS) || /\b(?:on|enabled?)\b/.test(text)) {
    return "on";
  }
  if (includesAny(text, TOGGLE_INTENT_PATTERNS)) {
    return "toggle";
  }
  return null;
}

function detectSetIntent(text) {
  if (!text) return false;
  if (includesAny(text, SET_INTENT_PATTERNS)) {
    return true;
  }
  return /\b(?:set|change|choose|select|use|make)\b/.test(text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseForSimilarity(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collapseForPhonetic(value) {
  let token = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!token) return "";
  token = token
    .replace(/ph/g, "f")
    .replace(/ght/g, "t")
    .replace(/kn/g, "n")
    .replace(/wr/g, "r")
    .replace(/wh/g, "w")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/x/g, "ks")
    .replace(/[cq]/g, "k")
    .replace(/v/g, "f")
    .replace(/z/g, "s");

  const first = token[0];
  const rest = token.slice(1).replace(/[aeiouy]/g, "");
  return `${first}${rest}`.replace(/(.)\1+/g, "$1");
}

function normalizedLevenshtein(left, right) {
  if (!left || !right) return 0;
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) return 0;
  const distance = levenshtein(left, right);
  return 1 - (distance / maxLen);
}

function similarityScore(a, b) {
  return normalizedLevenshtein(collapseForSimilarity(a), collapseForSimilarity(b));
}

function phoneticSimilarityScore(a, b) {
  return normalizedLevenshtein(collapseForPhonetic(a), collapseForPhonetic(b));
}

function tokenizeFuzzy(value) {
  return String(value || "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !FUZZY_INTENT_STOP_WORDS.has(token));
}

function ngramSimilarityScore(a, b, size = 2) {
  const left = collapseForSimilarity(a);
  const right = collapseForSimilarity(b);
  if (!left || !right) return 0;

  const build = (text) => {
    const set = new Set();
    if (text.length <= size) {
      set.add(text);
      return set;
    }
    for (let i = 0; i <= text.length - size; i += 1) {
      set.add(text.slice(i, i + size));
    }
    return set;
  };

  const leftSet = build(left);
  const rightSet = build(right);
  let intersection = 0;
  leftSet.forEach((item) => {
    if (rightSet.has(item)) intersection += 1;
  });
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function bestWordSimilarity(candidateWords, phraseWord) {
  if (!candidateWords.length || !phraseWord) return 0;
  let best = 0;
  for (let i = 0; i < candidateWords.length; i += 1) {
    const candidate = candidateWords[i];
    const lexical = similarityScore(candidate, phraseWord);
    const phonetic = phoneticSimilarityScore(candidate, phraseWord);
    const left = collapseForSimilarity(candidate);
    const right = collapseForSimilarity(phraseWord);
    const startsSame = left && right && left[0] === right[0];
    const prefixScore = startsSame ? (Math.min(left.length, right.length) / Math.max(left.length, right.length)) : 0;
    const combined = Math.max(lexical, phonetic * 0.95, prefixScore * 0.65);
    if (combined > best) best = combined;
  }
  return best;
}

function computeTokenCoverageScore(candidateWords, phraseWords) {
  if (!candidateWords.length || !phraseWords.length) {
    return { score: 0, peak: 0, matchRatio: 0 };
  }
  let total = 0;
  let peak = 0;
  let matched = 0;
  for (let i = 0; i < phraseWords.length; i += 1) {
    const wordScore = bestWordSimilarity(candidateWords, phraseWords[i]);
    total += wordScore;
    if (wordScore > peak) peak = wordScore;
    if (wordScore >= 0.35) matched += 1;
  }
  const coverage = total / phraseWords.length;
  const matchRatio = matched / phraseWords.length;
  return {
    score: (coverage * 0.8) + (matchRatio * 0.2),
    peak,
    matchRatio
  };
}

function evaluateFuzzyPair(candidateText, phrase) {
  const candidateWords = tokenizeFuzzy(candidateText);
  const phraseWords = tokenizeFuzzy(phrase);
  const tokenData = computeTokenCoverageScore(candidateWords, phraseWords);
  const lexical = similarityScore(candidateText, phrase);
  const phonetic = phoneticSimilarityScore(candidateText, phrase);
  const ngram = ngramSimilarityScore(candidateText, phrase, 2);

  const blended = (tokenData.score * 0.5) + (lexical * 0.22) + (phonetic * 0.2) + (ngram * 0.08);
  const score = Math.max(blended, (lexical * 0.92) + (tokenData.score * 0.08));

  return { score, peak: tokenData.peak, matchRatio: tokenData.matchRatio };
}

function extractFuzzyTargetText(normalizedText) {
  let stripped = ` ${normalizedText} `;
  const intentPhrases = [...ON_INTENT_PATTERNS, ...OFF_INTENT_PATTERNS, ...TOGGLE_INTENT_PATTERNS, ...SET_INTENT_PATTERNS]
    .sort((a, b) => b.length - a.length);

  intentPhrases.forEach((phrase) => {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "\\s+")}\\b`, "g");
    stripped = stripped.replace(pattern, " ");
  });

  const cleanedTokens = stripped
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !FUZZY_INTENT_STOP_WORDS.has(token));

  const cleaned = cleanedTokens.join(" ").trim();
  if (cleaned) return cleaned;
  return stripped.trim();
}

function getFuzzyThreshold(targetText) {
  const size = collapseForSimilarity(targetText).length;
  if (size <= 4) return 0.62;
  if (size <= 8) return 0.5;
  if (size <= 14) return 0.44;
  return 0.4;
}

function extractSetValueCandidates(normalizedText) {
  if (!normalizedText) return [];
  const candidates = new Set([normalizedText]);
  const patterns = [
    /\b(?:set|change|choose|select|use|make)\b(?:\s+\w+){0,10}\s+\bto\b\s+(.+)$/,
    /\bswitch(?:\s+\w+){0,6}\s+\bto\b\s+(.+)$/,
    /\b(?:set|change|choose|select|use|make)\b\s+(.+)$/
  ];

  patterns.forEach((pattern) => {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const value = match[1].trim();
      if (value) {
        candidates.add(value);
      }
    }
  });

  return Array.from(candidates);
}

function stripSelectionNoise(text, ignorePhrases = []) {
  let cleaned = ` ${text} `;
  const commonNoise = [
    "set",
    "change",
    "choose",
    "select",
    "use",
    "switch",
    "make",
    "to",
    "my",
    "the",
    "a",
    "an",
    "please",
    "custom",
    "feature",
    "setting",
    "settings",
    "option",
    "options",
    "style",
    "mode"
  ];
  const phrases = [...commonNoise, ...ignorePhrases]
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  phrases.forEach((phrase) => {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "\\s+")}\\b`, "g");
    cleaned = cleaned.replace(pattern, " ");
  });

  return cleaned.replace(/\s+/g, " ").trim();
}

function resolveAliasValueBySimilarity(text, aliases, options = {}) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;

  const baseCandidates = detectSetIntent(normalized)
    ? extractSetValueCandidates(normalized)
    : [normalized];

  const candidates = new Set();
  baseCandidates.forEach((candidate) => {
    const value = candidate.trim();
    if (!value) return;
    candidates.add(value);
    const stripped = stripSelectionNoise(value, options.ignorePhrases || []);
    if (stripped) {
      candidates.add(stripped);
    }
  });

  let bestMatch = null;
  aliases.forEach((entry) => {
    entry.phrases.forEach((phrase) => {
      candidates.forEach((candidate) => {
        const evaluated = evaluateFuzzyPair(candidate, phrase);
        let score = evaluated.score;
        const candidateCollapsed = collapseForSimilarity(candidate);
        const phraseCollapsed = collapseForSimilarity(phrase);
        if (candidateCollapsed && phraseCollapsed && candidateCollapsed.includes(phraseCollapsed)) {
          score = Math.max(score, 0.97);
        }
        const selection = {
          value: entry.value,
          phrase,
          candidate,
          score,
          matchRatio: evaluated.matchRatio,
          peak: evaluated.peak
        };

        if (!bestMatch || selection.score > bestMatch.score) {
          bestMatch = selection;
        }
      });
    });
  });

  if (!bestMatch) return null;

  const thresholdBase = getFuzzyThreshold(bestMatch.candidate);
  const minimum = typeof options.minThreshold === "number" ? options.minThreshold : 0.45;
  const threshold = Math.max(minimum, thresholdBase - 0.06);

  if (bestMatch.score >= threshold) {
    return bestMatch.value;
  }
  if (bestMatch.matchRatio >= 0.9 && bestMatch.score >= threshold - 0.05) {
    return bestMatch.value;
  }
  if (bestMatch.peak >= 0.96 && bestMatch.score >= threshold - 0.08) {
    return bestMatch.value;
  }
  return null;
}

function resolveFuzzyFeatureBySimilarity(normalizedText) {
  const target = extractFuzzyTargetText(normalizedText);
  if (collapseForSimilarity(target).length < 3) {
    return null;
  }

  const candidateTexts = [target, normalizedText].filter(Boolean);
  let bestMatch = null;
  let secondBestMatch = null;

  FUZZY_FEATURE_DEFINITIONS.forEach((feature) => {
    feature.phrases.forEach((phrase) => {
      let phraseBest = { score: 0, peak: 0, matchRatio: 0 };
      for (let i = 0; i < candidateTexts.length; i += 1) {
        const evaluated = evaluateFuzzyPair(candidateTexts[i], phrase);
        if (evaluated.score > phraseBest.score) {
          phraseBest = evaluated;
        }
      }

      const candidate = {
        key: feature.key,
        phrase,
        score: phraseBest.score,
        peak: phraseBest.peak,
        matchRatio: phraseBest.matchRatio
      };

      if (!bestMatch || candidate.score > bestMatch.score) {
        secondBestMatch = bestMatch;
        bestMatch = candidate;
      } else if (!secondBestMatch || candidate.score > secondBestMatch.score) {
        secondBestMatch = candidate;
      }
    });
  });

  if (!bestMatch) return null;
  const threshold = getFuzzyThreshold(target);

  if (bestMatch.matchRatio >= 0.98 && bestMatch.score >= Math.max(0.34, threshold * 0.78)) {
    return bestMatch;
  }
  if (bestMatch.score < threshold) {
    return null;
  }

  const margin = bestMatch.score - (secondBestMatch ? secondBestMatch.score : 0);
  if (secondBestMatch && margin < 0.03 && bestMatch.score < 0.52) {
    return null;
  }
  return bestMatch;
}

function applyFuzzySwitchIntent(result, settings, featureKey, switchIntent) {
  if (switchIntent !== "on" && switchIntent !== "off") {
    return false;
  }

  if (featureKey === "colorBlindMode") {
    if (switchIntent === "off") {
      result.updates.colorBlindMode = "none";
    } else {
      result.updates.colorBlindMode = settings.colorBlindMode && settings.colorBlindMode !== "none"
        ? settings.colorBlindMode
        : "protanopia";
    }
    result.handled = true;
    return true;
  }

  result.updates[featureKey] = switchIntent === "on";

  if (switchIntent === "off") {
    if (featureKey === "fontEnabled") {
      result.updates.fontFamily = DEFAULTS.fontFamily;
    }
    if (featureKey === "fontSizeEnabled") {
      result.updates.fontSizePx = DEFAULTS.fontSizePx;
    }
    if (featureKey === "fontColorEnabled") {
      result.updates.fontColor = DEFAULTS.fontColor;
    }
    if (featureKey === "textStrokeEnabled") {
      result.updates.textStrokeColor = DEFAULTS.textStrokeColor;
    }
    if (featureKey === "magnifierEnabled") {
      result.updates.magnifierSize = DEFAULTS.magnifierSize;
      result.updates.magnifierZoom = DEFAULTS.magnifierZoom;
    }
    if (featureKey === "cursorEnabled") {
      result.updates.cursorType = DEFAULTS.cursorType;
    }
    if (featureKey === "dimmingEnabled") {
      result.updates.dimmingLevel = DEFAULTS.dimmingLevel;
    }
    if (featureKey === "blueLightEnabled") {
      result.updates.blueLightLevel = DEFAULTS.blueLightLevel;
    }
    if (featureKey === "drawingEnabled") {
      result.actions.clearDrawings = true;
    }
  } else {
    if (featureKey === "dimmingEnabled" && Number(settings.dimmingLevel) <= 0) {
      result.updates.dimmingLevel = DEFAULTS.dimmingLevel;
    }
    if (featureKey === "blueLightEnabled" && Number(settings.blueLightLevel) <= 0) {
      result.updates.blueLightLevel = DEFAULTS.blueLightLevel;
    }
  }

  result.handled = true;
  return true;
}

function applyFuzzySetIntent(result, settings, featureKey, normalizedText) {
  if (!detectSetIntent(normalizedText)) {
    return false;
  }

  if (featureKey === "fontEnabled") {
    const family = resolveFontFamily(normalizedText);
    if (family) {
      result.updates.fontFamily = family;
    }
    result.updates.fontEnabled = true;
    result.handled = true;
    return true;
  }

  if (featureKey === "cursorEnabled") {
    const cursorType = resolveCursorType(normalizedText);
    if (cursorType) {
      result.updates.cursorType = cursorType;
    }
    result.updates.cursorEnabled = true;
    result.handled = true;
    return true;
  }

  if (featureKey === "colorBlindMode") {
    const mode = resolveColorVisionMode(normalizedText);
    result.updates.colorBlindMode = mode || (settings.colorBlindMode && settings.colorBlindMode !== "none"
      ? settings.colorBlindMode
      : "protanopia");
    result.handled = true;
    return true;
  }

  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function extractNumberValue(text) {
  const numeric = text.match(/-?\d+(?:\.\d+)?/);
  if (numeric) {
    return Number(numeric[0]);
  }

  const tokens = text.split(" ");
  for (let i = 0; i < tokens.length; i += 1) {
    if (!(tokens[i] in NUMBER_WORDS)) continue;
    let current = 0;
    let consumed = 0;
    for (let j = i; j < tokens.length; j += 1) {
      const token = tokens[j];
      if (token === "and") {
        consumed += 1;
        continue;
      }
      if (!(token in NUMBER_WORDS)) {
        break;
      }
      const value = NUMBER_WORDS[token];
      if (value === 100) {
        current = (current || 1) * 100;
      } else {
        current += value;
      }
      consumed += 1;
    }
    if (consumed > 0) {
      return current;
    }
  }

  return null;
}

function extractColorValue(text) {
  const hex6 = text.match(/\b#?([0-9a-f]{6})\b/i);
  if (hex6) {
    return `#${hex6[1]}`.toUpperCase();
  }
  const hex3 = text.match(/\b#?([0-9a-f]{3})\b/i);
  if (hex3) {
    return `#${hex3[1]}`.toUpperCase();
  }

  const names = Object.keys(COLOR_NAME_MAP);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (containsWord(text, name)) {
      return COLOR_NAME_MAP[name];
    }
  }
  return null;
}

function resolveFontFamily(text) {
  for (let i = 0; i < FONT_ALIASES.length; i += 1) {
    const entry = FONT_ALIASES[i];
    if (includesAny(text, entry.phrases)) {
      return entry.value;
    }
  }
  const tokens = text.split(" ");
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (levenshtein(token, "lexend") <= 1) return "lexend";
    if (levenshtein(token, "impact") <= 1) return "impact";
    if (levenshtein(token, "arial") <= 1) return "arial";
    if (levenshtein(token, "verdana") <= 1) return "verdana";
    if (levenshtein(token, "comic") <= 1) return "comic-sans";
  }
  const fuzzy = resolveAliasValueBySimilarity(text, FONT_ALIASES, {
    ignorePhrases: ["font", "font family", "typeface", "text", "custom font"],
    minThreshold: 0.42
  });
  if (fuzzy) {
    return fuzzy;
  }
  return null;
}

function resolveCursorType(text) {
  for (let i = 0; i < CURSOR_ALIASES.length; i += 1) {
    const entry = CURSOR_ALIASES[i];
    if (includesAny(text, entry.phrases)) {
      return entry.value;
    }
  }
  const fuzzy = resolveAliasValueBySimilarity(text, CURSOR_ALIASES, {
    ignorePhrases: ["cursor", "pointer", "mouse cursor", "mouse pointer", "custom pointer", "custom cursor"],
    minThreshold: 0.43
  });
  if (fuzzy) {
    return fuzzy;
  }
  return null;
}

function resolveColorVisionMode(text) {
  for (let i = 0; i < COLOR_VISION_ALIASES.length; i += 1) {
    const entry = COLOR_VISION_ALIASES[i];
    if (includesAny(text, entry.phrases)) {
      return entry.value;
    }
  }
  const fuzzy = resolveAliasValueBySimilarity(text, COLOR_VISION_ALIASES, {
    ignorePhrases: ["color vision", "colour vision", "color blind", "colour blind"],
    minThreshold: 0.42
  });
  if (fuzzy) {
    return fuzzy;
  }
  return null;
}

function mentionFontFamily(text) {
  return (includesAny(text, ["font", "font family", "typeface", "custom font"])
    && !includesAny(text, ["font size", "text size", "font color", "text color", "stroke"]));
}

function mentionFontSize(text) {
  return includesAny(text, ["font size", "text size", "size text", "text bigger", "text smaller"]);
}

function mentionFontColor(text) {
  return includesAny(text, ["font color", "text color", "font colour", "text colour", "color text", "colour text"])
    && !includesAny(text, ["stroke", "outline"]);
}

function mentionTextStroke(text) {
  return includesAny(text, ["text stroke", "stroke color", "text outline", "outline text", "stroke"]);
}

function mentionReducedCrowding(text) {
  return includesAny(text, ["reduced text crowding", "reduce text crowding", "text crowding", "word spacing", "letter spacing", "reduce crowding"]);
}

function mentionImageVeil(text) {
  return includesAny(text, ["image veil", "veil images", "hide images", "replace images"]);
}

function mentionHighlightWords(text) {
  return includesAny(text, ["highlight words", "word highlight", "highlight text", "bionic"]);
}

function mentionLineGuide(text) {
  return includesAny(text, ["beeline", "line guide", "line guidance", "reading line", "focus line", "tracking line"]);
}

function mentionDrawing(text) {
  return includesAny(text, ["draw on page", "drawing mode", "draw mode", "annotation mode", "drawings"]);
}

function mentionMagnifier(text) {
  return includesAny(text, ["magnifier", "zoom lens", "image magnifier", "magnification", "zoom"]);
}

function mentionLinkEmphasis(text) {
  return includesAny(text, ["emphasize links", "emphasise links", "link emphasis", "underline links", "highlight links"]);
}

function mentionCursor(text) {
  return includesAny(text, ["cursor", "pointer", "mouse pointer", "mouse cursor"]);
}

function mentionHighContrast(text) {
  return includesAny(text, ["high contrast", "contrast mode"]);
}

function mentionReadingMode(text) {
  return includesAny(text, ["reading mode", "ai reading mode", "article mode", "reader mode", "focus reading mode"])
    && !includesAny(text, ["night mode", "dark reading", "low vision mode"]);
}

function mentionNightMode(text) {
  return includesAny(text, ["night mode", "low vision mode", "dark reading"]);
}

function mentionDimming(text) {
  return includesAny(text, ["dimming", "dim screen", "brightness", "reduce glare", "glare"]);
}

function mentionBlueLight(text) {
  return includesAny(text, ["blue light", "blue-light", "warm filter", "night shift"]);
}

function mentionColorVision(text) {
  return includesAny(text, ["color vision", "colour vision", "color blind", "colour blind", "protanopia", "deuteranopia", "tritanopia"]);
}

function mentionPrint(text) {
  return containsWord(text, "print") || text.includes("print page");
}

function mentionCapture(text) {
  return includesAny(text, ["capture", "capture page", "capture screenshot", "screenshot", "screen shot", "take screenshot"]);
}

function mentionResetAll(text) {
  if (!isResetIntent(text)) return false;
  if (includesAny(text, ["reset all", "reset everything", "all settings", "all defaults", "reset settings"])) {
    return true;
  }
  const hasFeatureWord = includesAny(text, VISUAL_COMMAND_KEYWORDS.filter((word) => word !== "reset"));
  return !hasFeatureWord;
}

function setBooleanUpdate(result, settings, key, switchIntent, resetIntent, defaultValue) {
  if (resetIntent) {
    result.updates[key] = defaultValue;
    result.handled = true;
    return true;
  }
  if (switchIntent === "toggle") {
    result.updates[key] = !settings[key];
    result.handled = true;
    return true;
  }
  if (switchIntent === "on") {
    result.updates[key] = true;
    result.handled = true;
    return true;
  }
  if (switchIntent === "off") {
    result.updates[key] = false;
    result.handled = true;
    return true;
  }
  return false;
}

function parseVisualVoiceCommand(normalizedText, settings) {
  const result = {
    handled: false,
    updates: {},
    actions: {
      clearDrawings: false,
      printPage: false,
      captureScreenshot: false
    }
  };

  const switchIntent = detectSwitchIntent(normalizedText);
  const setIntent = detectSetIntent(normalizedText);
  const resetIntent = isResetIntent(normalizedText);

  if (mentionResetAll(normalizedText)) {
    result.updates = { ...DEFAULTS };
    result.actions.clearDrawings = true;
    result.handled = true;
    return result;
  }

  if (includesAny(normalizedText, ["clear drawings", "erase drawings", "remove drawings", "clear annotation", "erase annotation"])) {
    result.actions.clearDrawings = true;
    if (resetIntent || switchIntent === "off") {
      result.updates.drawingEnabled = false;
    }
    result.handled = true;
    return result;
  }

  if (mentionPrint(normalizedText)) {
    result.actions.printPage = true;
    result.handled = true;
    return result;
  }

  if (mentionCapture(normalizedText)) {
    result.actions.captureScreenshot = true;
    result.handled = true;
    return result;
  }

  if (mentionColorVision(normalizedText)) {
    if (resetIntent || switchIntent === "off") {
      result.updates.colorBlindMode = "none";
      result.handled = true;
      return result;
    }
    const mode = resolveColorVisionMode(normalizedText);
    if (mode) {
      result.updates.colorBlindMode = mode;
      result.handled = true;
      return result;
    }
    if (switchIntent === "toggle") {
      result.updates.colorBlindMode = settings.colorBlindMode === "none" ? "protanopia" : "none";
      result.handled = true;
      return result;
    }
  }

  if (mentionFontFamily(normalizedText)) {
    const family = resolveFontFamily(normalizedText);
    if (family) {
      result.updates.fontFamily = family;
      result.updates.fontEnabled = true;
      result.handled = true;
      return result;
    }
    if (resetIntent || switchIntent === "off") {
      result.updates.fontEnabled = false;
      result.updates.fontFamily = DEFAULTS.fontFamily;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "fontEnabled", switchIntent, false, DEFAULTS.fontEnabled)) {
      return result;
    }
  }

  if (mentionFontSize(normalizedText)) {
    const sizeValue = extractNumberValue(normalizedText);
    if (sizeValue !== null) {
      result.updates.fontSizePx = Math.round(clamp(sizeValue, 8, 120));
      result.updates.fontSizeEnabled = true;
      result.handled = true;
      return result;
    }
    if (resetIntent || switchIntent === "off") {
      result.updates.fontSizeEnabled = false;
      result.updates.fontSizePx = DEFAULTS.fontSizePx;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "fontSizeEnabled", switchIntent, false, DEFAULTS.fontSizeEnabled)) {
      return result;
    }
  }

  if (mentionFontColor(normalizedText)) {
    const colorValue = extractColorValue(normalizedText);
    if (colorValue) {
      result.updates.fontColor = colorValue;
      result.updates.fontColorEnabled = true;
      result.handled = true;
      return result;
    }
    if (resetIntent || switchIntent === "off") {
      result.updates.fontColorEnabled = false;
      result.updates.fontColor = DEFAULTS.fontColor;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "fontColorEnabled", switchIntent, false, DEFAULTS.fontColorEnabled)) {
      return result;
    }
  }

  if (mentionTextStroke(normalizedText)) {
    const colorValue = extractColorValue(normalizedText);
    if (colorValue) {
      result.updates.textStrokeColor = colorValue;
      result.updates.textStrokeEnabled = true;
      result.handled = true;
      return result;
    }
    if (resetIntent || switchIntent === "off") {
      result.updates.textStrokeEnabled = false;
      result.updates.textStrokeColor = DEFAULTS.textStrokeColor;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "textStrokeEnabled", switchIntent, false, DEFAULTS.textStrokeEnabled)) {
      return result;
    }
  }

  if (mentionCursor(normalizedText)) {
    const cursorType = resolveCursorType(normalizedText);
    if (cursorType) {
      result.updates.cursorType = cursorType;
      result.updates.cursorEnabled = true;
      result.handled = true;
      return result;
    }
    if (resetIntent || switchIntent === "off") {
      result.updates.cursorEnabled = false;
      result.updates.cursorType = DEFAULTS.cursorType;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "cursorEnabled", switchIntent, false, DEFAULTS.cursorEnabled)) {
      return result;
    }
  }

  if (mentionMagnifier(normalizedText) && includesAny(normalizedText, ["zoom", "magnification", "times", "x"])) {
    const zoomValue = extractNumberValue(normalizedText);
    if (zoomValue !== null) {
      result.updates.magnifierZoom = Math.round(clamp(zoomValue, 1, 5));
      result.updates.magnifierEnabled = true;
      result.handled = true;
      return result;
    }
  }

  if (mentionMagnifier(normalizedText) && includesAny(normalizedText, ["size", "diameter", "lens"])) {
    const sizeValue = extractNumberValue(normalizedText);
    if (sizeValue !== null) {
      result.updates.magnifierSize = Math.round(clamp(sizeValue, 20, 100));
      result.updates.magnifierEnabled = true;
      result.handled = true;
      return result;
    }
  }

  if (mentionDimming(normalizedText) && includesAny(normalizedText, ["set", "level", "to", "at"])) {
    const dimValue = extractNumberValue(normalizedText);
    if (dimValue !== null) {
      const normalized = dimValue <= 1 ? clamp(dimValue, 0, 0.8) : clamp(dimValue, 0, 80) / 100;
      result.updates.dimmingLevel = normalized;
      result.updates.dimmingEnabled = normalized > 0;
      result.handled = true;
      return result;
    }
  }

  if (mentionBlueLight(normalizedText) && includesAny(normalizedText, ["set", "level", "to", "at", "warm"])) {
    const blueValue = extractNumberValue(normalizedText);
    if (blueValue !== null) {
      const normalized = blueValue <= 1 ? clamp(blueValue, 0, 0.6) : clamp(blueValue, 0, 60) / 100;
      result.updates.blueLightLevel = normalized;
      result.updates.blueLightEnabled = normalized > 0;
      result.handled = true;
      return result;
    }
  }

  if (mentionImageVeil(normalizedText)) {
    if (resetIntent) {
      result.updates.imageVeilEnabled = DEFAULTS.imageVeilEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "imageVeilEnabled", switchIntent, false, DEFAULTS.imageVeilEnabled)) {
      return result;
    }
  }

  if (mentionHighlightWords(normalizedText)) {
    if (resetIntent) {
      result.updates.highlightEnabled = DEFAULTS.highlightEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "highlightEnabled", switchIntent, false, DEFAULTS.highlightEnabled)) {
      return result;
    }
  }

  if (mentionLineGuide(normalizedText)) {
    if (resetIntent) {
      result.updates.lineGuideEnabled = DEFAULTS.lineGuideEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "lineGuideEnabled", switchIntent, false, DEFAULTS.lineGuideEnabled)) {
      return result;
    }
  }

  if (mentionReducedCrowding(normalizedText)) {
    if (resetIntent) {
      result.updates.reducedCrowdingEnabled = DEFAULTS.reducedCrowdingEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "reducedCrowdingEnabled", switchIntent, false, DEFAULTS.reducedCrowdingEnabled)) {
      return result;
    }
  }

  if (mentionDrawing(normalizedText)) {
    if (resetIntent || switchIntent === "off") {
      result.updates.drawingEnabled = false;
      result.actions.clearDrawings = true;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "drawingEnabled", switchIntent, false, DEFAULTS.drawingEnabled)) {
      return result;
    }
  }

  if (mentionMagnifier(normalizedText)) {
    if (resetIntent || switchIntent === "off") {
      result.updates.magnifierEnabled = false;
      result.updates.magnifierSize = DEFAULTS.magnifierSize;
      result.updates.magnifierZoom = DEFAULTS.magnifierZoom;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "magnifierEnabled", switchIntent, false, DEFAULTS.magnifierEnabled)) {
      return result;
    }
  }

  if (mentionHighContrast(normalizedText)) {
    if (resetIntent) {
      result.updates.highContrastEnabled = DEFAULTS.highContrastEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "highContrastEnabled", switchIntent, false, DEFAULTS.highContrastEnabled)) {
      return result;
    }
  }

  if (mentionReadingMode(normalizedText)) {
    if (resetIntent) {
      result.updates.readingModeEnabled = DEFAULTS.readingModeEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "readingModeEnabled", switchIntent, false, DEFAULTS.readingModeEnabled)) {
      return result;
    }
  }

  if (mentionNightMode(normalizedText)) {
    if (resetIntent) {
      result.updates.nightModeEnabled = DEFAULTS.nightModeEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "nightModeEnabled", switchIntent, false, DEFAULTS.nightModeEnabled)) {
      return result;
    }
  }

  if (mentionDimming(normalizedText)) {
    if (resetIntent || switchIntent === "off") {
      result.updates.dimmingEnabled = false;
      result.updates.dimmingLevel = DEFAULTS.dimmingLevel;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "dimmingEnabled", switchIntent, false, DEFAULTS.dimmingEnabled)) {
      return result;
    }
  }

  if (mentionBlueLight(normalizedText)) {
    if (resetIntent || switchIntent === "off") {
      result.updates.blueLightEnabled = false;
      result.updates.blueLightLevel = DEFAULTS.blueLightLevel;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "blueLightEnabled", switchIntent, false, DEFAULTS.blueLightEnabled)) {
      return result;
    }
  }

  if (mentionLinkEmphasis(normalizedText)) {
    if (resetIntent) {
      result.updates.linkEmphasisEnabled = DEFAULTS.linkEmphasisEnabled;
      result.handled = true;
      return result;
    }
    if (setBooleanUpdate(result, settings, "linkEmphasisEnabled", switchIntent, false, DEFAULTS.linkEmphasisEnabled)) {
      return result;
    }
  }

  if (switchIntent === "on" || switchIntent === "off") {
    const fuzzyMatch = resolveFuzzyFeatureBySimilarity(normalizedText);
    if (fuzzyMatch) {
      if (applyFuzzySwitchIntent(result, settings, fuzzyMatch.key, switchIntent)) {
        return result;
      }
    }
  }

  if (setIntent) {
    const fuzzyMatch = resolveFuzzyFeatureBySimilarity(normalizedText);
    if (fuzzyMatch) {
      if (applyFuzzySetIntent(result, settings, fuzzyMatch.key, normalizedText)) {
        return result;
      }
    }
  }

  return result;
}

function applyVisualVoiceResult(result, settings, activeTab = null) {
  const updates = result.updates || {};
  const persistedUpdates = { ...updates };
  const hasReadingModeUpdate = Object.prototype.hasOwnProperty.call(persistedUpdates, "readingModeEnabled");
  if (hasReadingModeUpdate) {
    delete persistedUpdates.readingModeEnabled;
  }
  const hasUpdates = Object.keys(updates).length > 0;
  const hasPersistedUpdates = Object.keys(persistedUpdates).length > 0;

  const performTabActions = (tabId) => {
    if (result.actions.clearDrawings) {
      chrome.tabs.sendMessage(tabId, { type: "aqual-clear-drawings" }, () => {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
    if (result.actions.printPage) {
      chrome.tabs.sendMessage(tabId, { type: "aqual-print" }, () => {
        if (chrome.runtime.lastError) {
          return;
        }
      });
    }
  };

  const resolvedTab = activeTab && typeof activeTab.id === "number" ? activeTab : null;
  const activeTabId = resolvedTab ? resolvedTab.id : 0;

  const execute = (baseSettings) => {
    const effectiveBase = baseSettings && typeof baseSettings === "object" ? baseSettings : settings;
    if (activeTabId > 0 && hasUpdates) {
      const nextSettings = { ...effectiveBase, ...persistedUpdates };
      if (hasReadingModeUpdate) {
        nextSettings.readingModeEnabled = Boolean(updates.readingModeEnabled);
        readingModeStateByTab.set(activeTabId, Boolean(updates.readingModeEnabled));
      }
      sendToTab(activeTabId, nextSettings, {
        source: "voice-command",
        reason: "visual_command_apply"
      });
    }
    if (activeTabId > 0) {
      performTabActions(activeTabId);
    }
    if (result.actions.captureScreenshot) {
      captureScreenshot();
    }
  };

  if (hasPersistedUpdates && resolvedTab && resolvedTab.url) {
    updateSettingsForUrl(resolvedTab.url, persistedUpdates, (nextSettings) => {
      execute(nextSettings);
    });
    return;
  }
  execute(settings);
}

function maybeHandleVisualVoiceCommand(text) {
  const normalized = normalizeSpeech(text);
  const switchIntent = detectSwitchIntent(normalized);
  const setIntent = detectSetIntent(normalized);
  const hasVisualKeyword = includesAny(normalized, VISUAL_COMMAND_KEYWORDS);

  if (!normalized || (!hasVisualKeyword && switchIntent !== "on" && switchIntent !== "off" && !setIntent)) {
    return false;
  }

  const preview = parseVisualVoiceCommand(normalized, DEFAULTS);
  if (!preview.handled) {
    return false;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;
    const tabId = activeTab && typeof activeTab.id === "number" ? activeTab.id : 0;
    const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
    getSettingsForUrl(tabUrl, (settings) => {
      if (tabId > 0) {
        settings.readingModeEnabled = Boolean(readingModeStateByTab.get(tabId));
      }
      const command = parseVisualVoiceCommand(normalized, settings);
      if (!command.handled) return;
      applyVisualVoiceResult(command, settings, activeTab);
    });
  });
  return true;
}

function applyFlightSpeechCorrections(text) {
  let corrected = String(text || "");
  FLIGHT_STT_LOCATION_CORRECTIONS.forEach((entry) => {
    corrected = corrected.replace(entry.pattern, entry.replacement);
  });
  return corrected;
}

function normalizeFlightLocationAlias(location) {
  const normalized = normalizeSpeech(location || "");
  if (!normalized) return String(location || "").trim();
  if (normalized === "the blend") return "dublin";
  return String(location).trim();
}

function findLocations(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return [];
  const matches = [];
  Object.keys(SKYSCANNER_COUNTRY_CODES).forEach((name) => {
    if (normalized.includes(name)) {
      matches.push(name);
    }
  });
  return matches;
}

// Hardcoded country codes for Skyscanner
const SKYSCANNER_COUNTRY_CODES = {
  "edinburgh": "edi",
  "dublin": "dub",
  "london": "lon",
  "manchester": "man",
  "new york": "nyc",
  "tokyo": "tyo",
  "paris": "par",
  "nairobi": "nbo",
  "afghanistan": "af",
  "aland islands": "ax",
  "aland": "ax",
  "albania": "al",
  "algeria": "dz",
  "american samoa": "as",
  "andorra": "ad",
  "angola": "ao",
  "anguilla": "ai",
  "antarctica": "aq",
  "antigua and barbuda": "ag",
  "argentina": "ar",
  "armenia": "am",
  "aruba": "aw",
  "australia": "au",
  "austria": "at",
  "azerbaijan": "az",
  "bahamas": "bs",
  "bahrain": "bh",
  "bangladesh": "bd",
  "barbados": "bb",
  "belarus": "by",
  "belgium": "be",
  "belize": "bz",
  "benin": "bj",
  "bermuda": "bm",
  "bhutan": "bt",
  "bolivia": "bo",
  "bonaire sint eustatius and saba": "bq",
  "bosnia and herzegovina": "ba",
  "botswana": "bw",
  "bouvet island": "bv",
  "brazil": "br",
  "british indian ocean territory": "io",
  "brunei": "bn",
  "brunei darussalam": "bn",
  "bulgaria": "bg",
  "burkina faso": "bf",
  "burundi": "bi",
  "cabo verde": "cv",
  "cape verde": "cv",
  "cambodia": "kh",
  "cameroon": "cm",
  "canada": "ca",
  "cayman islands": "ky",
  "central african republic": "cf",
  "chad": "td",
  "chile": "cl",
  "china": "cn",
  "christmas island": "cx",
  "cocos keeling islands": "cc",
  "cocos islands": "cc",
  "colombia": "co",
  "comoros": "km",
  "congo": "cg",
  "congo brazzaville": "cg",
  "congo democratic republic": "cd",
  "democratic republic of the congo": "cd",
  "cook islands": "ck",
  "costa rica": "cr",
  "cote d ivoire": "ci",
  "cote d'ivoire": "ci",
  "ivory coast": "ci",
  "croatia": "hr",
  "cuba": "cu",
  "curacao": "cw",
  "cyprus": "cy",
  "czechia": "cz",
  "czech republic": "cz",
  "denmark": "dk",
  "djibouti": "dj",
  "dominica": "dm",
  "dominican republic": "do",
  "ecuador": "ec",
  "egypt": "eg",
  "el salvador": "sv",
  "equatorial guinea": "gq",
  "eritrea": "er",
  "estonia": "ee",
  "eswatini": "sz",
  "swaziland": "sz",
  "ethiopia": "et",
  "falkland islands": "fk",
  "faroe islands": "fo",
  "fiji": "fj",
  "finland": "fi",
  "france": "fr",
  "french guiana": "gf",
  "french polynesia": "pf",
  "french southern territories": "tf",
  "gabon": "ga",
  "gambia": "gm",
  "georgia": "ge",
  "germany": "de",
  "ghana": "gh",
  "gibraltar": "gi",
  "greece": "gr",
  "greenland": "gl",
  "grenada": "gd",
  "guadeloupe": "gp",
  "guam": "gu",
  "guatemala": "gt",
  "guernsey": "gg",
  "guinea": "gn",
  "guinea bissau": "gw",
  "guyana": "gy",
  "haiti": "ht",
  "heard island and mcdonald islands": "hm",
  "holy see": "va",
  "vatican": "va",
  "honduras": "hn",
  "hong kong": "hk",
  "hungary": "hu",
  "iceland": "is",
  "india": "in",
  "indonesia": "id",
  "iran": "ir",
  "iran islamic republic of": "ir",
  "iraq": "iq",
  "ireland": "ie",
  "isle of man": "im",
  "israel": "il",
  "italy": "it",
  "jamaica": "jm",
  "japan": "jp",
  "jersey": "je",
  "jordan": "jo",
  "kazakhstan": "kz",
  "kenya": "ke",
  "kiribati": "ki",
  "north korea": "kp",
  "korea north": "kp",
  "south korea": "kr",
  "korea south": "kr",
  "kuwait": "kw",
  "kyrgyzstan": "kg",
  "lao peoples democratic republic": "la",
  "laos": "la",
  "lao": "la",
  "latvia": "lv",
  "lebanon": "lb",
  "lesotho": "ls",
  "liberia": "lr",
  "libya": "ly",
  "liechtenstein": "li",
  "lithuania": "lt",
  "luxembourg": "lu",
  "macau": "mo",
  "macao": "mo",
  "north macedonia": "mk",
  "macedonia": "mk",
  "madagascar": "mg",
  "malawi": "mw",
  "malaysia": "my",
  "maldives": "mv",
  "mali": "ml",
  "malta": "mt",
  "marshall islands": "mh",
  "martinique": "mq",
  "mauritania": "mr",
  "mauritius": "mu",
  "mayotte": "yt",
  "mexico": "mx",
  "micronesia": "fm",
  "federated states of micronesia": "fm",
  "moldova": "md",
  "monaco": "mc",
  "mongolia": "mn",
  "montenegro": "me",
  "montserrat": "ms",
  "morocco": "ma",
  "mozambique": "mz",
  "myanmar": "mm",
  "burma": "mm",
  "namibia": "na",
  "nauru": "nr",
  "nepal": "np",
  "netherlands": "nl",
  "new caledonia": "nc",
  "new zealand": "nz",
  "nicaragua": "ni",
  "niger": "ne",
  "nigeria": "ng",
  "niue": "nu",
  "norfolk island": "nf",
  "northern mariana islands": "mp",
  "norway": "no",
  "oman": "om",
  "pakistan": "pk",
  "palau": "pw",
  "palestine": "ps",
  "panama": "pa",
  "papua new guinea": "pg",
  "paraguay": "py",
  "peru": "pe",
  "philippines": "ph",
  "pitcairn": "pn",
  "poland": "pl",
  "portugal": "pt",
  "puerto rico": "pr",
  "qatar": "qa",
  "reunion": "re",
  "romania": "ro",
  "russian federation": "ru",
  "russia": "ru",
  "rwanda": "rw",
  "saint barthelemy": "bl",
  "saint helena": "sh",
  "saint kitts and nevis": "kn",
  "saint lucia": "lc",
  "saint martin": "mf",
  "saint martin french": "mf",
  "saint pierre and miquelon": "pm",
  "saint vincent and the grenadines": "vc",
  "samoa": "ws",
  "san marino": "sm",
  "sao tome and principe": "st",
  "saudi arabia": "sa",
  "senegal": "sn",
  "serbia": "rs",
  "seychelles": "sc",
  "sierra leone": "sl",
  "singapore": "sg",
  "sint maarten": "sx",
  "slovakia": "sk",
  "slovenia": "si",
  "solomon islands": "sb",
  "somalia": "so",
  "south africa": "za",
  "south georgia and the south sandwich islands": "gs",
  "south sudan": "ss",
  "spain": "es",
  "sri lanka": "lk",
  "sudan": "sd",
  "suriname": "sr",
  "svalbard and jan mayen": "sj",
  "sweden": "se",
  "switzerland": "ch",
  "syria": "sy",
  "syrian arab republic": "sy",
  "taiwan": "tw",
  "tajikistan": "tj",
  "tanzania": "tz",
  "thailand": "th",
  "timor leste": "tl",
  "east timor": "tl",
  "togo": "tg",
  "tokelau": "tk",
  "tonga": "to",
  "trinidad and tobago": "tt",
  "tunisia": "tn",
  "turkey": "tr",
  "turkmenistan": "tm",
  "turks and caicos islands": "tc",
  "tuvalu": "tv",
  "uganda": "ug",
  "ukraine": "ua",
  "united arab emirates": "ae",
  "uae": "ae",
  "united kingdom": "gb",
  "uk": "gb",
  "great britain": "gb",
  "britain": "gb",
  "united states of america": "us",
  "united states": "us",
  "usa": "us",
  "us": "us",
  "united states minor outlying islands": "um",
  "uruguay": "uy",
  "uzbekistan": "uz",
  "vanuatu": "vu",
  "venezuela": "ve",
  "vietnam": "vn",
  "viet nam": "vn",
  "virgin islands british": "vg",
  "british virgin islands": "vg",
  "virgin islands us": "vi",
  "us virgin islands": "vi",
  "wallis and futuna": "wf",
  "western sahara": "eh",
  "yemen": "ye",
  "zambia": "zm",
  "zimbabwe": "zw"
};

const MONTH_MAP = {
  "january": "01",
  "jan": "01",
  "february": "02",
  "feb": "02",
  "march": "03",
  "mar": "03",
  "april": "04",
  "apr": "04",
  "may": "05",
  "june": "06",
  "jun": "06",
  "july": "07",
  "jul": "07",
  "august": "08",
  "aug": "08",
  "september": "09",
  "sep": "09",
  "sept": "09",
  "october": "10",
  "oct": "10",
  "november": "11",
  "nov": "11",
  "december": "12",
  "dec": "12"
};

const ORDINAL_WORDS = {
  "first": 1,
  "second": 2,
  "third": 3,
  "fourth": 4,
  "fifth": 5,
  "sixth": 6,
  "seventh": 7,
  "eighth": 8,
  "ninth": 9,
  "tenth": 10,
  "eleventh": 11,
  "twelfth": 12,
  "thirteenth": 13,
  "fourteenth": 14,
  "fifteenth": 15,
  "sixteenth": 16,
  "seventeenth": 17,
  "eighteenth": 18,
  "nineteenth": 19,
  "twentieth": 20,
  "twenty-first": 21,
  "twenty first": 21,
  "twentyfirst": 21,
  "twenty-second": 22,
  "twenty second": 22,
  "twentysecond": 22,
  "twenty-third": 23,
  "twenty third": 23,
  "twentythird": 23,
  "twenty-fourth": 24,
  "twenty fourth": 24,
  "twentyfourth": 24,
  "twenty-fifth": 25,
  "twenty fifth": 25,
  "twentyfifth": 25,
  "twenty-sixth": 26,
  "twenty sixth": 26,
  "twentysixth": 26,
  "twenty-seventh": 27,
  "twenty seventh": 27,
  "twentyseventh": 27,
  "twenty-eighth": 28,
  "twenty eighth": 28,
  "twentyeighth": 28,
  "twenty-ninth": 29,
  "twenty ninth": 29,
  "twentyninth": 29,
  "thirtieth": 30,
  "thirty-first": 31,
  "thirty first": 31,
  "thirtyfirst": 31
};

const DATE_MONTH_KEYS_SORTED = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length);
const DATE_ORDINAL_KEYS_SORTED = Object.keys(ORDINAL_WORDS).sort((a, b) => b.length - a.length);
const DATE_CARDINAL_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty one": 21,
  "twenty two": 22,
  "twenty three": 23,
  "twenty four": 24,
  "twenty five": 25,
  "twenty six": 26,
  "twenty seven": 27,
  "twenty eight": 28,
  "twenty nine": 29,
  thirty: 30,
  "thirty one": 31
};
const DATE_CARDINAL_KEYS_SORTED = Object.keys(DATE_CARDINAL_WORDS).sort((a, b) => b.length - a.length);
const DATE_MONTH_REGEX_SOURCE = DATE_MONTH_KEYS_SORTED
  .map((key) => escapeRegExp(key))
  .join("|");
const DATE_ORDINAL_REGEX_SOURCE = DATE_ORDINAL_KEYS_SORTED
  .map((key) => escapeRegExp(key).replace(/\\-/g, "[-\\s]?").replace(/\s+/g, "\\s+"))
  .join("|");
const DATE_CARDINAL_REGEX_SOURCE = DATE_CARDINAL_KEYS_SORTED
  .map((key) => escapeRegExp(key).replace(/\s+/g, "\\s+"))
  .join("|");

function normalizeDateTextInput(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/(\d{1,2})(st|nd|rd|th)\b/g, "$1")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/[,]/g, " ")
    .replace(/[^a-z0-9\s/.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateWordText(value) {
  return String(value || "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMonthFromDateText(normalizedDateText) {
  for (let i = 0; i < DATE_MONTH_KEYS_SORTED.length; i += 1) {
    const key = DATE_MONTH_KEYS_SORTED[i];
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(key)}(?=\\s|$)`);
    if (pattern.test(normalizedDateText)) {
      return MONTH_MAP[key];
    }
  }
  return null;
}

function extractOrdinalDayFromDateText(normalizedDateText) {
  const text = normalizeDateWordText(normalizedDateText);
  for (let i = 0; i < DATE_ORDINAL_KEYS_SORTED.length; i += 1) {
    const key = DATE_ORDINAL_KEYS_SORTED[i];
    const normalizedKey = normalizeDateWordText(key);
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedKey)}(?=\\s|$)`);
    if (pattern.test(text)) {
      return ORDINAL_WORDS[key];
    }
  }
  return null;
}

function extractCardinalDayFromDateText(normalizedDateText) {
  const text = normalizeDateWordText(normalizedDateText);
  for (let i = 0; i < DATE_CARDINAL_KEYS_SORTED.length; i += 1) {
    const key = DATE_CARDINAL_KEYS_SORTED[i];
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(key)}(?=\\s|$)`);
    if (pattern.test(text)) {
      return DATE_CARDINAL_WORDS[key];
    }
  }
  return null;
}

function extractNumericDayFromDateText(normalizedDateText) {
  const dayBeforeMonth = normalizedDateText.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:of\\s+)?(?:${DATE_MONTH_REGEX_SOURCE})\\b`, "i")
  );
  if (dayBeforeMonth) {
    const value = Number(dayBeforeMonth[1]);
    if (value >= 1 && value <= 31) {
      return value;
    }
  }

  const monthBeforeDay = normalizedDateText.match(
    new RegExp(`\\b(?:${DATE_MONTH_REGEX_SOURCE})\\s+(\\d{1,2})\\b`, "i")
  );
  if (monthBeforeDay) {
    const value = Number(monthBeforeDay[1]);
    if (value >= 1 && value <= 31) {
      return value;
    }
  }

  const allNumericTokens = normalizedDateText.match(/\b\d{1,4}\b/g) || [];
  for (let i = 0; i < allNumericTokens.length; i += 1) {
    const value = Number(allNumericTokens[i]);
    if (value >= 1 && value <= 31) {
      return value;
    }
  }
  return null;
}

function getCurrentTwoDigitYear() {
  return new Date().getFullYear() % 100;
}

function normalizeTwoDigitYearToken(rawYear) {
  const token = String(rawYear || "").trim();
  if (!token) return null;
  const numeric = Number(token);
  if (!Number.isFinite(numeric)) return null;
  if (token.length >= 4) {
    return Number(String(Math.trunc(numeric)).slice(-2));
  }
  if (numeric < 0 || numeric > 99) return null;
  return Math.trunc(numeric);
}

function extractTwoDigitYearFromDateText(rawDateText, normalizedDateText) {
  const raw = String(rawDateText || "");
  const normalized = String(normalizedDateText || "").trim().toLowerCase();
  const monthPattern = `(?:${DATE_MONTH_REGEX_SOURCE})`;

  // Explicit four-digit year: "2026", "March 22 2026", "22 March 2026"
  const fourDigit = raw.match(/\b(19|20)\d{2}\b/);
  if (fourDigit) {
    return Number(String(fourDigit[0]).slice(-2));
  }

  // Explicit year keyword: "year 26", "year 2026"
  const yearKeyword = raw.match(/\byear\s+(\d{2,4})\b/i);
  if (yearKeyword) {
    const parsed = normalizeTwoDigitYearToken(yearKeyword[1]);
    if (parsed !== null) return parsed;
  }

  // Apostrophe year: "March 22 '26"
  const apostropheYear = raw.match(/\b['’](\d{2})\b/);
  if (apostropheYear) {
    const parsed = normalizeTwoDigitYearToken(apostropheYear[1]);
    if (parsed !== null) return parsed;
  }

  // Month/day with trailing year: "March 22 26" or "22 March 26"
  const monthDayYear = normalized.match(
    new RegExp(`\\b${monthPattern}\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+(\\d{2,4})\\b`, "i")
  );
  if (monthDayYear) {
    const parsed = normalizeTwoDigitYearToken(monthDayYear[1]);
    if (parsed !== null) return parsed;
  }
  const dayMonthYear = normalized.match(
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?${monthPattern}\\s+(\\d{2,4})\\b`, "i")
  );
  if (dayMonthYear) {
    const parsed = normalizeTwoDigitYearToken(dayMonthYear[1]);
    if (parsed !== null) return parsed;
  }

  // No explicit year spoken: use current year.
  return getCurrentTwoDigitYear();
}

function getCountryCode(country) {
  const lower = country.toLowerCase().trim();
  if (SKYSCANNER_COUNTRY_CODES[lower]) {
    return SKYSCANNER_COUNTRY_CODES[lower];
  }
  // Use first 3 letters as fallback
  return lower.replace(/[^a-z]/g, "").slice(0, 3);
}

function parseDate(dateStr) {
  const normalizedInput = normalizeDateTextInput(dateStr);
  const lower = normalizedInput.toLowerCase().trim();
  let day = null;
  const currentYear = getCurrentTwoDigitYear();

  const yearFirstMatch = lower.match(/\b((?:19|20)\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (yearFirstMatch) {
    const year = Number(String(yearFirstMatch[1]).slice(-2));
    const month = Number(yearFirstMatch[2]);
    const date = Number(yearFirstMatch[3]);
    if (month >= 1 && month <= 12 && date >= 1 && date <= 31) {
      return `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}${String(date).padStart(2, "0")}`;
    }
  }

  const numericMatch = lower.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (numericMatch) {
    let first = Number(numericMatch[1]);
    let second = Number(numericMatch[2]);
    let year = numericMatch[3] ? Number(numericMatch[3]) : currentYear;
    if (year > 99) {
      year = Number(String(year).slice(-2));
    }
    let month = null;
    let date = null;
    if (first > 12 && second <= 12) {
      date = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      date = second;
      month = first;
    } else {
      date = first;
      month = second;
    }
    if (month >= 1 && month <= 12 && date >= 1 && date <= 31) {
      return `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}${String(date).padStart(2, "0")}`;
    }
  }

  const ordinalDay = extractOrdinalDayFromDateText(lower);
  if (ordinalDay) {
    day = ordinalDay;
  } else {
    const cardinalDay = extractCardinalDayFromDateText(lower);
    if (cardinalDay) {
      day = cardinalDay;
    } else {
      const numericDay = extractNumericDayFromDateText(lower);
      if (numericDay !== null && numericDay !== undefined) {
        day = numericDay;
      }
    }
  }

  if (!day) return null;
  day = String(day).padStart(2, "0");

  const month = extractMonthFromDateText(lower);
  if (!month) return null;

  const year = String(extractTwoDigitYearFromDateText(dateStr, lower)).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseSkyscannerDateCodeToDate(dateCode) {
  const token = String(dateCode || "").trim();
  if (!/^\d{6}$/.test(token)) return null;
  const year = 2000 + Number(token.slice(0, 2));
  const month = Number(token.slice(2, 4));
  const day = Number(token.slice(4, 6));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || (parsed.getMonth() + 1) !== month || parsed.getDate() !== day) {
    return null;
  }
  return parsed;
}

function formatDateToSkyscannerCode(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
  const yy = String(dateValue.getFullYear() % 100).padStart(2, "0");
  const mm = String(dateValue.getMonth() + 1).padStart(2, "0");
  const dd = String(dateValue.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function normalizeRoundTripDateOrder(departDateCode, returnDateCode) {
  const departDate = parseSkyscannerDateCodeToDate(departDateCode);
  const returnDate = parseSkyscannerDateCodeToDate(returnDateCode);
  if (!departDate || !returnDate) {
    return {
      departDateCode,
      returnDateCode
    };
  }

  const adjustedReturn = new Date(returnDate.getTime());
  while (adjustedReturn < departDate) {
    adjustedReturn.setFullYear(adjustedReturn.getFullYear() + 1);
  }

  return {
    departDateCode,
    returnDateCode: formatDateToSkyscannerCode(adjustedReturn) || returnDateCode
  };
}

function extractDates(text) {
  const normalizedText = normalizeDateTextInput(text);
  const matches = [];
  const monthNames = DATE_MONTH_REGEX_SOURCE;
  const ordinalWords = DATE_ORDINAL_REGEX_SOURCE;
  const cardinalWords = DATE_CARDINAL_REGEX_SOURCE;
  const patterns = [
    new RegExp(`\\b(${ordinalWords}|${cardinalWords}|\\d{1,2}(?:st|nd|rd|th)?)\\s*(?:of\\s+)?(${monthNames})\\b`, "gi"),
    new RegExp(`\\b(${monthNames})\\s*(\\d{1,2}(?:st|nd|rd|th)?)\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{2,4})?\\b`, "g"),
    new RegExp(`\\b(?:${monthNames})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*(?:19|20)\\d{2})?\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${monthNames})(?:\\s*,?\\s*(?:19|20)\\d{2})?\\b`, "gi"),
    new RegExp(`\\b(?:${monthNames})\\s+(${ordinalWords}|${cardinalWords})\\b`, "gi"),
    new RegExp(`\\b(${ordinalWords}|${cardinalWords})\\s+(?:of\\s+)?(?:${monthNames})\\b`, "gi")
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      matches.push({ raw: match[0], index: match.index });
    }
  });

  matches.sort((a, b) => a.index - b.index);
  const results = [];
  const seen = new Set();
  for (const candidate of matches) {
    const parsed = parseDate(candidate.raw);
    if (parsed) {
      const normalizedRaw = normalizeDateTextInput(candidate.raw);
      const dedupeKey = `${candidate.index}:${normalizedRaw}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      results.push({ raw: candidate.raw, parsed });
    }
  }
  return results;
}

function formatDateForParse(date) {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear() % 100;
  return `${day}/${month}/${String(year).padStart(2, "0")}`;
}

function shiftDateString(dateStr, offsetDays) {
  const parsed = parseDate(dateStr);
  if (!parsed) return null;
  const year = 2000 + Number(parsed.slice(0, 2));
  const month = Number(parsed.slice(2, 4)) - 1;
  const day = Number(parsed.slice(4, 6));
  const date = new Date(year, month, day);
  date.setDate(date.getDate() + offsetDays);
  return formatDateForParse(date);
}

function computeDefaultTripDates() {
  const today = new Date();
  const depart = new Date(today);
  depart.setDate(today.getDate() + 1);
  const returnDate = new Date(today);
  returnDate.setDate(today.getDate() + 2);
  return {
    departDate: formatDateForParse(depart),
    returnDate: formatDateForParse(returnDate)
  };
}

function isFlightIntent(text) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return false;
  const flightTokens = [
    "flight",
    "flights",
    "fly",
    "plane",
    "air",
    "airline",
    "airlines",
    "airfare",
    "air fare",
    "ticket",
    "tickets"
  ];
  const bookingTokens = [
    "book",
    "reserve",
    "find",
    "get",
    "schedule",
    "search",
    "buy",
    "need",
    "want",
    "go",
    "travel"
  ];
  const hasFlightWord = flightTokens.some((token) => normalized.includes(token));
  const hasBookingWord = bookingTokens.some((token) => normalized.includes(token));
  const hasRouteCue = normalized.includes(" to ") || normalized.includes("from ");
  return hasFlightWord || (hasBookingWord && hasRouteCue);
}

function extractFlightBooking(text, selectedCountry) {
  const correctedText = applyFlightSpeechCorrections(text)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-");

  // Check for flight intent with tolerant phrasing
  if (!isFlightIntent(correctedText)) return null;

  let origin = null;
  let destination = null;
  let departDate = null;
  let returnDate = null;

  const routePattern = /from\s+(.+?)\s+to\s+(.+?)(?=\s+(?:from|for|on|departing|leaving|returning)\b|$)/i;
  const routeMatch = correctedText.match(routePattern);
  if (routeMatch) {
    origin = routeMatch[1].trim();
    destination = routeMatch[2].trim();
  }

  const monthNames = DATE_MONTH_REGEX_SOURCE;
  const dayPattern = `(?:\\d{1,2}(?:st|nd|rd|th)?|${DATE_ORDINAL_REGEX_SOURCE}|${DATE_CARDINAL_REGEX_SOURCE})`;
  const datePattern = new RegExp(`from\\s+(?:the\\s+)?(${dayPattern}\\s+(?:of\\s+)?(?:${monthNames}))\\s+to\\s+(?:the\\s+)?(${dayPattern}\\s+(?:of\\s+)?(?:${monthNames}))`, "i");
  const dateMatch = correctedText.match(datePattern);

  if (dateMatch) {
    departDate = dateMatch[1].trim();
    returnDate = dateMatch[2].trim();

    const beforeDates = correctedText.slice(0, dateMatch.index).trim();

    const fullPattern = /from\s+(.+?)\s+to\s+(.+?)$/i;
    const fullMatch = beforeDates.match(fullPattern);

    if (fullMatch) {
      origin = fullMatch[1].trim();
      destination = fullMatch[2].trim();
    } else {
      const toOnlyPattern = /to\s+(.+?)$/i;
      const toMatch = beforeDates.match(toOnlyPattern);

      if (toMatch) {
        origin = "edinburgh";
        destination = toMatch[1].trim();
      } else {
        origin = "edinburgh";
        destination = selectedCountry || null;
      }
    }
  } else if (!origin || !destination) {
    const fromToPattern = /from\s+(.+?)\s+to\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i;
    const match = correctedText.match(fromToPattern);

    if (match) {
      const firstFrom = match[1].trim().toLowerCase();
      const looksLikeDate = /\d/.test(firstFrom) || Object.keys(MONTH_MAP).some((m) => firstFrom.includes(m));

      if (looksLikeDate) {
        origin = "edinburgh";
        destination = match[2].trim();
        departDate = match[1].trim();
        returnDate = match[3].trim();
      } else {
        origin = match[1].trim();
        destination = match[2].trim();
        departDate = match[3].trim();
        returnDate = match[4].trim();
      }
    } else {
      const toFromPattern = /to\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i;
      const toFromMatch = correctedText.match(toFromPattern);

      if (toFromMatch) {
        origin = "edinburgh";
        destination = toFromMatch[1].trim();
        departDate = toFromMatch[2].trim();
        returnDate = toFromMatch[3].trim();
      }
    }
  }

  if (!destination && selectedCountry) {
    destination = selectedCountry;
  }

  if (!destination || !origin) {
    const locations = findLocations(correctedText);
    if (!origin && locations.length > 0) {
      origin = locations[0];
    }
    if (!destination && locations.length > 1) {
      destination = locations[1];
    }
    if (!destination && locations.length === 1) {
      destination = locations[0];
    }
  }

  if (!origin) {
    origin = "edinburgh";
  }

  origin = normalizeFlightLocationAlias(origin);
  destination = normalizeFlightLocationAlias(destination);

  if (!destination || !departDate || !returnDate) {
    const dateCandidates = extractDates(correctedText);
    if (dateCandidates.length >= 2) {
      departDate = dateCandidates[0].raw;
      returnDate = dateCandidates[1].raw;
    }
  }

  if (!departDate && !returnDate) {
    const defaults = computeDefaultTripDates();
    departDate = defaults.departDate;
    returnDate = defaults.returnDate;
  } else if (departDate && !returnDate) {
    returnDate = shiftDateString(departDate, 1) || computeDefaultTripDates().returnDate;
  } else if (!departDate && returnDate) {
    departDate = shiftDateString(returnDate, -1) || computeDefaultTripDates().departDate;
  }

  if (!destination || !departDate || !returnDate) {
    console.log("Could not fully parse flight booking:", { origin, destination, departDate, returnDate });
    return null;
  }

  return { origin, destination, departDate, returnDate };
}

function buildSkyscannerUrl(booking) {
  const originCode = getCountryCode(booking.origin);
  const destCode = getCountryCode(booking.destination);
  const departDate = parseDate(booking.departDate);
  const returnDate = parseDate(booking.returnDate);

  if (!departDate || !returnDate) {
    console.log("Could not parse dates:", booking.departDate, booking.returnDate);
    return null;
  }

  const normalizedRoundTrip = normalizeRoundTripDateOrder(departDate, returnDate);
  const finalDepartDate = normalizedRoundTrip.departDateCode || departDate;
  const finalReturnDate = normalizedRoundTrip.returnDateCode || returnDate;

  return `https://www.skyscanner.net/transport/flights/${originCode}/${destCode}/${finalDepartDate}/${finalReturnDate}/?adultsv2=1&cabinclass=economy&childrenv2=&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false`;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return;
  try {
    if (chrome.offscreen.hasDocument) {
      const exists = await chrome.offscreen.hasDocument();
      if (exists) return;
    }
    await chrome.offscreen.createDocument({
      url: "pages/offscreen-audio/offscreen-audio.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture mic audio and play Gemini Live voice responses."
    });
  } catch (error) {
    // Ignore if offscreen creation fails; popup recording still works.
  }
}

function sendAudioControlMessage(payload, retryCount = 2) {
  chrome.runtime.sendMessage(payload, () => {
    if (!chrome.runtime.lastError) {
      return;
    }
    if (retryCount <= 0) {
      return;
    }
    ensureOffscreenDocument().then(() => {
      setTimeout(() => {
        sendAudioControlMessage(payload, retryCount - 1);
      }, 180);
    });
  });
}

function sendGeminiLiveMessageToTab(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }, () => {
    if (chrome.runtime.lastError) {
      // Ignore missing content scripts (e.g. restricted pages).
    }
  });
}

function clearGeminiLiveTimeout() {
  if (!geminiLiveTimeoutTimer) return;
  clearTimeout(geminiLiveTimeoutTimer);
  geminiLiveTimeoutTimer = null;
}

function abortGeminiLiveInFlightRequest(reason = "superseded") {
  if (!geminiLiveInFlightController) return;
  try {
    geminiLiveInFlightController.abort(reason);
  } catch (_error) {
    // Ignore abort races.
  }
  geminiLiveInFlightController = null;
  geminiLiveInFlightSequence = 0;
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || !tabs.length) {
        resolve(null);
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function getTabById(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve(null);
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

function captureVisibleTabDataUrl(windowId) {
  return new Promise((resolve, reject) => {
    const options = { format: "jpeg", quality: 45 };
    chrome.tabs.captureVisibleTab(windowId, options, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Failed to capture screenshot"));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function buildGeminiLiveStartContext(preferredTabId = 0, preferredWindowId = chrome.windows.WINDOW_ID_CURRENT) {
  const tab = await getTabById(preferredTabId) || await queryActiveTab();
  const tabId = tab && tab.id ? tab.id : preferredTabId || 0;
  const windowId = tab && Number.isInteger(tab.windowId) ? tab.windowId : preferredWindowId;
  const pageUrl = tab && tab.url ? tab.url : "";
  return {
    tabId,
    windowId,
    pageUrl,
    screenshotDataUrl: "",
    includePageContext: false,
    conversationId: `tab-${tabId || 0}`
  };
}

async function pushGeminiLiveVisualContext(sessionId, context) {
  if (!sessionId || !context) return;
  if (!geminiLiveCallActive || geminiLiveCallSessionId !== sessionId) return;
  const targetWindowId = Number.isInteger(context.windowId) ? context.windowId : geminiLiveCallWindowId;
  let screenshotDataUrl = "";
  try {
    screenshotDataUrl = await captureVisibleTabDataUrl(targetWindowId);
  } catch (_error) {
    screenshotDataUrl = "";
  }
  if (!screenshotDataUrl) return;
  if (!geminiLiveCallActive || geminiLiveCallSessionId !== sessionId) return;
  sendAudioControlMessage({
    type: "aqual-gemini-live-stream-context",
    sessionId,
    includePageContext: true,
    pageUrl: "",
    conversationId: String(context.conversationId || ""),
    screenshotDataUrl
  });
}

async function requestGeminiLiveResponse(payload, signal) {
  const response = await fetch(GEMINI_LIVE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }
  if (!response.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Gemini Live request failed (${response.status})`);
  }
  return data;
}

function resetGeminiLiveScreenshotCache() {
  geminiLiveCachedScreenshotDataUrl = "";
  geminiLiveCachedScreenshotCapturedAt = 0;
  geminiLiveCachedScreenshotPageUrl = "";
}

function enqueueGeminiLiveChunk(message) {
  const sessionId = Number(message && message.sessionId ? message.sessionId : 0);
  if (!geminiLiveCallActive || !sessionId || sessionId !== geminiLiveCallSessionId) {
    return;
  }
  const sequence = Number(message.sequence || 0);
  const audioBase64 = String(message.audioBase64 || "");
  if (!audioBase64) {
    return;
  }
  geminiLiveQueue.push({
    sessionId,
    sequence,
    audioBase64,
    audioMimeType: String(message.audioMimeType || "audio/pcm;rate=24000"),
    durationMs: Number(message.durationMs || 0),
    queuedAt: Date.now()
  });
  if (geminiLiveQueue.length > GEMINI_LIVE_MAX_QUEUE_SIZE) {
    geminiLiveQueue = geminiLiveQueue.slice(-GEMINI_LIVE_MAX_QUEUE_SIZE);
  }
  if (
    geminiLiveQueueProcessing
    && geminiLiveInFlightController
    && sequence
    && geminiLiveInFlightSequence
    && sequence > geminiLiveInFlightSequence
  ) {
    abortGeminiLiveInFlightRequest("superseded_by_newer_audio_chunk");
    geminiLiveQueue = geminiLiveQueue.slice(-1);
  }
  processGeminiLiveQueue().catch((error) => {
    console.warn("[aqual-gemini-live]", JSON.stringify({
      event: "queue_error",
      error: error && error.message ? error.message : String(error)
    }));
  });
}

async function getOrRefreshGeminiLiveScreenshot(tab, pageUrl) {
  const now = Date.now();
  const shouldCapture = !geminiLiveCachedScreenshotDataUrl
    || (now - geminiLiveCachedScreenshotCapturedAt) >= GEMINI_LIVE_SCREENSHOT_REFRESH_MS
    || (pageUrl && pageUrl !== geminiLiveCachedScreenshotPageUrl);
  if (!shouldCapture) {
    return { screenshotDataUrl: "", screenshotCaptured: false };
  }
  const targetWindowId = tab && Number.isInteger(tab.windowId)
    ? tab.windowId
    : geminiLiveCallWindowId;
  const dataUrl = await captureVisibleTabDataUrl(targetWindowId);
  geminiLiveCachedScreenshotDataUrl = dataUrl;
  geminiLiveCachedScreenshotCapturedAt = now;
  geminiLiveCachedScreenshotPageUrl = pageUrl || "";
  return { screenshotDataUrl: dataUrl, screenshotCaptured: true };
}

async function processGeminiLiveChunk(chunk) {
  const tab = await getTabById(geminiLiveCallTabId) || await queryActiveTab();
  if (tab && tab.id) {
    geminiLiveCallTabId = tab.id;
    geminiLiveLastTabId = tab.id;
  }
  if (tab && Number.isInteger(tab.windowId)) {
    geminiLiveCallWindowId = tab.windowId;
  }

  const targetTabId = tab && tab.id ? tab.id : geminiLiveCallTabId;
  const pageUrl = tab && tab.url ? tab.url : (geminiLiveCachedScreenshotPageUrl || "");
  if (targetTabId && (!geminiLiveConversationId || geminiLiveConversationId === "tab-0")) {
    geminiLiveConversationId = `tab-${targetTabId}`;
  }
  const conversationId = geminiLiveConversationId || `tab-${targetTabId || 0}`;

  const screenshotMeta = await getOrRefreshGeminiLiveScreenshot(tab, pageUrl);
  const payload = {
    audioData: chunk.audioBase64,
    audioMimeType: chunk.audioMimeType,
    pageUrl,
    conversationId
  };
  if (screenshotMeta.screenshotDataUrl) {
    payload.screenshotDataUrl = screenshotMeta.screenshotDataUrl;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  geminiLiveInFlightController = controller;
  geminiLiveInFlightSequence = Number(chunk.sequence || 0);
  const timeoutTimer = setTimeout(() => {
    if (geminiLiveInFlightController === controller) {
      try {
        controller.abort("request_timeout");
      } catch (_error) {
        // Ignore abort races.
      }
    }
  }, GEMINI_LIVE_REQUEST_TIMEOUT_MS);

  let data;
  try {
    data = await requestGeminiLiveResponse(payload, controller.signal);
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === "AbortError")) {
      console.info("[aqual-gemini-live]", JSON.stringify({
        event: "chunk_response_aborted",
        sessionId: chunk.sessionId,
        sequence: chunk.sequence,
        reason: String(controller.signal.reason || "aborted"),
      }));
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    if (geminiLiveInFlightController === controller) {
      geminiLiveInFlightController = null;
      geminiLiveInFlightSequence = 0;
    }
  }
  const durationMs = Date.now() - startedAt;

  console.info("[aqual-gemini-live]", JSON.stringify({
    event: "chunk_response_ok",
    sessionId: chunk.sessionId,
    sequence: chunk.sequence,
    queued_ms: Date.now() - chunk.queuedAt,
    duration_ms: durationMs,
    chunk_duration_ms: chunk.durationMs,
    answer_chars: String(data.answer || "").length,
    transcript_chars: String(data.transcript || "").length,
    output_audio_bytes: String(data.audioBase64 || "").length,
    model: data.model || "",
    screenshot_sent: Boolean(data && data.debug && data.debug.screenshotSent),
    screenshot_hash: String((data && data.debug && data.debug.screenshotHash) || ""),
    connect_ms: Number((data && data.debug && data.debug.connectedMs) || 0),
    input_sent_ms: Number((data && data.debug && data.debug.inputSentMs) || 0),
    first_response_ms: Number((data && data.debug && data.debug.firstResponseMs) || 0)
  }));

  if (!geminiLiveCallActive || chunk.sessionId !== geminiLiveCallSessionId) {
    return;
  }

  const outputAudioBase64 = String(data.audioBase64 || "");
  const outputAudioMimeType = String(data.audioMimeType || "audio/wav");
  if (outputAudioBase64) {
    ensureOffscreenDocument().then(() => {
      sendAudioControlMessage({
        type: "aqual-gemini-live-play-audio",
        audioBase64: outputAudioBase64,
        audioMimeType: outputAudioMimeType
      });
    });
  }

  sendGeminiLiveMessageToTab(targetTabId || geminiLiveLastTabId, {
    type: "aqual-gemini-live-result",
    ok: true,
    answer: String(data.answer || ""),
    transcript: String(data.transcript || ""),
    model: String(data.model || "")
  });
}

async function processGeminiLiveQueue() {
  if (geminiLiveQueueProcessing) return;
  geminiLiveQueueProcessing = true;
  try {
    while (geminiLiveCallActive && geminiLiveQueue.length) {
      const chunk = geminiLiveQueue.shift();
      try {
        await processGeminiLiveChunk(chunk);
      } catch (error) {
        if (error && error.name === "AbortError") {
          continue;
        }
        console.warn("[aqual-gemini-live]", JSON.stringify({
          event: "chunk_response_error",
          sequence: Number(chunk && chunk.sequence ? chunk.sequence : 0),
          error: error && error.message ? error.message : String(error)
        }));
        if (geminiLiveLastTabId) {
          sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
            type: "aqual-gemini-live-status",
            status: "Gemini Live",
            detail: `Live call chunk failed: ${error && error.message ? error.message : "unknown error"}`,
            sticky: true
          });
        }
      }
    }
  } finally {
    geminiLiveQueueProcessing = false;
  }
}

function startGeminiLiveCall(sender = null) {
  if (geminiLiveCallActive) {
    return;
  }
  if (geminiLiveHoldActive) {
    stopGeminiLiveHoldSession(geminiLiveActiveHoldId || 0, sender);
  }
  const senderTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : 0;
  const senderWindowId = sender && sender.tab && Number.isInteger(sender.tab.windowId)
    ? sender.tab.windowId
    : chrome.windows.WINDOW_ID_CURRENT;
  geminiLiveCallActive = true;
  geminiLiveCallSessionId = Date.now();
  geminiLiveCallTabId = senderTabId || geminiLiveLastTabId || 0;
  geminiLiveCallWindowId = senderWindowId;
  geminiLiveConversationId = `tab-${geminiLiveCallTabId || 0}`;
  geminiLiveQueue = [];
  geminiLiveQueueProcessing = false;
  geminiLiveLastSpeechStartTurnId = 0;
  abortGeminiLiveInFlightRequest("call_start_reset");
  resetGeminiLiveScreenshotCache();
  clearGeminiLiveTimeout();
  if (geminiLiveCallTabId) {
    geminiLiveLastTabId = geminiLiveCallTabId;
  }

  console.info("[aqual-gemini-live]", JSON.stringify({
    event: "call_start",
    sessionId: geminiLiveCallSessionId,
    tabId: geminiLiveCallTabId
  }));

  sendGeminiLiveMessageToTab(geminiLiveCallTabId, {
    type: "aqual-gemini-live-status",
    status: "Gemini Live",
    detail: "Live call ON. Connecting...",
    sticky: true
  });

  ensureOffscreenDocument().then(async () => {
    const context = await buildGeminiLiveStartContext(geminiLiveCallTabId, geminiLiveCallWindowId);
    if (context.tabId) {
      geminiLiveCallTabId = context.tabId;
      geminiLiveLastTabId = context.tabId;
      geminiLiveConversationId = context.conversationId;
    }
    if (Number.isInteger(context.windowId)) {
      geminiLiveCallWindowId = context.windowId;
    }

    sendAudioControlMessage({
      type: "aqual-gemini-live-stream-start",
      sessionId: geminiLiveCallSessionId,
      pageUrl: context.pageUrl,
      conversationId: context.conversationId,
      screenshotDataUrl: context.screenshotDataUrl,
      includePageContext: Boolean(context.includePageContext)
    });

    // Capture and send screenshot context after live audio starts so listening is instant.
    pushGeminiLiveVisualContext(geminiLiveCallSessionId, context).catch((_error) => {
      // Visual context is best effort.
    });
  }).catch((error) => {
    const reason = error && error.message ? error.message : "offscreen init failed";
    stopGeminiLiveCall(`Live call stopped: ${reason}`, true);
  });
}

function stopGeminiLiveCall(reason = "Live call stopped.", notify = true) {
  const activeSessionId = geminiLiveCallSessionId;
  const targetTabId = geminiLiveCallTabId || geminiLiveLastTabId;
  geminiLiveCallActive = false;
  geminiLiveCallSessionId = 0;
  geminiLiveCallTabId = 0;
  geminiLiveConversationId = "";
  geminiLiveQueue = [];
  geminiLiveQueueProcessing = false;
  geminiLiveLastSpeechStartTurnId = 0;
  abortGeminiLiveInFlightRequest("call_stopped");
  resetGeminiLiveScreenshotCache();
  clearGeminiLiveTimeout();

  if (activeSessionId) {
    ensureOffscreenDocument().then(() => {
      sendAudioControlMessage({ type: "aqual-gemini-live-stream-stop", sessionId: activeSessionId });
      sendAudioControlMessage({ type: "aqual-gemini-live-stop-playback" });
    });
  }

  console.info("[aqual-gemini-live]", JSON.stringify({
    event: "call_stop",
    sessionId: activeSessionId,
    reason
  }));

  if (notify && targetTabId) {
    sendGeminiLiveMessageToTab(targetTabId, {
      type: "aqual-gemini-live-status",
      status: "Gemini Live",
      detail: reason,
      sticky: true
    });
  }
}

function toggleGeminiLiveCall(sender = null) {
  if (geminiLiveCallActive) {
    stopGeminiLiveCall("Live call OFF.", true);
    return;
  }
  startGeminiLiveCall(sender);
}

function startGeminiLiveHoldSession(incomingHoldId = 0, sender = null) {
  const holdId = Number(incomingHoldId) || Date.now();
  if (geminiLiveHoldActive && geminiLiveActiveHoldId === holdId) {
    return;
  }

  const senderTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : 0;
  const senderWindowId = sender && sender.tab && Number.isInteger(sender.tab.windowId)
    ? sender.tab.windowId
    : chrome.windows.WINDOW_ID_CURRENT;
  if (senderTabId) {
    geminiLiveLastTabId = senderTabId;
  }

  geminiLiveHoldActive = true;
  geminiLiveActiveHoldId = holdId;
  geminiLivePending = {
    holdId,
    tabId: senderTabId,
    windowId: senderWindowId,
    startedAt: Date.now(),
    state: "recording"
  };
  clearGeminiLiveTimeout();

  console.info("[aqual-gemini-live]", JSON.stringify({
    event: "hold_start",
    holdId,
    tabId: senderTabId
  }));

  sendGeminiLiveMessageToTab(senderTabId, {
    type: "aqual-gemini-live-status",
    status: "Gemini Live",
    detail: "Listening... release Alt+D to send.",
    sticky: false
  });

  ensureOffscreenDocument().then(() => {
    sendAudioControlMessage({ type: "aqual-gemini-live-capture-start", holdId });
  });
}

function stopGeminiLiveHoldSession(incomingHoldId = 0, sender = null) {
  const holdId = Number(incomingHoldId) || 0;
  if (!geminiLiveHoldActive) {
    return;
  }
  if (holdId && geminiLiveActiveHoldId && holdId !== geminiLiveActiveHoldId) {
    return;
  }

  const finalHoldId = geminiLiveActiveHoldId || holdId;
  const senderTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : 0;
  if (!geminiLivePending || geminiLivePending.holdId !== finalHoldId) {
    geminiLivePending = {
      holdId: finalHoldId,
      tabId: senderTabId,
      windowId: sender && sender.tab && Number.isInteger(sender.tab.windowId)
        ? sender.tab.windowId
        : chrome.windows.WINDOW_ID_CURRENT,
      startedAt: Date.now(),
      state: "recording"
    };
  }
  geminiLivePending.state = "awaiting_audio";

  geminiLiveHoldActive = false;
  geminiLiveActiveHoldId = 0;

  console.info("[aqual-gemini-live]", JSON.stringify({
    event: "hold_stop",
    holdId: finalHoldId,
    tabId: geminiLivePending.tabId || 0
  }));

  sendGeminiLiveMessageToTab(geminiLivePending.tabId || senderTabId, {
    type: "aqual-gemini-live-status",
    status: "Gemini Live",
    detail: "Processing your question...",
    sticky: true
  });

  ensureOffscreenDocument().then(() => {
    sendAudioControlMessage({ type: "aqual-gemini-live-capture-stop", holdId: finalHoldId });
  });

  clearGeminiLiveTimeout();
  geminiLiveTimeoutTimer = setTimeout(() => {
    if (!geminiLivePending || geminiLivePending.holdId !== finalHoldId) {
      return;
    }
    const timedOut = geminiLivePending;
    geminiLivePending = null;
    sendGeminiLiveMessageToTab(timedOut.tabId || 0, {
      type: "aqual-gemini-live-result",
      ok: false,
      error: "Gemini Live capture timed out. Please try again."
    });
  }, 45000);
}

async function handleGeminiLiveCapturedAudio(message) {
  const holdId = Number(message && message.holdId ? message.holdId : 0);
  if (!holdId) return;
  if (!geminiLivePending || geminiLivePending.holdId !== holdId) {
    return;
  }
  const pending = geminiLivePending;
  if (pending.state === "requesting") {
    return;
  }
  pending.state = "requesting";
  clearGeminiLiveTimeout();

  const audioData = String(message.audioBase64 || "");
  const audioMimeType = String(message.audioMimeType || "audio/pcm;rate=24000");
  if (!audioData) {
    const captureError = String(message.error || "").trim();
    geminiLivePending = null;
    sendGeminiLiveMessageToTab(pending.tabId || 0, {
      type: "aqual-gemini-live-result",
      ok: false,
      error: captureError || "No audio was captured. Please hold Alt+D and try again."
    });
    return;
  }

  try {
    const tab = await getTabById(pending.tabId) || await queryActiveTab();
    if (tab && tab.id) {
      geminiLiveLastTabId = tab.id;
    }
    const targetWindowId = tab && Number.isInteger(tab.windowId)
      ? tab.windowId
      : pending.windowId;
    const screenshotDataUrl = await captureVisibleTabDataUrl(targetWindowId);
    const pageUrl = tab && tab.url ? tab.url : "";
    const screenshotChars = String(screenshotDataUrl || "").length;

    sendGeminiLiveMessageToTab(tab && tab.id ? tab.id : pending.tabId, {
      type: "aqual-gemini-live-status",
      status: "Gemini Live",
      detail: "Sending audio + screenshot to Gemini...",
      sticky: true
    });

    const startedAt = Date.now();
    const conversationId = `tab-${tab && tab.id ? tab.id : (pending.tabId || 0)}`;
    console.info("[aqual-gemini-live]", JSON.stringify({
      event: "request_payload",
      holdId,
      page_host: (() => {
        try {
          return pageUrl ? new URL(pageUrl).host : "";
        } catch (_error) {
          return "";
        }
      })(),
      screenshot_chars: screenshotChars,
      conversation_id: conversationId
    }));
    const data = await requestGeminiLiveResponse({
      audioData,
      audioMimeType,
      screenshotDataUrl,
      pageUrl,
      conversationId
    });
    const durationMs = Date.now() - startedAt;

    console.info("[aqual-gemini-live]", JSON.stringify({
      event: "response_ok",
      holdId,
      duration_ms: durationMs,
      answer_chars: String(data.answer || "").length,
      transcript_chars: String(data.transcript || "").length,
      output_audio_bytes: String(data.audioBase64 || "").length,
      model: data.model || "",
      screenshot_sent: Boolean(data && data.debug && data.debug.screenshotSent),
      screenshot_hash: String((data && data.debug && data.debug.screenshotHash) || ""),
      connect_ms: Number((data && data.debug && data.debug.connectedMs) || 0),
      input_sent_ms: Number((data && data.debug && data.debug.inputSentMs) || 0),
      first_response_ms: Number((data && data.debug && data.debug.firstResponseMs) || 0)
    }));

    const outputAudioBase64 = String(data.audioBase64 || "");
    const outputAudioMimeType = String(data.audioMimeType || "audio/wav");
    if (outputAudioBase64) {
      ensureOffscreenDocument().then(() => {
        sendAudioControlMessage({
          type: "aqual-gemini-live-play-audio",
          audioBase64: outputAudioBase64,
          audioMimeType: outputAudioMimeType
        });
      });
    }

    sendGeminiLiveMessageToTab(tab && tab.id ? tab.id : pending.tabId, {
      type: "aqual-gemini-live-result",
      ok: true,
      answer: String(data.answer || ""),
      transcript: String(data.transcript || ""),
      model: String(data.model || "")
    });
  } catch (error) {
    console.warn("[aqual-gemini-live]", JSON.stringify({
      event: "response_error",
      holdId,
      error: error && error.message ? error.message : String(error)
    }));
    sendGeminiLiveMessageToTab(pending.tabId || 0, {
      type: "aqual-gemini-live-result",
      ok: false,
      error: error && error.message ? error.message : "Gemini Live request failed."
    });
  } finally {
    if (geminiLivePending && geminiLivePending.holdId === holdId) {
      geminiLivePending = null;
    }
  }
}

function maybeHandleVoiceCommand(text) {
  if (!text) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;

    if (isForcedOpenLearnCommand(text)) {
      maybeHandleLearnVoiceCommand("open learn", activeTab);
      return;
    }
    if (maybeHandleSkyscannerVoiceCommand(text, activeTab)) {
      return;
    }
    if (maybeHandleLearnVoiceCommand(text, activeTab)) {
      return;
    }
    if (maybeHandleGoogleSearchVoiceCommand(text)) {
      return;
    }
    if (maybeHandleVisualVoiceCommand(text)) {
      return;
    }
    if (containsOpenGoogle(text)) {
      const now = Date.now();
      if (lastVoiceCommand.key === "open google" && now - lastVoiceCommand.timestamp < 4000) {
        return;
      }
      lastVoiceCommand = { key: "open google", timestamp: now };
      chrome.tabs.create({ url: "https://google.com" });
      return;
    }

    const mapsRequest = parseMapsRequest(text);
    if (mapsRequest) {
      const originParam = mapsRequest.origin && mapsRequest.origin !== "My Location"
        ? `origin=${encodeURIComponent(mapsRequest.origin)}&`
        : "";
      const url = `https://www.google.com/maps/dir/?api=1&${originParam}destination=${encodeURIComponent(mapsRequest.destination)}&travelmode=${mapsRequest.mode}`;
      const now = Date.now();
      if (lastVoiceCommand.key === url && now - lastVoiceCommand.timestamp < 4000) {
        return;
      }
      lastVoiceCommand = { key: url, timestamp: now };
      chrome.tabs.create({ url });
      return;
    }

    const flightBooking = extractFlightBooking(text, null);
    if (flightBooking) {
      const url = buildSkyscannerUrl(flightBooking);
      if (url) {
        const now = Date.now();
        if (lastVoiceCommand.key === url && now - lastVoiceCommand.timestamp < 4000) {
          return;
        }
        lastVoiceCommand = { key: url, timestamp: now };
        chrome.tabs.create({ url });
      }
    }
  });
}

function appendHoldTranscript(text) {
  if (!text) return;
  const normalized = normalizeSpeech(text);
  if (!normalized) return;
  if (normalized.length >= holdBestLength) {
    holdTranscript = normalized;
    holdBestLength = normalized.length;
    return;
  }
  if (!holdTranscript.includes(normalized)) {
    holdTranscript = `${holdTranscript} ${normalized}`.trim();
    if (holdTranscript.length > 4000) {
      holdTranscript = holdTranscript.slice(-4000);
    }
  }
}

function clearHoldFinalizeTimer() {
  if (holdFinalizeTimer) {
    clearTimeout(holdFinalizeTimer);
    holdFinalizeTimer = null;
  }
}

function resetHoldSession() {
  holdActive = false;
  activeHoldId = 0;
  holdTranscript = "";
  holdBestLength = 0;
  holdPendingUntil = 0;
  holdLastTranscriptAt = 0;
  holdRecordStopped = false;
  clearHoldFinalizeTimer();
}

function finalizeHoldTranscript() {
  const text = holdTranscript.trim();
  resetHoldSession();
  if (!text) return;
  maybeHandleVoiceCommand(text);
}

function scheduleFinalize(delayMs = 1200) {
  clearHoldFinalizeTimer();
  holdFinalizeTimer = setTimeout(() => {
    holdFinalizeTimer = null;
    tryFinalizeHoldTranscript();
  }, delayMs);
}

function tryFinalizeHoldTranscript(force = false) {
  if (holdActive) {
    return;
  }

  const now = Date.now();
  const hasText = Boolean(holdTranscript.trim());
  const stillPending = holdPendingUntil && now <= holdPendingUntil;
  const transcriptSettled = !holdLastTranscriptAt || now - holdLastTranscriptAt >= 900;

  if (hasText && (force || holdRecordStopped || transcriptSettled)) {
    finalizeHoldTranscript();
    return;
  }

  if (stillPending) {
    scheduleFinalize(hasText ? 700 : 1200);
    return;
  }

  if (hasText) {
    finalizeHoldTranscript();
  } else {
    resetHoldSession();
  }
}

function startAudioHoldSession(incomingHoldId = 0) {
  const holdId = Number(incomingHoldId) || 0;
  const now = Date.now();
  const staleHold = holdActive && (holdRecordStopped || (now - holdStartedAt) > 20000);
  if (holdActive && holdId && holdId === activeHoldId) {
    return;
  }
  if (holdActive && !staleHold && (!holdId || holdId === activeHoldId)) {
    return;
  }
  if (staleHold) {
    holdActive = false;
    activeHoldId = 0;
    holdTranscript = "";
    holdBestLength = 0;
    holdPendingUntil = 0;
    holdLastTranscriptAt = 0;
    holdRecordStopped = false;
  }
  holdActive = true;
  activeHoldId = holdId || now;
  holdTranscript = "";
  holdStartedAt = Date.now();
  holdBestLength = 0;
  holdPendingUntil = 0;
  holdLastTranscriptAt = 0;
  holdRecordStopped = false;
  if (holdStopTimer) {
    clearTimeout(holdStopTimer);
    holdStopTimer = null;
  }
  clearHoldFinalizeTimer();
  getPreferredAudioMode((preferredMode) => {
    ensureOffscreenDocument().then(() => {
      sendAudioControlMessage({
        type: "aqual-audio-start",
        mode: preferredMode
      });
    });
  });
}

function stopAudioHoldSession(incomingHoldId = 0) {
  const holdId = Number(incomingHoldId) || 0;
  if (holdId && activeHoldId && holdId !== activeHoldId) {
    return;
  }
  holdActive = false;
  holdRecordStopped = false;
  // Keep accepting late transcripts from the same utterance after key release.
  holdPendingUntil = Date.now() + 15000;
  scheduleFinalize(3500);
  if (holdStopTimer) {
    clearTimeout(holdStopTimer);
  }
  // Delay stop slightly so realtime STT can emit trailing words/finals.
  holdStopTimer = setTimeout(() => {
    sendAudioControlMessage({ type: "aqual-audio-stop" });
    holdStopTimer = null;
  }, 1200);
}

function captureScreenshot() {
  chrome.tabs.captureVisibleTab({ format: "png" }, (screenshotUrl) => {
    if (chrome.runtime.lastError || !screenshotUrl) {
      return;
    }
    chrome.storage.local.set({ aqualScreenshot: screenshotUrl }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("pages/screenshot/screenshot.html") });
    });
  });
}

initializeRingHid().catch((error) => {
  console.warn("[aqual-ring-hid]", JSON.stringify({
    event: "init_error",
    error: error && error.message ? error.message : String(error)
  }));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes || !changes.aqualRingBackendPollingEnabled) {
    return;
  }
  backendRingPollingEnabled = changes.aqualRingBackendPollingEnabled.newValue !== false;
  if (!backendRingPollingEnabled) {
    return;
  }
  disconnectRingHid(true)
    .then(() => localSet({
      aqualRingHidEnabled: false,
      aqualRingHidStatus: "WebHID ring input disabled while backend ring monitor polling is active."
    }))
    .catch(() => {
      // Ignore best-effort WebHID detach errors.
    });
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.set({ readingModeEnabled: false });
  if (details.reason === "install") {
    chrome.storage.local.set({
      aqualRingBackendPollingEnabled: true,
      aqualRingHidEnabled: false,
      aqualRingHidDevice: null,
      aqualRingHidStatus: RING_HID_DEFAULT_STATUS
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.set({ readingModeEnabled: false });
  chrome.storage.local.set({ aqualRingBackendPollingEnabled: true });
  initializeRingHid().catch((error) => {
    console.warn("[aqual-ring-hid]", JSON.stringify({
      event: "startup_init_error",
      error: error && error.message ? error.message : String(error)
    }));
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  applySettingsToTab(activeInfo.tabId, "tab_activated");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || typeof changeInfo.url === "string") {
    readingModeStateByTab.delete(tabId);
  }
  if (changeInfo.status === "complete") {
    readingModeStateByTab.delete(tabId);
    applySettingsToTab(tabId, "tab_updated_complete");
    if (pendingLearnIntent && isLearnTabUrl((tab && tab.url) || "")) {
      const queued = pendingLearnIntent;
      pendingLearnIntent = null;
      setTimeout(() => {
        dispatchLearnIntentToTab(tabId, queued);
      }, 1100);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  readingModeStateByTab.delete(tabId);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-screenshot") {
    captureScreenshot();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs.length ? tabs[0] : null;
    if (!activeTab || typeof activeTab.id !== "number") return;
    getSettingsForUrl(activeTab.url || "", (settings) => {
      let updates = {};
      if (command === "toggle-image-veil") {
        settings.imageVeilEnabled = !settings.imageVeilEnabled;
        updates.imageVeilEnabled = settings.imageVeilEnabled;
      }

      if (command === "toggle-highlight-words") {
        settings.highlightEnabled = !settings.highlightEnabled;
        updates.highlightEnabled = settings.highlightEnabled;
      }

      if (command === "toggle-magnifier") {
        settings.magnifierEnabled = !settings.magnifierEnabled;
        updates.magnifierEnabled = settings.magnifierEnabled;
      }

      if (command === "toggle-emphasize-links") {
        settings.linkEmphasisEnabled = !settings.linkEmphasisEnabled;
        updates.linkEmphasisEnabled = settings.linkEmphasisEnabled;
      }

      if (Object.keys(updates).length > 0) {
        updateSettingsForUrl(activeTab.url || "", updates, (nextSettings) => {
          sendToTab(activeTab.id, nextSettings, {
            source: "keyboard-command",
            reason: String(command || "command_toggle")
          });
        });
      }
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "aqual-get-settings-for-url") {
    const targetUrl = String(message.url || "");
    getSettingsForUrl(targetUrl, (settings) => {
      sendResponse({ ok: true, settings });
    });
    return true;
  }
  if (message.type === "aqual-update-settings-for-url") {
    const targetUrl = String(message.url || "");
    const patch = message.patch && typeof message.patch === "object" ? message.patch : {};
    const replace = Boolean(message.replace);
    updateSettingsForUrl(targetUrl, patch, (settings, persisted) => {
      sendResponse({ ok: true, settings, persisted: Boolean(persisted) });
    }, replace);
    return true;
  }
  if (message.type === "aqual-reading-mode-state-update") {
    const tabId = sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : 0;
    if (tabId > 0) {
      readingModeStateByTab.set(tabId, Boolean(message.enabled));
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "aqual-ring-hid-connect") {
    connectRingHidDevice(message.device)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });
    return true;
  }
  if (message.type === "aqual-ring-hid-disconnect") {
    disconnectRingHid(true)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
      });
    return true;
  }
  if (message.type === "aqual-ring-backend-poll") {
    fetchRingBackendPoll(message.cursor)
      .then((data) => {
        sendResponse({ ok: true, data: data && typeof data === "object" ? data : {} });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : "Ring backend poll failed." });
      });
    return true;
  }
  if (
    message.type === "aqual-ring-backend-action"
    || message.type === "aqual-ring-backend-toggle"
    || message.type === "aqual-ring-backend-mic-toggle"
    || message.type === "aqual-ring-backend-high-contrast-toggle"
    || message.type === "aqual-ring-backend-line-guide-toggle"
    || message.type === "aqual-ring-backend-image-veil-toggle"
    || message.type === "aqual-ring-backend-reduced-crowding-toggle"
    || message.type === "aqual-ring-backend-font-color-toggle"
  ) {
    const legacyTypeToAction = {
      "aqual-ring-backend-toggle": "toggle_voice_mic",
      "aqual-ring-backend-mic-toggle": "toggle_voice_mic",
      "aqual-ring-backend-high-contrast-toggle": "toggle_high_contrast",
      "aqual-ring-backend-line-guide-toggle": "toggle_line_guide",
      "aqual-ring-backend-image-veil-toggle": "toggle_image_veil",
      "aqual-ring-backend-reduced-crowding-toggle": "toggle_reduced_crowding",
      "aqual-ring-backend-font-color-toggle": "toggle_font_color"
    };
    const actionToken = String(
      message.action
      || legacyTypeToAction[message.type]
      || ""
    ).trim().toLowerCase();
    if (!actionToken) {
      sendResponse({ ok: true, ignored: true, reason: "missing_action" });
      return false;
    }
    if (shouldIgnoreBackendRingToggle(actionToken, String(message.buttonLabel || ""))) {
      sendResponse({ ok: true, ignored: true });
      return false;
    }
    const executed = executeRingBackendAction(
      actionToken,
      String(message.source || "backend-ring-monitor"),
      String(message.buttonLabel || ""),
      sender
    );
    if (!executed) {
      sendResponse({ ok: true, ignored: true, reason: "unsupported_action", action: actionToken });
      return false;
    }
    sendResponse({ ok: true, action: actionToken });
    return false;
  }
  if (message.type === "aqual-audio-mode") {
    const mode = normalizeAudioMode(message.mode);
    liveAudioMode = mode;
    chrome.storage.local.set({ aqualAudioMode: mode }, () => {
      chrome.storage.sync.set({ aqualAudioMode: mode });
    });
  }
  if (message.type === "aqual-audio-hold") {
    if (message.action === "start") {
      if (geminiLiveCallActive) {
        stopGeminiLiveCall("Live call OFF.", true);
      }
      startAudioHoldSession(message.holdId);
    }
    if (message.action === "stop") {
      stopAudioHoldSession(message.holdId);
    }
  }
  if (message.type === "aqual-gemini-live-toggle") {
    const now = Date.now();
    if (now - geminiLiveLastToggleAt < GEMINI_LIVE_TOGGLE_DEBOUNCE_MS) {
      return false;
    }
    geminiLiveLastToggleAt = now;
    toggleGeminiLiveCall(sender);
    return false;
  }
  if (message.type === "aqual-gemini-live-hold") {
    // Legacy hold flow (kept for compatibility).
    if (message.action === "start") {
      startGeminiLiveHoldSession(message.holdId, sender);
    }
    if (message.action === "stop") {
      stopGeminiLiveHoldSession(message.holdId, sender);
    }
  }
  if (message.type === "aqual-audio-transcript") {
    if (message.text) {
      chrome.storage.local.set({ aqualAudioTranscript: message.text });
    }
    const now = Date.now();
    if (holdActive || (holdPendingUntil && now <= holdPendingUntil)) {
      appendHoldTranscript(message.text);
      holdLastTranscriptAt = now;
      scheduleFinalize(holdRecordStopped ? 800 : 1400);
    }
  }
  if (message.type === "aqual-audio-state") {
    chrome.storage.local.set({ aqualAudioRecording: Boolean(message.recording) });
    holdRecordStopped = !message.recording;
    if (!message.recording && (holdPendingUntil || holdTranscript.trim())) {
      // Stream ended: allow a final brief grace window then execute.
      scheduleFinalize(700);
    }
  }
  if (message.type === "aqual-gemini-live-audio") {
    handleGeminiLiveCapturedAudio(message).catch((error) => {
      console.warn("[aqual-gemini-live]", JSON.stringify({
        event: "audio_handle_error",
        error: error && error.message ? error.message : String(error)
      }));
    });
  }
  if (message.type === "aqual-gemini-live-stream-chunk") {
    // Legacy event type from old pseudo-live path. Ignored after websocket revamp.
    return;
  }
  if (message.type === "aqual-gemini-live-stream-turn-result") {
    const sessionId = Number(message.sessionId || 0);
    if (!geminiLiveCallActive || !sessionId || sessionId !== geminiLiveCallSessionId) {
      return;
    }
    const targetTabId = geminiLiveCallTabId || geminiLiveLastTabId;
    if (targetTabId) {
      sendGeminiLiveMessageToTab(targetTabId, {
        type: "aqual-gemini-live-result",
        ok: true,
        answer: String(message.answer || ""),
        transcript: String(message.transcript || ""),
        model: String(message.model || "")
      });
    }
    return;
  }
  if (message.type === "aqual-gemini-live-stream-speech-start") {
    const sessionId = Number(message.sessionId || 0);
    if (!geminiLiveCallActive || !sessionId || sessionId !== geminiLiveCallSessionId) {
      return;
    }
    const turnId = Number(message.turnId || 0);
    if (turnId && turnId === geminiLiveLastSpeechStartTurnId) {
      return;
    }
    if (turnId) {
      geminiLiveLastSpeechStartTurnId = turnId;
    }

    Promise.resolve().then(async () => {
      const context = await buildGeminiLiveStartContext(geminiLiveCallTabId, geminiLiveCallWindowId);
      if (context.tabId) {
        geminiLiveCallTabId = context.tabId;
        geminiLiveLastTabId = context.tabId;
      }
      if (Number.isInteger(context.windowId)) {
        geminiLiveCallWindowId = context.windowId;
      }
      if (!geminiLiveConversationId || geminiLiveConversationId === "tab-0") {
        geminiLiveConversationId = context.conversationId || `tab-${geminiLiveCallTabId || 0}`;
      }

      await pushGeminiLiveVisualContext(sessionId, {
        ...context,
        conversationId: geminiLiveConversationId || context.conversationId || `tab-${geminiLiveCallTabId || 0}`
      });
    }).catch((error) => {
      console.warn("[aqual-gemini-live]", JSON.stringify({
        event: "speech_start_context_error",
        error: error && error.message ? error.message : String(error)
      }));
    });
    return;
  }
  if (message.type === "aqual-gemini-live-stream-input-transcript") {
    const sessionId = Number(message.sessionId || 0);
    if (!geminiLiveCallActive || !sessionId || sessionId !== geminiLiveCallSessionId) {
      return;
    }
    if (geminiLiveLastTabId) {
      const transcriptText = String(message.text || "").trim();
      if (transcriptText) {
        sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
          type: "aqual-gemini-live-status",
          status: "Gemini Live",
          detail: `You: ${transcriptText}`,
          sticky: true
        });
      }
    }
    return;
  }
  if (message.type === "aqual-gemini-live-stream-state") {
    const state = String(message.state || "");
    const errorText = String(message.error || "");
    console.info("[aqual-gemini-live]", JSON.stringify({
      event: "stream_state",
      sessionId: Number(message.sessionId || 0),
      state,
      error: errorText
    }));
    if (state === "error") {
      stopGeminiLiveCall(`Live call stopped: ${errorText || "stream error"}`, true);
    }
    if (state === "connecting" && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: "Connecting to Gemini Live...",
        sticky: true
      });
    }
    if (state === "reconnecting" && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: "Reconnecting to Gemini Live...",
        sticky: true
      });
    }
    if ((state === "ready" || state === "listening") && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: "Live call ON. Listening...",
        sticky: true
      });
    }
    if (state === "responding" && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: "Gemini is responding...",
        sticky: true
      });
    }
    if (state === "stopped" && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: "Live call OFF.",
        sticky: true
      });
    }
  }
  if (message.type === "aqual-gemini-live-capture-state") {
    console.info("[aqual-gemini-live]", JSON.stringify({
      event: "capture_state",
      holdId: Number(message.holdId || 0),
      state: String(message.state || ""),
      error: String(message.error || "")
    }));
  }
  if (message.type === "aqual-gemini-live-playback-state") {
    const state = String(message.state || "");
    const errorText = String(message.error || "");
    console.info("[aqual-gemini-live]", JSON.stringify({
      event: "playback_state",
      state,
      error: errorText
    }));
    if (state === "interrupted") {
      return;
    }
    if (state === "error" && geminiLiveLastTabId) {
      sendGeminiLiveMessageToTab(geminiLiveLastTabId, {
        type: "aqual-gemini-live-status",
        status: "Gemini Live",
        detail: `Voice playback failed: ${errorText || "unknown error"}`,
        sticky: true
      });
    }
  }
  if (message.type === "aqual-screenshot") {
    captureScreenshot();
  }
});
