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
let geminiLiveStreamSequence = 0;
let geminiLiveStreamChunks = [];
let geminiLiveStreamBytes = 0;
let geminiLiveStreamSpeechMs = 0;
let geminiLiveStreamSilenceMs = 0;

const GEMINI_LIVE_SAMPLE_RATE = 24000;
const GEMINI_LIVE_VOICE_THRESHOLD = 0.009;
const GEMINI_LIVE_MIN_SEGMENT_MS = 320;
const GEMINI_LIVE_MAX_SEGMENT_MS = 2600;
const GEMINI_LIVE_SILENCE_END_MS = 560;

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

function calculateRms(floatBuffer) {
  if (!floatBuffer || !floatBuffer.length) return 0;
  let sumSquares = 0;
  for (let i = 0; i < floatBuffer.length; i += 1) {
    const value = floatBuffer[i];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / floatBuffer.length);
}

function resetGeminiLiveStreamBuffer() {
  geminiLiveStreamChunks = [];
  geminiLiveStreamBytes = 0;
  geminiLiveStreamSpeechMs = 0;
  geminiLiveStreamSilenceMs = 0;
}

function emitGeminiLiveStreamState(state, error = "", sessionIdOverride = null) {
  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-stream-state",
    sessionId: Number(sessionIdOverride || geminiLiveStreamSessionId || 0),
    state,
    error
  });
}

function emitGeminiLiveStreamChunk({ force = false, final = false } = {}) {
  if (!geminiLiveStreamActive || !geminiLiveStreamSessionId) {
    resetGeminiLiveStreamBuffer();
    return;
  }
  if (!geminiLiveStreamBytes) return;

  const merged = mergeAudioChunks(geminiLiveStreamChunks, geminiLiveStreamBytes);
  const durationMs = Math.round((merged.byteLength / (GEMINI_LIVE_SAMPLE_RATE * 2)) * 1000);
  if (!force && durationMs < GEMINI_LIVE_MIN_SEGMENT_MS) {
    return;
  }

  geminiLiveStreamSequence += 1;
  chrome.runtime.sendMessage({
    type: "aqual-gemini-live-stream-chunk",
    sessionId: geminiLiveStreamSessionId,
    sequence: geminiLiveStreamSequence,
    audioBase64: merged.byteLength ? arrayBufferToBase64(merged.buffer) : "",
    audioMimeType: "audio/pcm;rate=24000",
    audioBytes: merged.byteLength,
    durationMs,
    final: Boolean(final)
  });

  resetGeminiLiveStreamBuffer();
}

function stopGeminiLivePlayback() {
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

async function startGeminiLiveStream(sessionIdRaw) {
  const sessionId = Number(sessionIdRaw) || Date.now();
  if (geminiLiveStreamActive && geminiLiveStreamSessionId === sessionId) {
    return;
  }

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
  geminiLiveStreamActive = true;
  geminiLiveStreamSessionId = sessionId;
  geminiLiveStreamSequence = 0;
  resetGeminiLiveStreamBuffer();
  emitGeminiLiveStreamState("starting");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: GEMINI_LIVE_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    mediaStream = stream;

    const context = new AudioContext({ sampleRate: GEMINI_LIVE_SAMPLE_RATE });
    if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId) {
      context.close();
      return;
    }
    audioContext = context;
    const source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!geminiLiveStreamActive || geminiLiveStreamSessionId !== sessionId || !audioContext) return;
      const inputData = event.inputBuffer.getChannelData(0);
      const rms = calculateRms(inputData);
      const isVoice = rms >= GEMINI_LIVE_VOICE_THRESHOLD;
      const resampled = downsample(inputData, context.sampleRate, GEMINI_LIVE_SAMPLE_RATE);
      const pcmData = floatTo16BitPCM(resampled);
      const chunk = new Uint8Array(pcmData.buffer.slice(0));
      const frameMs = (resampled.length / GEMINI_LIVE_SAMPLE_RATE) * 1000;

      if (isVoice) {
        if (geminiLivePlaybackAudio) {
          stopGeminiLivePlayback();
        }
        geminiLiveStreamSilenceMs = 0;
        geminiLiveStreamSpeechMs += frameMs;
      } else if (geminiLiveStreamBytes > 0) {
        geminiLiveStreamSilenceMs += frameMs;
      }

      if (isVoice || geminiLiveStreamBytes > 0) {
        geminiLiveStreamChunks.push(chunk);
        geminiLiveStreamBytes += chunk.byteLength;
      }

      if (
        geminiLiveStreamBytes > 0 &&
        geminiLiveStreamSpeechMs >= GEMINI_LIVE_MIN_SEGMENT_MS &&
        geminiLiveStreamSilenceMs >= GEMINI_LIVE_SILENCE_END_MS
      ) {
        emitGeminiLiveStreamChunk({ force: true });
      } else if (geminiLiveStreamBytes > 0 && geminiLiveStreamSpeechMs >= GEMINI_LIVE_MAX_SEGMENT_MS) {
        emitGeminiLiveStreamChunk({ force: true });
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    emitGeminiLiveStreamState("listening");
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
  if (!suppressEmit) {
    emitGeminiLiveStreamChunk({ force: true, final: true });
  } else {
    resetGeminiLiveStreamBuffer();
  }
  geminiLiveStreamActive = false;
  geminiLiveStreamSessionId = 0;
  geminiLiveStreamSequence = 0;
  cleanupAudioSession();
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
    audioWs.close();
    audioWs = null;
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
    playGeminiLiveAudio(message);
  }
  if (message.type === "aqual-gemini-live-stop-playback") {
    stopGeminiLivePlayback();
  }
  if (message.type === "aqual-gemini-live-stream-start") {
    startGeminiLiveStream(message.sessionId);
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
