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

let lastVoiceCommand = { key: "", timestamp: 0 };
let holdActive = false;
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
  "kenya": "ke",
  "united kingdom": "uk",
  "uk": "uk",
  "london": "lon",
  "manchester": "man",
  "new york": "nyc",
  "usa": "us",
  "united states": "us",
  "united states of america": "us",
  "japan": "jp",
  "tokyo": "tyo",
  "france": "fr",
  "paris": "par",
  "germany": "de",
  "spain": "es",
  "italy": "it",
  "australia": "au",
  "canada": "ca",
  "china": "cn",
  "india": "in",
  "brazil": "br",
  "mexico": "mx",
  "nairobi": "nbo"
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

function extractFlightBooking(text, selectedCountry) {
  const lower = text.toLowerCase();

  // Check for "book a flight" or "book flight"
  if (!(lower.includes("flight") || lower.includes("flights") || lower.includes("fly"))) return null;

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

function maybeHandleVoiceCommand(text) {
  if (!text) return;
  if (containsOpenGoogle(text)) {
    const now = Date.now();
    if (lastVoiceCommand.key === "open google" && now - lastVoiceCommand.timestamp < 4000) {
      return;
    }
    lastVoiceCommand = { key: "open google", timestamp: now };
    chrome.tabs.create({ url: "https://google.com" });
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
  if (message.type === "aqual-audio-hold") {
    if (message.action === "start") {
      holdActive = true;
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
      chrome.storage.sync.get({ aqualAudioMode: "elevenlabs" }, (syncStored) => {
        ensureOffscreenDocument().then(() => {
          chrome.runtime.sendMessage({
            type: "aqual-audio-start",
            mode: syncStored.aqualAudioMode || "elevenlabs"
          });
        });
      });
    }
    if (message.action === "stop") {
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
        chrome.runtime.sendMessage({ type: "aqual-audio-stop" });
        holdStopTimer = null;
      }, 1200);
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
    chrome.tabs.captureVisibleTab({ format: "png" }, (screenshotUrl) => {
      if (chrome.runtime.lastError || !screenshotUrl) {
        return;
      }
      chrome.storage.local.set({ aqualScreenshot: screenshotUrl }, () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("pages/screenshot/screenshot.html") });
      });
    });
  }
});
