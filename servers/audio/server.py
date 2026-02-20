import os
import sys
import json
import base64
import re
import urllib.parse
from pathlib import Path

# Silence logs before imports
os.environ["TQDM_DISABLE"] = "1"
os.environ["MQ_LOG_LEVEL"] = "ERROR"

import asyncio
import numpy as np
import mlx_whisper
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import time
import httpx
import websockets
import ssl
try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None
try:
    import webrtcvad
except Exception:
    webrtcvad = None

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from servers.config import get_env

ELEVENLABS_API_KEY = get_env("ELEVENLABS_API_KEY", "")
ELEVENLABS_WS_URL = get_env(
    "ELEVENLABS_WS_URL",
    "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=en"
)
GEMINI_API_KEY = get_env("GEMINI_API_KEY", "")
GEMINI_LIVE_MODEL = str(get_env("GEMINI_LIVE_MODEL", "")).strip() or "gemini-2.5-flash-native-audio-preview-12-2025"
GEMINI_LIVE_ENABLE_CONTEXT = str(get_env("GEMINI_LIVE_ENABLE_CONTEXT", "0")).strip().lower() in ("1", "true", "yes", "on")


def _get_env_int(name: str, default: int, minimum=None, maximum=None) -> int:
    raw = str(get_env(name, default)).strip()
    try:
        value = int(raw)
    except Exception:
        value = int(default)
    if minimum is not None:
        value = max(int(minimum), value)
    if maximum is not None:
        value = min(int(maximum), value)
    return value


def _get_env_float(name: str, default: float, minimum=None, maximum=None) -> float:
    raw = str(get_env(name, default)).strip()
    try:
        value = float(raw)
    except Exception:
        value = float(default)
    if minimum is not None:
        value = max(float(minimum), value)
    if maximum is not None:
        value = min(float(maximum), value)
    return value


GEMINI_LIVE_THINKING_BUDGET = _get_env_int("GEMINI_LIVE_THINKING_BUDGET", 0, minimum=0, maximum=32768)
GEMINI_LIVE_MAX_OUTPUT_TOKENS = _get_env_int("GEMINI_LIVE_MAX_OUTPUT_TOKENS", 512, minimum=0, maximum=2048)
GEMINI_LIVE_TEMPERATURE = _get_env_float("GEMINI_LIVE_TEMPERATURE", 0.1, minimum=0.0, maximum=2.0)
GEMINI_LIVE_INPUT_SAMPLE_RATE = _get_env_int("GEMINI_LIVE_INPUT_SAMPLE_RATE", 16000, minimum=8000, maximum=48000)
GEMINI_LIVE_AAD_PREFIX_PADDING_MS = _get_env_int("GEMINI_LIVE_AAD_PREFIX_PADDING_MS", 120, minimum=0, maximum=2000)
GEMINI_LIVE_AAD_SILENCE_DURATION_MS = _get_env_int("GEMINI_LIVE_AAD_SILENCE_DURATION_MS", 160, minimum=80, maximum=4000)
GEMINI_LIVE_INPUT_SPEECH_THRESHOLD = _get_env_float("GEMINI_LIVE_INPUT_SPEECH_THRESHOLD", 0.008, minimum=0.002, maximum=0.2)

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
ACTIVE_GEMINI_LIVE_TOKEN = 0

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


def _normalize_live_model_name(model_name: str) -> str:
    token = str(model_name or "").strip()
    if not token:
        return token
    if "/" in token:
        return token
    return f"models/{token}"


def _decode_data_url(data_url: str):
    match = re.match(r"^data:(?P<mime>[^;,]+)?(?P<b64>;base64)?,(?P<data>.*)$", data_url, re.DOTALL)
    if not match:
        raise ValueError("Invalid data URL")
    mime_type = (match.group("mime") or "image/png").strip()
    payload = match.group("data") or ""
    if match.group("b64"):
        data = base64.b64decode(payload)
    else:
        data = urllib.parse.unquote_to_bytes(payload)
    return data, mime_type


def _extract_live_message_text(message) -> str:
    text_chunks = []
    server_content = getattr(message, "server_content", None)
    model_turn = getattr(server_content, "model_turn", None) if server_content else None
    parts = getattr(model_turn, "parts", None) if model_turn else None
    if parts:
        for part in parts:
            part_text = getattr(part, "text", None)
            if part_text:
                text_chunks.append(str(part_text))
    output_transcription = getattr(server_content, "output_transcription", None) if server_content else None
    if output_transcription and getattr(output_transcription, "text", None):
        text_chunks.append(str(output_transcription.text))
    return "".join(text_chunks).strip()


