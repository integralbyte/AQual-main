export class SttProvider {
  async transcribe() {
    throw new Error("STT provider not implemented.");
  }
}

export async function createSttProvider(providerName, options = {}) {
  if (providerName === "elevenlabs") {
    return new (await import("./providers/elevenlabs.js")).ElevenLabsProvider(options);
  }
  throw new Error(`Unknown STT provider: ${providerName}`);
}
