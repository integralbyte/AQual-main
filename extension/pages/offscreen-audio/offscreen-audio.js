const AUDIO_SERVER_HOST = "localhost:8000";

let audioWs = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let analyser = null;
let recording = false;
let currentMode = "elevenlabs";
let fullTranscript = "";

function setRecording(value) {
  recording = value;
  chrome.runtime.sendMessage({ type: "aqual-audio-state", recording: value });
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
  if (recording) return;
  fullTranscript = "";
  currentMode = modeOverride || "elevenlabs";
  setRecording(true);

  try {
    if (currentMode === "elevenlabs") {
      await startElevenLabs();
    } else {
      await startLocalWhisper();
    }
  } catch (err) {
    setRecording(false);
    emitTranscript(`Error: ${err.message || err}`);
  }
}

async function startElevenLabs() {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/elevenlabs`;
  audioWs = new WebSocket(wsUrl);

  audioWs.onmessage = (event) => {
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
      setRecording(false);
      emitTranscript(`Error: ${data.error}`);
    }
  };

  audioWs.onclose = () => {
    setRecording(false);
  };

  audioWs.onerror = () => {
    cleanupAudioSession();
    setRecording(false);
    emitTranscript("Connection error. Is the audio server running?");
  };

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

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
}

async function startLocalWhisper() {
  const wsUrl = `ws://${AUDIO_SERVER_HOST}/ws/audio`;
  audioWs = new WebSocket(wsUrl);

  audioWs.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.text) {
      emitTranscript(data.text);
    }
  };

  audioWs.onclose = () => {
    setRecording(false);
  };

  audioWs.onerror = () => {
    cleanupAudioSession();
    setRecording(false);
    emitTranscript("Connection error. Is the audio server running?");
  };

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true
    }
  });

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
}

function stopRecording() {
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