def _extract_live_audio_bytes(message):
    server_content = getattr(message, "server_content", None)
    model_turn = getattr(server_content, "model_turn", None) if server_content else None
    parts = getattr(model_turn, "parts", None) if model_turn else None
    if not parts:
        return b"", ""

    audio_bytes = []
    audio_mime = ""
    for part in parts:
        inline_data = getattr(part, "inline_data", None)
        if not inline_data:
            continue
        mime_type = str(getattr(inline_data, "mime_type", "") or "")
        data = getattr(inline_data, "data", None)
        if not data:
            continue
        if isinstance(data, bytes):
            payload = data
        elif isinstance(data, bytearray):
            payload = bytes(data)
        elif isinstance(data, str):
            try:
                payload = base64.b64decode(data, validate=True)
            except Exception:
                continue
        else:
            continue
        if not payload:
            continue
        if mime_type.lower().startswith("audio/"):
            if not audio_mime:
                audio_mime = mime_type
            audio_bytes.append(payload)
    return (b"".join(audio_bytes), audio_mime)


def get_gemini_client():
    if genai is None or types is None:
        raise RuntimeError("google-genai is not installed. Install dependencies from servers/audio/requirements.txt.")
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured. Set it in .env.")
    return genai.Client(
        api_key=GEMINI_API_KEY,
        http_options={"api_version": "v1beta"},
    )


def _resolve_start_sensitivity():
    token = str(get_env("GEMINI_LIVE_AAD_START_SENSITIVITY", "HIGH")).strip().upper()
    mapping = {
        "HIGH": types.StartSensitivity.START_SENSITIVITY_HIGH,
        "LOW": types.StartSensitivity.START_SENSITIVITY_LOW,
    }
    return mapping.get(token, types.StartSensitivity.START_SENSITIVITY_HIGH)


def _resolve_end_sensitivity():
    token = str(get_env("GEMINI_LIVE_AAD_END_SENSITIVITY", "HIGH")).strip().upper()
    mapping = {
        "HIGH": types.EndSensitivity.END_SENSITIVITY_HIGH,
        "LOW": types.EndSensitivity.END_SENSITIVITY_LOW,
    }
    return mapping.get(token, types.EndSensitivity.END_SENSITIVITY_HIGH)


def _has_speech_energy(pcm_bytes: bytes) -> bool:
    if not pcm_bytes:
        return False
    try:
        audio = np.frombuffer(pcm_bytes, dtype=np.int16)
        if audio.size == 0:
            return False
        peak = float(np.max(np.abs(audio))) / 32768.0
        return peak >= GEMINI_LIVE_INPUT_SPEECH_THRESHOLD
    except Exception:
        return False

@app.websocket("/ws/audio")
async def websocket_audio(websocket: WebSocket):
    await websocket.accept()
    print("🎤 Client connected")

    vad = webrtcvad.Vad(2) if webrtcvad else None
    if vad is None:
        print("⚠️ webrtcvad unavailable; using amplitude-only speech detection fallback.")
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
                    if vad is None:
                        last_voice = time.time()
                    else:
                        try:
                            if vad.is_speech(chunk, RATE):
                                last_voice = time.time()
                        except Exception:
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

    if not ELEVENLABS_API_KEY:
        await websocket.send_json({"error": "ELEVENLABS_API_KEY is not configured. Set it in .env."})
        await websocket.close(code=1011)
        return

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


