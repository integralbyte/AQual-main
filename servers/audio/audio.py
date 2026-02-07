import os
import sys

# 1. SILENCE THE LOGS (Must be done before imports)
os.environ["TQDM_DISABLE"] = "1"         # Kills progress bars
os.environ["MQ_LOG_LEVEL"] = "ERROR"     # Mutes internal MLX logs

import time
import pyaudio
import numpy as np
import mlx_whisper
import webrtcvad
import threading
import queue

# --- Configuration ---
MODEL_NAME = "mlx-community/whisper-tiny"
RATE = 16000
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1

# --- Tuning ---
TRANSCRIPTION_INTERVAL = 0.25  # Update every 250ms
SILENCE_TIMEOUT = 0.6          # Reset sentence after 0.6s silence
NOISE_THRESHOLD = 0.01         # Ignore audio quieter than this (0.0 to 1.0)

# --- The Black Hole (Swallows stderr/stdout) ---
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

class CleanTranscriber:
    def __init__(self):
        self.q = queue.Queue()
        self.vad = webrtcvad.Vad(3) # Level 3 = Aggressive filtering
        self.running = True
        self.p = pyaudio.PyAudio()

    def record_loop(self):
        """Captures audio in standard chunks"""
        stream = self.p.open(format=FORMAT, channels=CHANNELS, rate=RATE, input=True, frames_per_buffer=CHUNK)
        # 480 samples = 30ms @ 16kHz (Required by WebRTCVAD)
        vad_chunk = 480 
        
        while self.running:
            try:
                data = stream.read(vad_chunk, exception_on_overflow=False)
                self.q.put(data)
            except:
                break
        stream.stop_stream()
        stream.close()

    def is_garbage(self, text):
        """Detects hallucinations (e.g. '就就就' or 'You You You')"""
        if not text: return True
        # If text is long (>10 chars) but has very few unique chars (<5), it's a loop.
        if len(text) > 10 and len(set(text)) < 5:
            return True
        return False

    def main_loop(self):
        # Initial Model Load (Hidden)
        print("⚡️ Initializing M4 Engine (please wait)...")
        with NoPrints():
            warmup = np.zeros(16000, dtype=np.float32)
            mlx_whisper.transcribe(warmup, path_or_hf_repo=MODEL_NAME)
        
        # Clear terminal
        print("\033c", end="") 
        print(f"✅ Live. Speak now.\n")

        t = threading.Thread(target=self.record_loop)
        t.daemon = True
        t.start()

        audio_buffer = b""
        last_transcribe = time.time()
        last_voice = time.time()
        current_line = ""

        while self.running:
            # 1. Drain Queue
            chunks = []
            while not self.q.empty():
                chunks.append(self.q.get())
            
            if not chunks:
                time.sleep(0.01)
                continue

            # 2. VAD & Energy Check
            is_speech = False
            for chunk in chunks:
                # Energy Check (Noise Gate)
                # Convert bytes to int16 array to check amplitude
                chunk_np = np.frombuffer(chunk, dtype=np.int16)
                max_amp = np.abs(chunk_np).max() / 32768.0
                
                if max_amp > NOISE_THRESHOLD:
                    try:
                        if self.vad.is_speech(chunk, RATE):
                            is_speech = True
                            last_voice = time.time()
                    except: pass
                
                audio_buffer += chunk

            # 3. Handle Silence (End of Sentence)
            if time.time() - last_voice > SILENCE_TIMEOUT:
                if current_line:
                    print(f"\r> {current_line}") # Print final line
                    current_line = ""
                    audio_buffer = b"" # Hard reset
                
                # Keep buffer small to prevent memory creep
                if len(audio_buffer) > RATE * 5 * 2: # 5 seconds
                    audio_buffer = b""
                
                continue

            # 4. Transcribe Interval
            if time.time() - last_transcribe > TRANSCRIPTION_INTERVAL:
                # Prepare Audio
                if len(audio_buffer) > 0:
                    data_np = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
                    
                    # Only transcribe if audio is long enough (>0.1s)
                    if len(data_np) > 1600: 
                        with NoPrints():
                            result = mlx_whisper.transcribe(
                                data_np, 
                                path_or_hf_repo=MODEL_NAME, 
                                language="en", # Force English
                                verbose=False
                            )
                        
                        text = result["text"].strip()
                        
                        # Filter out garbage/hallucinations
                        if not self.is_garbage(text):
                            current_line = text
                            # Print in-place with padding to erase old longer words
                            sys.stdout.write(f"\r> {text}" + " " * 20) 
                            sys.stdout.flush()

                last_transcribe = time.time()

if __name__ == "__main__":
    try:
        app = CleanTranscriber()
        app.main_loop()
    except KeyboardInterrupt:
        print("\nStopped.")