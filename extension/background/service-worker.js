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

function getSettings(callback) {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    callback({ ...DEFAULTS, ...(stored || {}) });
  });
}

function sendToTab(tabId, settings) {
  chrome.tabs.sendMessage(tabId, { type: "aqual-apply", settings }, () => {
    if (chrome.runtime.lastError) {
      return;
    }
  });
}

function applySettingsToTab(tabId) {
  getSettings((settings) => sendToTab(tabId, settings));
}

let liveAudioMode = null;
let lastGoogleSearchQuery = "";

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
  { key: "drawingEnabled", phrases: ["drawing mode", "draw on page", "annotation mode", "draw mode"] },
  { key: "magnifierEnabled", phrases: ["magnifier", "zoom lens", "image magnifier", "magnification"] },
  { key: "linkEmphasisEnabled", phrases: ["link emphasis", "emphasize links", "emphasise links", "underline links"] },
  { key: "cursorEnabled", phrases: ["cursor", "pointer", "mouse pointer", "mouse cursor"] },
  { key: "highContrastEnabled", phrases: ["high contrast mode", "high contrast", "contrast mode", "high con", "high con trust", "con trust mode", "contrast"] },
  { key: "nightModeEnabled", phrases: ["night mode", "reading mode", "low vision mode", "dark reading mode"] },
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

function mentionNightMode(text) {
  return includesAny(text, ["night mode", "reading mode", "low vision mode", "dark reading"]);
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

function applyVisualVoiceResult(result, settings) {
  const updates = result.updates || {};
  const hasUpdates = Object.keys(updates).length > 0;

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

  const execute = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs.length ? tabs[0] : null;
      if (activeTab && hasUpdates) {
        const nextSettings = { ...settings, ...updates };
        sendToTab(activeTab.id, nextSettings);
      }
      if (activeTab) {
        performTabActions(activeTab.id);
      }
      if (result.actions.captureScreenshot) {
        captureScreenshot();
      }
    });
  };

  if (hasUpdates) {
    chrome.storage.sync.set(updates, execute);
  } else {
    execute();
  }
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

  getSettings((settings) => {
    const command = parseVisualVoiceCommand(normalized, settings);
    if (!command.handled) return;
    applyVisualVoiceResult(command, settings);
  });
  return true;
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

function getCountryCode(country) {
  const lower = country.toLowerCase().trim();
  if (SKYSCANNER_COUNTRY_CODES[lower]) {
    return SKYSCANNER_COUNTRY_CODES[lower];
  }
  // Use first 3 letters as fallback
  return lower.replace(/[^a-z]/g, "").slice(0, 3);
}

function parseDate(dateStr) {
  const lower = dateStr.toLowerCase().trim();
  let day = null;

  const numericMatch = lower.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  if (numericMatch) {
    let first = Number(numericMatch[1]);
    let second = Number(numericMatch[2]);
    let year = numericMatch[3] ? Number(numericMatch[3]) : 26;
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

  // First try to extract day number (handles 1st, 2nd, 3rd, 21st, 22nd, 23rd, etc.)
  const dayMatch = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?/i);
  if (dayMatch) {
    day = dayMatch[1];
  } else {
    // Try ordinal words (first, second, fifth, etc.)
    for (const [word, num] of Object.entries(ORDINAL_WORDS)) {
      if (lower.includes(word)) {
        day = num.toString();
        break;
      }
    }
  }

  if (!day) return null;
  day = day.padStart(2, "0");

  // Extract month (month-first or day-first)
  let month = null;
  const monthFirst = lower.match(new RegExp(`\\b(${Object.keys(MONTH_MAP).join("|")})\\b`));
  if (monthFirst) {
    month = MONTH_MAP[monthFirst[1]];
  } else {
    for (const [name, num] of Object.entries(MONTH_MAP)) {
      if (lower.includes(name)) {
        month = num;
        break;
      }
    }
  }
  if (!month) return null;

  // Use 2026 as default year
  return `26${month}${day}`;
}

