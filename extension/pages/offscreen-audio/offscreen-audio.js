const AUDIO_SERVER_HOST = "localhost:8000";

let audioWs = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let analyser = null;
let recording = false;
let currentMode = "elevenlabs";
let fullTranscript = "";
let recordingSession = 0;
let geminiLiveCaptureActive = false;
let geminiLiveCaptureHoldId = 0;
let geminiLiveAudioChunks = [];
let geminiLiveAudioBytes = 0;
let geminiLivePlaybackAudio = null;
let geminiLiveStreamActive = false;
let geminiLiveStreamSessionId = 0;
let geminiLiveLastPlayedTurnId = 0;
let geminiLiveStreamSocketReady = false;
let geminiLiveStreamContextPayload = null;
let geminiLiveStreamSocketReconnectTimer = null;
let geminiLiveStreamSocketReconnectAttempts = 0;
let geminiLiveStreamStopping = false;
let geminiLiveStreamPlaybackContext = null;
let geminiLiveStreamPlaybackNextTime = 0;
let geminiLiveStreamPlaybackStarted = false;
let geminiLiveStreamPlaybackSources = new Set();
let geminiLiveStreamPlaybackTurnId = 0;

const GEMINI_LIVE_STREAM_INPUT_SAMPLE_RATE = 16000;
const GEMINI_LIVE_OUTPUT_SAMPLE_RATE = 24000;
const GEMINI_LIVE_STREAM_PROCESSOR_FRAMES = 256;
const GEMINI_LIVE_SOCKET_RECONNECT_BASE_MS = 250;
const GEMINI_LIVE_SOCKET_RECONNECT_MAX_MS = 1600;
const GEMINI_LIVE_SOCKET_MAX_RETRIES = 20;

function mergeAudioChunks(chunks, totalBytes) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    merged.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return merged;
}

function normalizeAudioMode(mode) {
  const token = String(mode || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (token === "local" || token === "localwhisper" || token === "whisper") {
    return "local";
  }
  if (token === "elevenlabs" || token === "elevenlab" || token === "eleven" || token === "11labs") {
    return "elevenlabs";
  }
  return "local";
}

function setRecording(value) {
  recording = value;
  chrome.runtime.sendMessage({ type: "aqual-audio-state", recording: value });
}

function isActiveSession(sessionId, ws) {
  return recording && recordingSession === sessionId && audioWs === ws;
}

function abortSession(sessionId, transcriptText) {
  if (recordingSession !== sessionId) return;
  recordingSession += 1;
  cleanupAudioSession();
  setRecording(false);
  if (transcriptText) {
    emitTranscript(transcriptText);
  }
}

function emitTranscript(text) {
  chrome.runtime.sendMessage({ type: "aqual-audio-transcript", text });
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

function base64ToUint8Array(base64) {
  const clean = String(base64 || "").trim();
  if (!clean) return new Uint8Array(0);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parsePcmSampleRateFromMime(mimeType, fallback = GEMINI_LIVE_OUTPUT_SAMPLE_RATE) {
  const token = String(mimeType || "").toLowerCase();
  const match = token.match(/rate\s*=\s*(\d+)/);
  if (!match) return fallback;
  const parsed = Number(match[1] || 0);
  if (!Number.isFinite(parsed) || parsed < 8000 || parsed > 96000) return fallback;
  return Math.round(parsed);
}

function stopGeminiLiveStreamPlaybackQueue() {
  for (const source of geminiLiveStreamPlaybackSources) {
    try {
      source.stop(0);
    } catch (_error) {
      // Ignore stop races.
    }
    try {
      source.disconnect();
    } catch (_error) {
      // Ignore disconnect races.
    }
  }
  geminiLiveStreamPlaybackSources.clear();
  geminiLiveStreamPlaybackNextTime = 0;
  geminiLiveStreamPlaybackStarted = false;
  geminiLiveStreamPlaybackTurnId = 0;
}

function enqueueGeminiLiveOutputAudioChunk(
  audioBase64,
  audioMimeType = "audio/pcm;rate=24000",
  turnIdRaw = 0
) {
  const turnId = Number(turnIdRaw) || 0;
  if (turnId && geminiLiveStreamPlaybackTurnId && turnId !== geminiLiveStreamPlaybackTurnId) {
    // Keep only one active spoken response in live mode.
    stopGeminiLivePlayback();
  }
  if (turnId) {
    geminiLiveStreamPlaybackTurnId = turnId;
  }

  const bytes = base64ToUint8Array(audioBase64);
  if (bytes.byteLength < 2) {
    return;
  }

  const sampleRate = parsePcmSampleRateFromMime(audioMimeType, GEMINI_LIVE_OUTPUT_SAMPLE_RATE);
  let playbackContext = geminiLiveStreamPlaybackContext;
  if (!playbackContext || playbackContext.state === "closed") {
    playbackContext = new AudioContext({ sampleRate, latencyHint: "interactive" });
    geminiLiveStreamPlaybackContext = playbackContext;
    geminiLiveStreamPlaybackNextTime = 0;
    geminiLiveStreamPlaybackStarted = false;
  }

  if (playbackContext.state === "suspended") {
    playbackContext.resume().catch(() => {
      // Resume may fail transiently; next chunk will retry.
    });
  }

  const frameCount = Math.floor(bytes.byteLength / 2);
  if (frameCount <= 0) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, frameCount * 2);
  const buffer = playbackContext.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    const value = view.getInt16(i * 2, true);
    channel[i] = value / 32768;
  }

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);

  const now = playbackContext.currentTime;
  // Keep chunk playback strictly sequential to prevent overlapping voices.
  const startAt = Math.max(now + 0.005, geminiLiveStreamPlaybackNextTime || (now + 0.005));
  geminiLiveStreamPlaybackNextTime = startAt + buffer.duration;
  geminiLiveStreamPlaybackSources.add(source);
  source.onended = () => {
    geminiLiveStreamPlaybackSources.delete(source);
    if (!geminiLiveStreamPlaybackSources.size) {
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-playback-state",
        state: "ended"
      });
    }
  };

  try {
    source.start(startAt);
    if (!geminiLiveStreamPlaybackStarted) {
      geminiLiveStreamPlaybackStarted = true;
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-playback-state",
        state: "playing"
      });
    }
  } catch (_error) {
    geminiLiveStreamPlaybackSources.delete(source);
  }
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

