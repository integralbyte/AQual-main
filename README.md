# AQual

AQual is a browser accessibility extension that helps people read, navigate, and interact with web pages more comfortably. It combines visual controls, voice interaction, ring hardware input, and document support in one interface.

- Reading and text tools: font family, font size, font colour, text stroke, reduced text crowding, link emphasis, and pointer style adjustments.
- Reading Assist for documents: DOCX upload and a dedicated Reading Assist viewer with bionic reading support.
- Focus and clarity tools: image veil, highlight words, BeeLine line guidance, draw-on-page, and clear drawings.
- Image support: image magnifier with adjustable lens size and magnification.
- Display and colour controls: high contrast, colour vision modes, night reading mode, brightness dimming, and blue-light filtering.
- Voice workflows: Voice Commands mic control, live command handling, and Gemini Live call mode.
- Live speech features: realtime transcription options with ElevenLabs or local Whisper.
- Context-aware assistance: Gemini Live requests include current tab screenshot context for page-aware responses.
- AQual Ring integration: pair and manage ring input with configurable actions for Right, Left, Bottom, Top, Centre, and Home buttons.
- Ring action customisation: map ring buttons to accessibility toggles, Gemini and mic actions, utility actions, and key-command triggers.
- Utilities: quick page screenshot capture and print-page action.
- Keyboard shortcuts: built-in quick toggles for selected features such as image veil, highlight words, magnifier, and BeeLine guidance.

## Project layout

- `extension/` contains the unpacked Chrome extension, grouped into popup, content, background, pages, and assets.
- `servers/` contains the audio and document backends. Server configuration stays in the repository-root `.env` file.
- `scripts/` contains local server commands and extension checks.
- `docs/` contains README images and saved reference pages.

## Load the extension

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `extension/` folder inside this repository.
The repository root is not the extension directory. If you previously loaded the root, disable that entry before loading `extension/`.
A different unpacked directory can get a different extension ID, so Chrome may ask for microphone or ring permissions again and show default settings.

Run `python3 scripts/check_extension.py` from the repository root to check packaged paths and JavaScript syntax. Node.js is required for the syntax checks.

## Local servers

From the repository root, create a Python virtual environment in `.venv`, install `servers/audio/requirements.txt` and `servers/bionic/requirements.txt`, and configure `.env` using `.env.example`.
The local Whisper backend uses MLX and requires Apple Silicon. The document backend also requires `lxml`.
With dependencies and configuration ready, `bash scripts/dev_servers.sh start` runs the servers; `status`, `logs`, and `stop` manage them.
The extension connects to the audio server on port 8000 and the document server on port 8080. Keep `.env` outside `extension/` and do not package it.
