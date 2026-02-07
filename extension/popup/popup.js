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

let state = { ...DEFAULTS };
let scrollPersistTimer = null;
let activeTab = "visual";

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
  currentMode = mode;
  document.querySelectorAll(".mode-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  chrome.storage.sync.set({ aqualAudioMode: mode });
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
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "aqual-apply",
      settings: state
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
      const openState = {};
      document.querySelectorAll("details.group").forEach((item) => {
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

  const themeToggle = byId("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "light" ? "dark" : "light");
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
      const sections = Array.from(document.querySelectorAll("details.group"));
      const allOpen = sections.length > 0 && sections.every((section) => section.open);
      setAllSections(!allOpen);
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
        status.textContent = "Opening bionic viewer...";
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

  byId("highContrastEnabled").addEventListener("change", (e) => {
    state.highContrastEnabled = e.target.checked;
    setToggleText("highContrastEnabledState", state.highContrastEnabled);
    persistSettings({ highContrastEnabled: state.highContrastEnabled });
    pushStateToActive();
  });

  byId("adaptiveContrastEnabled").addEventListener("change", (e) => {
    state.adaptiveContrastEnabled = e.target.checked;
    setToggleText("adaptiveContrastEnabledState", state.adaptiveContrastEnabled);
    persistSettings({ adaptiveContrastEnabled: state.adaptiveContrastEnabled });
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
  state = { ...DEFAULTS, ...settings };

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
  byId("reducedCrowdingEnabled").checked = state.reducedCrowdingEnabled;
  byId("drawingEnabled").checked = state.drawingEnabled;
  byId("highContrastEnabled").checked = state.highContrastEnabled;
  byId("adaptiveContrastEnabled").checked = state.adaptiveContrastEnabled;
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
  setToggleText("reducedCrowdingEnabledState", state.reducedCrowdingEnabled);
  setToggleText("drawingEnabledState", state.drawingEnabled);
  setToggleText("highContrastEnabledState", state.highContrastEnabled);
  setToggleText("adaptiveContrastEnabledState", state.adaptiveContrastEnabled);
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
  const sections = Array.from(document.querySelectorAll("details.group"));
  const allOpen = sections.length > 0 && sections.every((section) => section.open);
  button.textContent = allOpen ? "Collapse all" : "Expand all";
}

function setAllSections(open) {
  const sections = Array.from(document.querySelectorAll("details.group"));
  const state = {};
  sections.forEach((section) => {
    section.open = open;
    if (section.id) {
      state[section.id] = open;
    }
  });
  chrome.storage.sync.set({ aqualUiSections: state });
  updateToggleSectionsLabel();
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    hydrateUI(stored || {});
    bindEvents();
    restoreUiState();
    resizeAudioCanvas();
    refreshMicPermissionState();
  });

  chrome.storage.sync.get({ aqualAudioMode: "elevenlabs", aqualTheme: "dark" }, (stored) => {
    applyModeSelection(stored.aqualAudioMode || "elevenlabs");
    applyTheme(stored.aqualTheme || "dark");
  });

  chrome.storage.local.get({ aqualAudioRecording: false, aqualAudioTranscript: "" }, (stored) => {
    setRecordingState(Boolean(stored.aqualAudioRecording));
    if (stored.aqualAudioTranscript) {
      setTranscriptText(stored.aqualAudioTranscript);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.aqualAudioRecording) {
        setRecordingState(Boolean(changes.aqualAudioRecording.newValue));
      }
      if (changes.aqualAudioTranscript && changes.aqualAudioTranscript.newValue) {
        setTranscriptText(changes.aqualAudioTranscript.newValue);
      }
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