function emitGeminiLiveStreamState(state, error = "", sessionIdOverride = null) {
  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-stream-state",
    sessionId: Number(sessionIdOverride || geminiLiveStreamSessionId || 0),
    state,
    error
  });
}

function stopGeminiLivePlayback() {
  stopGeminiLiveStreamPlaybackQueue();
  if (!geminiLivePlaybackAudio) return;
  try {
    geminiLivePlaybackAudio.pause();
    geminiLivePlaybackAudio.currentTime = 0;
  } catch (_error) {
    // Ignore cleanup issues.
  }
  geminiLivePlaybackAudio = null;
}

async function playGeminiLiveAudio(payload) {
  const audioBase64 = String(payload && payload.audioBase64 ? payload.audioBase64 : "").trim();
  if (!audioBase64) {
    chrome.runtime.sendMessage({
      type: "aqual-gemini-live-playback-state",
      state: "error",
      error: "No Gemini Live audio payload received."
    });
    return;
  }
  const audioMimeType = String(payload && payload.audioMimeType ? payload.audioMimeType : "audio/wav").trim() || "audio/wav";

  stopGeminiLivePlayback();
  try {
    const audio = new Audio(`data:${audioMimeType};base64,${audioBase64}`);
    audio.preload = "auto";
    geminiLivePlaybackAudio = audio;

    audio.onended = () => {
      if (geminiLivePlaybackAudio === audio) {
        geminiLivePlaybackAudio = null;
      }
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-playback-state",
        state: "ended"
      });
    };
    audio.onerror = () => {
      if (geminiLivePlaybackAudio === audio) {
        geminiLivePlaybackAudio = null;
      }
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-playback-state",
        state: "error",
        error: "Failed to play Gemini Live audio response."
      });
    };

    await audio.play();
    chrome.runtime.sendMessage({
      type: "aqual-gemini-live-playback-state",
      state: "playing"
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const lower = String(message || "").toLowerCase();
    if (lower.includes("interrupted by a call to pause") || lower.includes("interrupted by a new load request")) {
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-playback-state",
        state: "interrupted"
      });
      return;
    }
    stopGeminiLivePlayback();
    chrome.runtime.sendMessage({
      type: "aqual-gemini-live-playback-state",
      state: "error",
      error: message
    });
  }
}

