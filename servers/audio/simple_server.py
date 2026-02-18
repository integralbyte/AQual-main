from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
import httpx
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from servers.config import get_env

ELEVENLABS_API_KEY = get_env("ELEVENLABS_API_KEY", "")

app = FastAPI()

@app.get("/api/token")
async def get_token():
    if not ELEVENLABS_API_KEY:
        return JSONResponse(
            status_code=500,
            content={"error": "ELEVENLABS_API_KEY is not configured. Set it in .env."}
        )

    async with httpx.AsyncClient() as client:
        # Try primary endpoint
        url = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"
        print(f"Trying: {url}")

        response = await client.post(
            url,
            headers={"xi-api-key": ELEVENLABS_API_KEY}
        )
        print(f"Response: {response.status_code} - {response.text}")

        if response.status_code == 200:
            return response.json()

        # Try alternative endpoint format
        url2 = "https://api.elevenlabs.io/v1/tokens/single-use/realtime_scribe"
        print(f"Trying alternative: {url2}")

        response2 = await client.post(
            url2,
            headers={"xi-api-key": ELEVENLABS_API_KEY}
        )
        print(f"Response2: {response2.status_code} - {response2.text}")

        if response2.status_code == 200:
            return response2.json()

        return JSONResponse(
            status_code=response.status_code,
            content={"error": response.text, "tried": [url, url2]}
        )

@app.get("/")
async def get():
    return HTMLResponse(Path(__file__).with_name("index.html").read_text(encoding="utf-8"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
