export class ElevenLabsProvider {
  constructor({ apiKey, model = "scribe_v1", baseUrl = "https://api.elevenlabs.io" } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async transcribe({ audioBlob, mimeType }) {
    void audioBlob;
    void mimeType;
    throw new Error(
      "ElevenLabs STT template only. Wire up the API call here when speech features are enabled."
    );
  }
}
