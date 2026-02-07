from pathlib import Path
import os
import sys

# Silence logs before imports
os.environ["TQDM_DISABLE"] = "1"
os.environ["MQ_LOG_LEVEL"] = "ERROR"

import asyncio
import numpy as np
import mlx_whisper
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import webrtcvad
import time
import httpx
import websockets
import ssl

# ElevenLabs API Key
ELEVENLABS_API_KEY = ""
ELEVENLABS_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=en"

# --- Configuration ---
MODEL_NAME = "mlx-community/whisper-tiny"
RATE = 16000
TRANSCRIPTION_INTERVAL = 0.2  # 200ms for low latency
SILENCE_TIMEOUT = 0.6
NOISE_THRESHOLD = 0.01

# Suppress prints context manager
class NoPrints:
    def __enter__(self):
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr
        sys.stdout = open(os.devnull, 'w')
        sys.stderr = open(os.devnull, 'w')

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout.close()
        sys.stderr.close()
        sys.stdout = self._original_stdout
        sys.stderr = self._original_stderr

app = FastAPI()

# Warm up model on startup
@app.on_event("startup")
async def startup_event():
    print("⚡️ Warming up Whisper model...")
    with NoPrints():
        warmup = np.zeros(16000, dtype=np.float32)
        mlx_whisper.transcribe(warmup, path_or_hf_repo=MODEL_NAME)
    print("✅ Model ready!")

def is_garbage(text):
    """Detects hallucinations"""
    if not text:
        return True
    if len(text) > 10 and len(set(text)) < 5:
        return True
    # Common whisper hallucinations
    hallucinations = ["thank you", "thanks for watching", "subscribe", "bye"]
    if text.lower().strip() in hallucinations:
        return True
    return False

@app.websocket("/ws/audio")
async def websocket_audio(websocket: WebSocket):
    await websocket.accept()
    print("🎤 Client connected")

    vad = webrtcvad.Vad(2)
    audio_buffer = b""
    last_transcribe = time.time()
    last_voice = time.time()
    full_transcript = ""  # Accumulates the entire session transcript
    last_text = ""

    try:
        while True:
            data = await websocket.receive_bytes()
            audio_buffer += data

            # VAD check
            chunk_samples = 480 * 2
            if len(data) >= chunk_samples:
                chunk = data[:chunk_samples]
                chunk_np = np.frombuffer(chunk, dtype=np.int16)
                max_amp = np.abs(chunk_np).max() / 32768.0

                if max_amp > NOISE_THRESHOLD:
                    try:
                        if vad.is_speech(chunk, RATE):
                            last_voice = time.time()
                    except:
                        pass

            # After silence, lock in current text and reset buffer for next segment
            if time.time() - last_voice > SILENCE_TIMEOUT:
                if last_text:
                    full_transcript += last_text + " "
                    last_text = ""
                    audio_buffer = b""
                    await websocket.send_json({"text": full_transcript.strip()})
                continue

            # Periodic transcription
            now = time.time()
            if now - last_transcribe > TRANSCRIPTION_INTERVAL:
                if len(audio_buffer) > 3200:
                    data_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0

                    with NoPrints():
                        result = mlx_whisper.transcribe(
                            data_np,
                            path_or_hf_repo=MODEL_NAME,
                            language="en",
                            verbose=False
                        )

                    text = result["text"].strip()
                    if not is_garbage(text):
                        last_text = text
                        # Send full transcript + current partial
                        display_text = (full_transcript + text).strip()
                        await websocket.send_json({"text": display_text})

                last_transcribe = now

            # Keep buffer manageable (30 seconds max for long utterances)
            max_buffer = RATE * 30 * 2
            if len(audio_buffer) > max_buffer:
                # Lock in what we have and trim
                if last_text:
                    full_transcript += last_text + " "
                    last_text = ""
                audio_buffer = audio_buffer[-(RATE * 10 * 2):]  # Keep last 10s

    except WebSocketDisconnect:
        print("🔌 Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

# Proxy to ElevenLabs realtime STT
@app.websocket("/ws/elevenlabs")
async def websocket_elevenlabs(websocket: WebSocket):
    await websocket.accept()
    print("🎧 Client connected (ElevenLabs)")

    try:
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        headers = {"xi-api-key": ELEVENLABS_API_KEY}
        async with websockets.connect(
            ELEVENLABS_WS_URL,
            additional_headers=headers,
            ssl=ssl_context
        ) as elevenlabs_ws:
            async def forward_to_elevenlabs():
                try:
                    while True:
                        data = await websocket.receive_text()
                        await elevenlabs_ws.send(data)
                except WebSocketDisconnect:
                    pass

            async def forward_to_client():
                try:
                    async for message in elevenlabs_ws:
                        await websocket.send_text(message)
                except Exception as e:
                    print(f"Forward to client error: {e}")

            await asyncio.gather(
                forward_to_elevenlabs(),
                forward_to_client()
            )
    except Exception as e:
        print(f"ElevenLabs proxy error: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass

# Generate ElevenLabs single-use token
@app.get("/api/token")
async def get_token():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
            headers={"xi-api-key": ELEVENLABS_API_KEY}
        )
        if response.status_code == 200:
            return response.json()
        else:
            return JSONResponse(
                status_code=response.status_code,
                content={"error": response.text}
            )

# Serve the HTML page
@app.get("/")
async def get():
    return HTMLResponse(Path(__file__).with_name("index.html").read_text(encoding="utf-8"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
