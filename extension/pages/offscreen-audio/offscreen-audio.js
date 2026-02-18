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
});