function clearGeminiLiveSocketReconnectTimer() {
  if (!geminiLiveStreamSocketReconnectTimer) return;
  clearTimeout(geminiLiveStreamSocketReconnectTimer);
  geminiLiveStreamSocketReconnectTimer = null;
}

function normalizeGeminiLiveContext(context) {
  const source = context && typeof context === "object" ? context : {};
  const includePageContext = Boolean(source.includePageContext);
  return {
    includePageContext,
    conversationId: String(source.conversationId || ""),
    pageUrl: includePageContext ? String(source.pageUrl || "") : "",
    screenshotDataUrl: includePageContext ? String(source.screenshotDataUrl || "") : ""
  };
}

function sendGeminiLiveContext(ws, context) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const normalized = normalizeGeminiLiveContext(context);
  const payload = {
    type: "context",
    conversationId: normalized.conversationId
  };
  if (normalized.includePageContext) {
    payload.pageUrl = normalized.pageUrl;
    payload.screenshotDataUrl = normalized.screenshotDataUrl;
  }
  ws.send(JSON.stringify(payload));
}

function updateGeminiLiveStreamContext(sessionIdRaw, contextPatch = {}) {
  const sessionId = Number(sessionIdRaw) || 0;
  if (!geminiLiveStreamActive || !geminiLiveStreamSessionId) return;
  if (sessionId && geminiLiveStreamSessionId !== sessionId) return;
  geminiLiveStreamContextPayload = normalizeGeminiLiveContext({
    ...(geminiLiveStreamContextPayload || {}),
    ...(contextPatch || {})
  });
  const ws = audioWs;
  if (ws && ws.readyState === WebSocket.OPEN && geminiLiveStreamSocketReady) {
    sendGeminiLiveContext(ws, geminiLiveStreamContextPayload);
  }
}

function scheduleGeminiLiveSocketReconnect(sessionId, detail = "") {
  if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || geminiLiveStreamStopping) {
    return;
  }
  if (geminiLiveStreamSocketReconnectTimer) {
    return;
  }
  geminiLiveStreamSocketReconnectAttempts += 1;
  if (geminiLiveStreamSocketReconnectAttempts > GEMINI_LIVE_SOCKET_MAX_RETRIES) {
    emitGeminiLiveStreamState(
      "error",
      detail || "Gemini Live disconnected and reconnect limit was reached.",
      sessionId
    );
    return;
  }
  const delay = Math.min(
    GEMINI_LIVE_SOCKET_RECONNECT_BASE_MS * (2 ** Math.max(0, geminiLiveStreamSocketReconnectAttempts - 1)),
    GEMINI_LIVE_SOCKET_RECONNECT_MAX_MS
  );
  stopGeminiLiveStreamPlaybackQueue();
  emitGeminiLiveStreamState("reconnecting", detail, sessionId);
  geminiLiveStreamSocketReconnectTimer = setTimeout(() => {
    geminiLiveStreamSocketReconnectTimer = null;
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || geminiLiveStreamStopping) {
      return;
    }
    openGeminiLiveSocket(sessionId, geminiLiveStreamContextPayload);
  }, delay);
}

