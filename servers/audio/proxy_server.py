from pathlib import Path
"""
Server that proxies audio to ElevenLabs with proper authentication.
Browser -> This Server (WebSocket) -> ElevenLabs (WebSocket with API key header)
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import asyncio
import websockets
import json
import ssl

ELEVENLABS_API_KEY = ""
ELEVENLABS_WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=en"

app = FastAPI()

@app.websocket("/ws/elevenlabs")
async def websocket_proxy(client_ws: WebSocket):
    await client_ws.accept()
    print("Client connected")

    try:
        # Create SSL context that doesn't verify certificates
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE

        # Connect to ElevenLabs with API key in header
        headers = {"xi-api-key": ELEVENLABS_API_KEY}
        print(f"Connecting to: {ELEVENLABS_WS_URL}")
        print(f"With headers: {headers}")

        async with websockets.connect(
            ELEVENLABS_WS_URL,
            additional_headers=headers,
            ssl=ssl_context
        ) as elevenlabs_ws:
            print("Connected to ElevenLabs successfully!")

            async def forward_to_elevenlabs():
                """Forward audio from client to ElevenLabs"""
                try:
                    while True:
                        data = await client_ws.receive_text()
                        await elevenlabs_ws.send(data)
                except WebSocketDisconnect:
                    pass

            async def forward_to_client():
                """Forward transcripts from ElevenLabs to client"""
                try:
                    async for message in elevenlabs_ws:
                        print(f"From ElevenLabs: {message}")
                        await client_ws.send_text(message)
                except Exception as e:
                    print(f"Forward to client error: {e}")

            # Run both directions concurrently
            await asyncio.gather(
                forward_to_elevenlabs(),
                forward_to_client()
            )

    except Exception as e:
        print(f"Error: {e}")
        await client_ws.send_json({"error": str(e)})

@app.get("/")
async def get():
    return HTMLResponse(Path(__file__).with_name("index_proxy.html").read_text(encoding="utf-8"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