function extractDates(text) {
  const matches = [];
  const monthNames = Object.keys(MONTH_MAP).join("|");
  const ordinalWords = Object.keys(ORDINAL_WORDS).join("|");
  const patterns = [
    new RegExp(`\\b(${ordinalWords}|\\d{1,2}(?:st|nd|rd|th)?)\\s*(?:of\\s+)?(${monthNames})\\b`, "gi"),
    new RegExp(`\\b(${monthNames})\\s*(\\d{1,2}(?:st|nd|rd|th)?)\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}[\\/\\-.]\\d{1,2}(?:[\\/\\-.]\\d{2,4})?\\b`, "g")
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ raw: match[0], index: match.index });
    }
  });

  matches.sort((a, b) => a.index - b.index);
  const results = [];
  for (const candidate of matches) {
    const parsed = parseDate(candidate.raw);
    if (parsed) {
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
  // Check for flight intent with tolerant phrasing
  if (!isFlightIntent(text)) return null;

  let origin = null;
  let destination = null;
  let departDate = null;
  let returnDate = null;

  const monthNames = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
  const ordinalWords = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[- ]?first|twenty[- ]?second|twenty[- ]?third|twenty[- ]?fourth|twenty[- ]?fifth|twenty[- ]?sixth|twenty[- ]?seventh|twenty[- ]?eighth|twenty[- ]?ninth|thirtieth|thirty[- ]?first";
  const dayPattern = `(?:\\d{1,2}(?:st|nd|rd|th)?|${ordinalWords})`;
  const datePattern = new RegExp(`from\\s+(?:the\\s+)?(${dayPattern}\\s+(?:of\\s+)?(?:${monthNames}))\\s+to\\s+(?:the\\s+)?(${dayPattern}\\s+(?:of\\s+)?(?:${monthNames}))`, "i");
  const dateMatch = text.match(datePattern);

  if (dateMatch) {
    departDate = dateMatch[1].trim();
    returnDate = dateMatch[2].trim();

    const beforeDates = text.slice(0, dateMatch.index).trim();

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
  } else {
    const fromToPattern = /from\s+(.+?)\s+to\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\.|$)/i;
    const match = text.match(fromToPattern);

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
      const toFromMatch = text.match(toFromPattern);

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
    const locations = findLocations(text);
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

  if (!destination || !departDate || !returnDate) {
    const dateCandidates = extractDates(text);
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

  return `https://www.skyscanner.net/transport/flights/${originCode}/${destCode}/${departDate}/${returnDate}/?adultsv2=1&cabinclass=economy&childrenv2=&ref=home&rtn=1&preferdirects=false&outboundaltsenabled=false&inboundaltsenabled=false`;
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
      reasons: ["USER_MEDIA"],
      justification: "Capture microphone audio for live transcription."
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

function maybeHandleVoiceCommand(text) {
  if (!text) return;
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

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set({ ...DEFAULTS });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  applySettingsToTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    applySettingsToTab(tabId);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "capture-screenshot") {
    captureScreenshot();
    return;
  }

  getSettings((settings) => {
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
      chrome.storage.sync.set(updates, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs || !tabs.length) return;
          sendToTab(tabs[0].id, settings);
        });
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "aqual-audio-mode") {
    const mode = normalizeAudioMode(message.mode);
    liveAudioMode = mode;
    chrome.storage.local.set({ aqualAudioMode: mode }, () => {
      chrome.storage.sync.set({ aqualAudioMode: mode });
    });
  }
  if (message.type === "aqual-audio-hold") {
    if (message.action === "start") {
      startAudioHoldSession(message.holdId);
    }
    if (message.action === "stop") {
      stopAudioHoldSession(message.holdId);
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
  if (message.type === "aqual-screenshot") {
    captureScreenshot();
  }
});