function openGeminiLiveSocket(sessionId, contextPayload) {
  clearGeminiLiveSocketReconnectTimer();
  geminiLiveStreamSocketReady = false;
  geminiLiveStreamContextPayload = normalizeGeminiLiveContext(contextPayload);
  if (audioWs) {
    const previousWs = audioWs;
    audioWs = null;
    previousWs.onopen = null;
    previousWs.onmessage = null;
    previousWs.onerror = null;
    previousWs.onclose = null;
    try {
      if (
        previousWs.readyState === WebSocket.OPEN
        || previousWs.readyState === WebSocket.CONNECTING
      ) {
        previousWs.close(1000, "replace_socket");
      }
    } catch (_error) {
      // Ignore close races.
    }
  }
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/gemini-live`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  audioWs = ws;

  ws.onopen = () => {
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || audioWs !== ws) return;
    geminiLiveStreamSocketReconnectAttempts = 0;
    geminiLiveStreamSocketReady = true;
    sendGeminiLiveContext(ws, geminiLiveStreamContextPayload);
    emitGeminiLiveStreamState("listening");
  };

  ws.onmessage = (event) => {
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || audioWs !== ws) return;
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (_error) {
      return;
    }
    const eventType = String(payload && payload.type ? payload.type : "").trim();
    if (!eventType) {
      return;
    }

    if (eventType === "status") {
      const state = String(payload.state || "").trim();
      if (state) {
        emitGeminiLiveStreamState(state);
      }
      return;
    }

    if (eventType === "input_transcript") {
      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-stream-input-transcript",
        sessionId,
        text: String(payload.text || "")
      });
      return;
    }

    if (eventType === "output_audio_chunk") {
      enqueueGeminiLiveOutputAudioChunk(
        String(payload.audioBase64 || ""),
        String(payload.audioMimeType || "audio/pcm;rate=24000"),
        Number(payload.turnId || 0)
      );
      return;
    }

    if (eventType === "turn_result") {
      const turnId = Number(payload.turnId || 0);
      if (turnId && turnId <= geminiLiveLastPlayedTurnId) {
        return;
      }
      if (turnId) {
        geminiLiveLastPlayedTurnId = turnId;
        geminiLiveStreamPlaybackTurnId = turnId;
      }

      chrome.runtime.sendMessage({
        type: "aqual-gemini-live-stream-turn-result",
        sessionId,
        turnId,
        answer: String(payload.answer || ""),
        transcript: String(payload.transcript || ""),
        model: String(payload.model || "")
      });
      return;
    }

    if (eventType === "error") {
      const errorText = String(payload.error || "Gemini Live websocket error");
      emitGeminiLiveStreamState("error", errorText, sessionId);
    }
  };

  ws.onclose = (event) => {
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || audioWs !== ws) {
      return;
    }
    audioWs = null;
    geminiLiveStreamSocketReady = false;
    const closeCode = Number(event && event.code ? event.code : 0);
    const closeReason = String(event && event.reason ? event.reason : "");
    const detail = closeReason
      ? `Gemini Live closed (${closeCode}): ${closeReason}`
      : `Gemini Live closed (${closeCode || "unknown"}).`;
    if (geminiLiveStreamStopping) {
      return;
    }
    scheduleGeminiLiveSocketReconnect(sessionId, detail);
  };

  ws.onerror = () => {
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || audioWs !== ws) return;
    geminiLiveStreamSocketReady = false;
  };
}

async function startGeminiLiveStream(sessionIdRaw, contextPayload = null) {
  const sessionId = Number(sessionIdRaw) || Date.now();
  if (geminiLiveStreamActive && geminiLiveStreamSessionId === sessionId) {
    return;
  }
  stopGeminiLivePlayback();

  if (recording) {
    stopRecording();
  }
  if (geminiLiveCaptureActive) {
    stopGeminiLiveCapture(geminiLiveCaptureHoldId, { suppressEmit: true });
  }
  if (geminiLiveStreamActive) {
    stopGeminiLiveStream(geminiLiveStreamSessionId, { suppressEmit: true });
  }

  cleanupAudioSession();
  clearGeminiLiveSocketReconnectTimer();
  geminiLiveStreamStopping = false;
  geminiLiveStreamSocketReconnectAttempts = 0;
  geminiLiveStreamContextPayload = normalizeGeminiLiveContext(contextPayload);
  geminiLiveStreamActive = true;
  geminiLiveStreamSessionId = sessionId;
  geminiLiveLastPlayedTurnId = 0;
  geminiLiveStreamSocketReady = false;
  emitGeminiLiveStreamState("connecting");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: GEMINI_LIVE_STREAM_INPUT_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        latency: 0
      }
    });
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mediaStream = stream;

    const context = new AudioContext({
      sampleRate: GEMINI_LIVE_STREAM_INPUT_SAMPLE_RATE,
      latencyHint: "interactive"
    });
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId) {
      context.close();
      return;
    }
    audioContext = context;
    const source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    processor = context.createScriptProcessor(GEMINI_LIVE_STREAM_PROCESSOR_FRAMES, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || !audioContext) return;
      const ws = audioWs;
      if (!ws || ws.readyState !== WebSocket.OPEN || !geminiLiveStreamSocketReady) {
        return;
      }
      const inputData = event.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, context.sampleRate, GEMINI_LIVE_STREAM_INPUT_SAMPLE_RATE);
      const pcmData = floatTo16BitPCM(resampled);
      try {
        ws.send(pcmData.buffer);
      } catch (_error) {
        // Connection errors are handled by onclose/onerror.
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    openGeminiLiveSocket(sessionId, geminiLiveStreamContextPayload);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    stopGeminiLiveStream(sessionId, { suppressEmit: true });
    emitGeminiLiveStreamState("error", message, sessionId);
  }
}

function stopGeminiLiveStream(sessionIdRaw, options = {}) {
  if (!geminiLiveStreamActive) {
    return;
  }
  const sessionId = Number(sessionIdRaw) || 0;
  if (sessionId && geminiLiveStreamSessionId && sessionId !== geminiLiveStreamSessionId) {
    return;
  }

  const finalSessionId = geminiLiveStreamSessionId;
  const suppressEmit = Boolean(options && options.suppressEmit);
  geminiLiveStreamStopping = true;
  clearGeminiLiveSocketReconnectTimer();
  geminiLiveStreamSocketReconnectAttempts = 0;
  geminiLiveStreamContextPayload = null;
  geminiLiveStreamActive = false;
  geminiLiveStreamSessionId = 0;
  geminiLiveStreamSocketReady = false;
  geminiLiveLastPlayedTurnId = 0;
  if (audioWs && audioWs.readyState === WebSocket.OPEN) {
    try {
      audioWs.send(JSON.stringify({ type: "stop" }));
    } catch (_error) {
      // Ignore send errors during shutdown.
    }
  }
  cleanupAudioSession();
  geminiLiveStreamStopping = false;
  if (!suppressEmit) {
    emitGeminiLiveStreamState("stopped", "", finalSessionId);
  }
}

function cleanupAudioSession() {
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
    const ws = audioWs;
    audioWs = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch (_error) {
      // Ignore close races.
    }
  }
  stopGeminiLiveStreamPlaybackQueue();
  if (geminiLiveStreamPlaybackContext) {
    const ctx = geminiLiveStreamPlaybackContext;
    geminiLiveStreamPlaybackContext = null;
    try {
      ctx.close();
    } catch (_error) {
      // Ignore close races.
    }
  }
  analyser = null;
}

async function startRecording(modeOverride) {
  stopGeminiLivePlayback();
  if (geminiLiveCaptureActive) {
    stopGeminiLiveCapture(geminiLiveCaptureHoldId, { suppressEmit: true });
  }
  if (geminiLiveStreamActive) {
    stopGeminiLiveStream(geminiLiveStreamSessionId, { suppressEmit: true });
  }
  const requestedMode = normalizeAudioMode(modeOverride || currentMode);
  if (recording) {
    // Duplicate start events can happen; keep current capture stable for same mode.
    if (requestedMode === currentMode) {
      return;
    }
    stopRecording();
  }
  cleanupAudioSession();
  fullTranscript = "";
  currentMode = requestedMode;
  const sessionId = recordingSession + 1;
  recordingSession = sessionId;
  setRecording(true);

  try {
    if (currentMode === "elevenlabs") {
      await startElevenLabs(sessionId);
    } else {
      await startLocalWhisper(sessionId);
    }
  } catch (err) {
    if (recordingSession !== sessionId) {
      return;
    }
    abortSession(sessionId, `Error: ${err.message || err}`);
  }
}

async function startElevenLabs(sessionId) {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/elevenlabs`;
  const ws = new WebSocket(wsUrl);
  audioWs = ws;

  ws.onopen = () => {
    if (!isActiveSession(sessionId, ws)) return;
    emitTranscript("Listening...");
  };

  ws.onmessage = (event) => {
    if (!isActiveSession(sessionId, ws)) return;
    const data = JSON.parse(event.data);
    if (data.message_type === "partial_transcript") {
      const displayText = `${fullTranscript} ${data.text || ""}`.trim();
      emitTranscript(displayText || "Listening...");
    } else if (data.message_type === "committed_transcript" || data.message_type === "final_transcript") {
      if (data.text) {
        fullTranscript = `${fullTranscript} ${data.text}`.trim();
        emitTranscript(fullTranscript);
      }
    } else if (data.error) {
      if (String(data.error).includes("ELEVENLABS_API_KEY is not configured")) {
        abortSession(sessionId, "ElevenLabs API Key is not configured.");
        return;
      }
      abortSession(sessionId, `Error: ${data.error}`);
    }
  };

  ws.onclose = () => {
    if (!isActiveSession(sessionId, ws)) return;
    abortSession(sessionId);
  };

  ws.onerror = () => {
    if (!isActiveSession(sessionId, ws)) return;
    abortSession(sessionId, "Connection error. Is the audio server running?");
  };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  if (!isActiveSession(sessionId, ws)) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  mediaStream = stream;

  const context = new AudioContext();
  if (!isActiveSession(sessionId, ws)) {
    context.close();
    return;
  }
  audioContext = context;
  const source = context.createMediaStreamSource(stream);
  analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!isActiveSession(sessionId, ws) || !audioContext) return;
    if (audioWs && audioWs.readyState === WebSocket.OPEN) {
      const inputData = e.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, context.sampleRate, 16000);
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
  processor.connect(context.destination);
}