@app.websocket("/ws/gemini-live")
async def websocket_gemini_live(websocket: WebSocket):
    global ACTIVE_GEMINI_LIVE_TOKEN
    await websocket.accept()
    ACTIVE_GEMINI_LIVE_TOKEN += 1
    session_token = ACTIVE_GEMINI_LIVE_TOKEN
    print("🟢 Gemini Live client connected")

    try:
        client = get_gemini_client()
    except Exception as e:
        print(f"❌ Gemini Live setup error: {e}")
        await websocket.send_json({"type": "error", "error": str(e)})
        await websocket.close(code=1011)
        return

    model_name = _normalize_live_model_name(GEMINI_LIVE_MODEL)
    aad_config = types.AutomaticActivityDetection(
        disabled=False,
        start_of_speech_sensitivity=_resolve_start_sensitivity(),
        end_of_speech_sensitivity=_resolve_end_sensitivity(),
        prefix_padding_ms=GEMINI_LIVE_AAD_PREFIX_PADDING_MS,
        silence_duration_ms=GEMINI_LIVE_AAD_SILENCE_DURATION_MS,
    )
    config_kwargs = {
        "response_modalities": ["AUDIO"],
        "temperature": GEMINI_LIVE_TEMPERATURE,
        "thinking_config": types.ThinkingConfig(thinking_budget=GEMINI_LIVE_THINKING_BUDGET),
        "realtime_input_config": types.RealtimeInputConfig(
            automatic_activity_detection=aad_config,
        ),
        "system_instruction": (
            "You are AQual, an accessibility assistant. "
            "Respond naturally in English. "
            "Keep spoken replies short and direct. "
            "Only describe the current page if the user explicitly asks about it."
        ),
    }
    if GEMINI_LIVE_MAX_OUTPUT_TOKENS > 0:
        config_kwargs["max_output_tokens"] = GEMINI_LIVE_MAX_OUTPUT_TOKENS
    config = types.LiveConnectConfig(**config_kwargs)

    async def safe_send(payload):
        try:
            await websocket.send_json(payload)
            return True
        except Exception:
            return False

    stop_event = asyncio.Event()
    active_conversation_id = ""
    active_screenshot_bytes = b""
    active_screenshot_mime = "image/jpeg"
    context_pending_for_session = False
    turn_counter = 0
    reconnect_attempt = 0

    while not stop_event.is_set():
        if session_token != ACTIVE_GEMINI_LIVE_TOKEN:
            print("ℹ️ Gemini Live session superseded by a newer client")
            break
        context_pending_for_session = GEMINI_LIVE_ENABLE_CONTEXT and bool(active_screenshot_bytes)
        output_transcript_text = ""
        output_audio_bytes_since_turn = 0
        had_user_audio_since_turn = False
        had_local_speech_since_turn = False
        had_voice_activity_since_turn = False
        first_voice_activity_seen = False
        responding_state_sent = False

        def reset_turn_buffers():
            nonlocal output_transcript_text, output_audio_bytes_since_turn
            nonlocal had_user_audio_since_turn, had_local_speech_since_turn, had_voice_activity_since_turn
            nonlocal first_voice_activity_seen, responding_state_sent
            output_transcript_text = ""
            output_audio_bytes_since_turn = 0
            had_user_audio_since_turn = False
            had_local_speech_since_turn = False
            had_voice_activity_since_turn = False
            first_voice_activity_seen = False
            responding_state_sent = False

        try:
            async with client.aio.live.connect(model=model_name, config=config) as session:
                reconnect_attempt = 0
                await safe_send({"type": "status", "state": "connecting"})
                await safe_send({
                    "type": "status",
                    "state": "ready",
                    "conversationId": active_conversation_id,
                })

                session_stop_event = asyncio.Event()
                context_send_lock = asyncio.Lock()

                async def send_context_once():
                    nonlocal context_pending_for_session
                    if not GEMINI_LIVE_ENABLE_CONTEXT:
                        return True
                    async with context_send_lock:
                        if not context_pending_for_session:
                            return True
                        try:
                            if active_screenshot_bytes:
                                await session.send_realtime_input(
                                    media=types.Blob(
                                        data=active_screenshot_bytes,
                                        mime_type=active_screenshot_mime or "image/jpeg",
                                    ),
                                )
                            context_pending_for_session = False
                            return True
                        except Exception as e:
                            print(f"⚠️ Gemini Live context send failed, reconnecting: {e}")
                            return False

                async def send_audio_blob(blob_bytes: bytes):
                    nonlocal had_user_audio_since_turn, had_local_speech_since_turn, first_voice_activity_seen
                    nonlocal responding_state_sent
                    if not blob_bytes:
                        return True
                    if responding_state_sent:
                        # Prevent accidental self-interruption while assistant audio is streaming.
                        return True
                    # Snapshot/page context must be sent before first audio of the turn;
                    # sending context mid-turn can interrupt or truncate model speech.
                    if context_pending_for_session and not had_user_audio_since_turn:
                        if not await send_context_once():
                            return False
                    try:
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=blob_bytes,
                                mime_type=f"audio/pcm;rate={GEMINI_LIVE_INPUT_SAMPLE_RATE}",
                            ),
                        )
                    except Exception as e:
                        print(f"⚠️ Gemini Live audio send failed, reconnecting: {e}")
                        return False
                    had_user_audio_since_turn = True
                    if _has_speech_energy(blob_bytes):
                        had_local_speech_since_turn = True
                        if not first_voice_activity_seen:
                            first_voice_activity_seen = True
                            await safe_send({
                                "type": "speech_start",
                                "turnId": turn_counter + 1,
                                "source": "local_energy",
                            })
                            await safe_send({"type": "status", "state": "listening"})
                        if context_pending_for_session:
                            if not await send_context_once():
                                return False
                    return True

                async def receive_from_client():
                    nonlocal active_conversation_id, active_screenshot_bytes, active_screenshot_mime
                    nonlocal context_pending_for_session, had_user_audio_since_turn
                    while not stop_event.is_set() and not session_stop_event.is_set():
                        if session_token != ACTIVE_GEMINI_LIVE_TOKEN:
                            stop_event.set()
                            return
                        try:
                            message = await asyncio.wait_for(websocket.receive(), timeout=0.3)
                        except asyncio.TimeoutError:
                            continue
                        except WebSocketDisconnect as e:
                            print(f"ℹ️ Gemini Live websocket disconnected by client (code={getattr(e, 'code', 'unknown')})")
                            stop_event.set()
                            return
                        except RuntimeError as e:
                            print(f"⚠️ Gemini Live websocket receive error: {e}")
                            stop_event.set()
                            return

                        msg_type = message.get("type")
                        if msg_type == "websocket.disconnect":
                            stop_event.set()
                            return

                        binary_payload = message.get("bytes")
                        if binary_payload is not None:
                            if not binary_payload:
                                continue
                            if not await send_audio_blob(binary_payload):
                                return
                            continue

                        text_payload = message.get("text")
                        if text_payload is None:
                            continue

                        payload = {}
                        try:
                            payload = json.loads(text_payload)
                        except Exception:
                            payload = {}
                        if not isinstance(payload, dict):
                            payload = {}
                        event_type = str(payload.get("type") or "").strip()

                        if event_type == "stop":
                            print("ℹ️ Gemini Live client requested stop")
                            stop_event.set()
                            return
                        if event_type == "ping":
                            await safe_send({"type": "pong"})
                            continue
                        if event_type != "context":
                            continue

                        conversation_id = str(payload.get("conversationId") or "").strip()
                        if conversation_id:
                            active_conversation_id = conversation_id

                        if GEMINI_LIVE_ENABLE_CONTEXT:
                            screenshot_data_url = str(payload.get("screenshotDataUrl") or "").strip()
                            if screenshot_data_url.startswith("data:"):
                                try:
                                    screenshot_bytes, screenshot_mime = _decode_data_url(screenshot_data_url)
                                    if screenshot_bytes:
                                        active_screenshot_bytes = screenshot_bytes
                                        active_screenshot_mime = screenshot_mime or "image/jpeg"
                                        context_pending_for_session = True
                                except Exception as e:
                                    print(f"⚠️ Gemini Live screenshot context send failed: {e}")

                        await safe_send({
                            "type": "status",
                            "state": "ready",
                            "conversationId": active_conversation_id,
                        })

                async def receive_from_gemini():
                    nonlocal turn_counter, output_transcript_text, output_audio_bytes_since_turn
                    nonlocal had_local_speech_since_turn, had_voice_activity_since_turn
                    nonlocal first_voice_activity_seen, responding_state_sent
                    try:
                        async for message in session.receive():
                            if session_token != ACTIVE_GEMINI_LIVE_TOKEN:
                                stop_event.set()
                                return
                            if stop_event.is_set():
                                return

                            voice_activity = getattr(message, "voice_activity", None)
                            if voice_activity:
                                activity_type = str(getattr(voice_activity, "voice_activity_type", "") or "")
                                if "ACTIVITY_START" in activity_type:
                                    had_voice_activity_since_turn = True
                                    if not first_voice_activity_seen:
                                        first_voice_activity_seen = True
                                        await safe_send({
                                            "type": "speech_start",
                                            "turnId": turn_counter + 1,
                                            "source": "gemini_vad",
                                        })
                                    await safe_send({"type": "status", "state": "listening"})

                            server_content = getattr(message, "server_content", None)
                            if not server_content:
                                continue

                            output_text = _extract_live_message_text(message)
                            if output_text and first_voice_activity_seen:
                                output_transcript_text = output_text
                                if not responding_state_sent:
                                    await safe_send({"type": "status", "state": "responding"})
                                    responding_state_sent = True

                            audio_chunk, audio_mime = _extract_live_audio_bytes(message)
                            if audio_chunk and first_voice_activity_seen:
                                output_audio_bytes_since_turn += len(audio_chunk)
                                await safe_send({
                                    "type": "output_audio_chunk",
                                    "turnId": turn_counter + 1,
                                    "audioBase64": base64.b64encode(audio_chunk).decode("ascii"),
                                    "audioMimeType": audio_mime or "audio/pcm;rate=24000",
                                })
                                if not responding_state_sent:
                                    await safe_send({"type": "status", "state": "responding"})
                                    responding_state_sent = True

                            if getattr(server_content, "turn_complete", False):
                                if not first_voice_activity_seen and not had_local_speech_since_turn:
                                    print(
                                        "ℹ️ Ignoring Gemini turn without user speech activity "
                                        f"(voice_activity={had_voice_activity_since_turn}, local_speech={had_local_speech_since_turn}, user_audio={had_user_audio_since_turn})"
                                    )
                                    reset_turn_buffers()
                                    await safe_send({"type": "status", "state": "listening"})
                                    continue

                                answer_text = str(output_transcript_text or "").strip()
                                if not answer_text and output_audio_bytes_since_turn == 0:
                                    print("ℹ️ Ignoring Gemini turn without output")
                                    reset_turn_buffers()
                                    await safe_send({"type": "status", "state": "listening"})
                                    continue

                                turn_counter += 1
                                await safe_send({
                                    "type": "turn_result",
                                    "turnId": turn_counter,
                                    "answer": answer_text,
                                    "model": GEMINI_LIVE_MODEL,
                                })
                                await safe_send({"type": "status", "state": "listening"})
                                reset_turn_buffers()
                        print("ℹ️ Gemini Live upstream stream ended")
                    except Exception as e:
                        if not stop_event.is_set():
                            print(f"⚠️ Gemini Live upstream receive error: {e}")
                        return

                recv_client_task = asyncio.create_task(receive_from_client())
                recv_gemini_task = asyncio.create_task(receive_from_gemini())

                done, pending = await asyncio.wait(
                    {recv_client_task, recv_gemini_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                completed_names = ",".join(sorted(
                    "client" if task is recv_client_task else "gemini"
                    for task in done
                ))
                print(f"ℹ️ Gemini Live loop completed by: {completed_names or 'unknown'}")

                if recv_gemini_task in done and not stop_event.is_set():
                    session_stop_event.set()
                    if not recv_client_task.done():
                        try:
                            await asyncio.wait_for(recv_client_task, timeout=0.6)
                        except asyncio.TimeoutError:
                            recv_client_task.cancel()
                            await asyncio.gather(recv_client_task, return_exceptions=True)

                if recv_client_task in done and not recv_gemini_task.done():
                    recv_gemini_task.cancel()
                    await asyncio.gather(recv_gemini_task, return_exceptions=True)

                for task in pending:
                    if task.done():
                        continue
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    if task.cancelled():
                        continue
                    error = task.exception()
                    if error:
                        print(f"⚠️ Gemini Live task ended with error: {error}")
        except Exception as e:
            if stop_event.is_set():
                break
            print(f"❌ Gemini Live session error: {e}")
            await safe_send({"type": "error", "error": str(e)})

        if stop_event.is_set():
            break

        reconnect_attempt += 1
        backoff = min(0.25 * reconnect_attempt, 1.0)
        await safe_send({"type": "status", "state": "reconnecting"})
        await asyncio.sleep(backoff)

    try:
        await websocket.close()
    except Exception:
        pass
    if session_token == ACTIVE_GEMINI_LIVE_TOKEN:
        ACTIVE_GEMINI_LIVE_TOKEN += 1
    print("🔴 Gemini Live client disconnected")

# Generate ElevenLabs single-use token
@app.get("/api/token")
async def get_token():
    if not ELEVENLABS_API_KEY:
        return JSONResponse(
            status_code=500,
            content={"error": "ELEVENLABS_API_KEY is not configured. Set it in .env."}
        )

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
