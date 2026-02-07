from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
import httpx

ELEVENLABS_API_KEY = ""

app = FastAPI()

@app.get("/api/token")
async def get_token():
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