async function startLocalWhisper(sessionId) {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/audio`;
  const ws = new WebSocket(wsUrl);
  audioWs = ws;

  ws.onopen = () => {
    if (!isActiveSession(sessionId, ws)) return;
    emitTranscript("Listening...");
  };

  ws.onmessage = (event) => {
    if (!isActiveSession(sessionId, ws)) return;
    const data = JSON.parse(event.data);
    if (data.text) {
      emitTranscript(data.text);
    }
  };

  ws.onclose = () => {
    if (!isActiveSession(sessionId, ws)) return;
    abortSession(sessionId);
  };

  ws.onerror = () => {
    if (!isActiveSession(sessionId, ws)) return;
    abortSession(sessionId, "Connection error. Is the audio server running?");
  };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
  if (!isActiveSession(sessionId, ws)) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  mediaStream = stream;

  const context = new AudioContext({ sampleRate: 16000 });
  if (!isActiveSession(sessionId, ws)) {
    context.close();
    return;
  }
  audioContext = context;
  const source = context.createMediaStreamSource(stream);
  analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!isActiveSession(sessionId, ws) || !audioContext) return;
    if (audioWs && audioWs.readyState === WebSocket.OPEN) {
      const inputData = e.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, context.sampleRate, 16000);
      const pcmData = floatTo16BitPCM(resampled);
      audioWs.send(pcmData.buffer);
    }
  };

  source.connect(processor);
  processor.connect(context.destination);
}

async function startGeminiLiveCapture(holdIdRaw) {
  const holdId = Number(holdIdRaw) || Date.now();
  if (geminiLiveCaptureActive && geminiLiveCaptureHoldId === holdId) {
    return;
  }
  stopGeminiLivePlayback();
  if (geminiLiveStreamActive) {
    stopGeminiLiveStream(geminiLiveStreamSessionId, { suppressEmit: true });
  }

  if (recording) {
    stopRecording();
  }
  if (geminiLiveCaptureActive) {
    stopGeminiLiveCapture(geminiLiveCaptureHoldId, { suppressEmit: true });
  }

  cleanupAudioSession();
  geminiLiveCaptureActive = true;
  geminiLiveCaptureHoldId = holdId;
  geminiLiveAudioChunks = [];
  geminiLiveAudioBytes = 0;

  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-capture-state",
    holdId,
    state: "listening"
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 24000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (!geminiLiveCaptureActive || geminiLiveCaptureHoldId !== holdId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mediaStream = stream;

    const context = new AudioContext({ sampleRate: 24000 });
    if (!geminiLiveCaptureActive || geminiLiveCaptureHoldId !== holdId) {
      context.close();
      return;
    }
    audioContext = context;
    const source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!geminiLiveCaptureActive || geminiLiveCaptureHoldId !== holdId || !audioContext) return;
      const inputData = event.inputBuffer.getChannelData(0);
      const resampled = downsample(inputData, context.sampleRate, 24000);
      const pcmData = floatTo16BitPCM(resampled);
      const chunk = new Uint8Array(pcmData.buffer.slice(0));
      geminiLiveAudioChunks.push(chunk);
      geminiLiveAudioBytes += chunk.byteLength;
    };

    source.connect(processor);
    processor.connect(context.destination);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    stopGeminiLiveCapture(holdId, { suppressEmit: true });
    chrome.runtime.sendMessage({
      type: "aqual-gemini-live-audio",
      holdId,
      audioBase64: "",
      audioMimeType: "audio/pcm;rate=24000",
      error: message
    });
    chrome.runtime.sendMessage({
      type: "aqual-gemini-live-capture-state",
      holdId,
      state: "error",
      error: message
    });
  }
}

function stopGeminiLiveCapture(holdIdRaw, options = {}) {
  if (!geminiLiveCaptureActive) {
    return;
  }
  const holdId = Number(holdIdRaw) || 0;
  if (holdId && geminiLiveCaptureHoldId && holdId !== geminiLiveCaptureHoldId) {
    return;
  }

  const finalHoldId = geminiLiveCaptureHoldId;
  const suppressEmit = Boolean(options && options.suppressEmit);
  const merged = mergeAudioChunks(geminiLiveAudioChunks, geminiLiveAudioBytes);
  const durationMs = Math.round((merged.byteLength / (24000 * 2)) * 1000);

  geminiLiveCaptureActive = false;
  geminiLiveCaptureHoldId = 0;
  geminiLiveAudioChunks = [];
  geminiLiveAudioBytes = 0;
  cleanupAudioSession();

  if (suppressEmit) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-audio",
    holdId: finalHoldId,
    audioBase64: merged.byteLength ? arrayBufferToBase64(merged.buffer) : "",
    audioMimeType: "audio/pcm;rate=24000",
    audioBytes: merged.byteLength,
    durationMs
  });

  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-capture-state",
    holdId: finalHoldId,
    state: "stopped"
  });
}

function stopRecording() {
  recordingSession += 1;
  cleanupAudioSession();
  setRecording(false);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.type === "aqual-audio-start") {
    startRecording(message.mode);
  }
  if (message.type === "aqual-audio-stop") {
    stopRecording();
  }
  if (message.type === "aqual-gemini-live-play-audio") {
    if (geminiLiveStreamActive) {
      // In websocket live mode, streamed chunks are the only playback source.
      return;
    }
    playGeminiLiveAudio(message);
  }
  if (message.type === "aqual-gemini-live-stop-playback") {
    stopGeminiLivePlayback();
  }
  if (message.type === "aqual-gemini-live-stream-start") {
    startGeminiLiveStream(message.sessionId, {
      includePageContext: Boolean(message.includePageContext),
      pageUrl: String(message.pageUrl || ""),
      conversationId: String(message.conversationId || ""),
      screenshotDataUrl: String(message.screenshotDataUrl || "")
    });
  }
  if (message.type === "aqual-gemini-live-stream-context") {
    updateGeminiLiveStreamContext(message.sessionId, {
      includePageContext: Boolean(message.includePageContext),
      pageUrl: String(message.pageUrl || ""),
      conversationId: String(message.conversationId || ""),
      screenshotDataUrl: String(message.screenshotDataUrl || "")
    });
  }
  if (message.type === "aqual-gemini-live-stream-stop") {
    stopGeminiLiveStream(message.sessionId);
  }
  if (message.type === "aqual-gemini-live-capture-start") {
    startGeminiLiveCapture(message.holdId);
  }
  if (message.type === "aqual-gemini-live-capture-stop") {
    stopGeminiLiveCapture(message.holdId);
  }
});
