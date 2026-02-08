/**
 * TTS Provider Abstraction Layer
 *
 * TTSエンジンの抽象化インターフェース。
 * COEIROINK実装をデフォルトとし、VOICEVOX等への拡張を可能にする。
 */

/**
 * Base TTS Provider interface.
 * Subclasses must implement: listSpeakers(), synthesize(), healthcheck()
 */
export class TtsProvider {
  constructor(name, baseUrl) {
    this.name = name;
    this.baseUrl = baseUrl;
  }

  /** @returns {Promise<Array<{ name: string, uuid: string, styles: Array<{ id: number, name: string }> }>>} */
  async listSpeakers() {
    throw new Error("Not implemented: listSpeakers");
  }

  /**
   * @param {string} text
   * @param {{ speakerUuid: string, styleId: number, speed?: number }} params
   * @returns {Promise<ArrayBuffer>} WAV audio data
   */
  async synthesize(_text, _params) {
    throw new Error("Not implemented: synthesize");
  }

  /** @returns {Promise<boolean>} */
  async healthcheck() {
    throw new Error("Not implemented: healthcheck");
  }

  /**
   * Find speaker by name (case-insensitive).
   * @param {string} speakerName
   * @returns {Promise<{ speakerUuid: string, styleId: number, speakerName: string, styleName: string }>}
   */
  async findSpeaker(speakerName) {
    const speakers = await this.listSpeakers();

    for (const speaker of speakers) {
      if (speaker.name.toUpperCase() === speakerName.toUpperCase()) {
        const firstStyle = speaker.styles[0];
        return {
          speakerUuid: speaker.uuid,
          styleId: firstStyle.id,
          speakerName: speaker.name,
          styleName: firstStyle.name,
        };
      }
    }

    throw new Error(`Speaker not found: ${speakerName} (provider: ${this.name})`);
  }
}

/**
 * COEIROINK TTS Provider
 */
export class CoeiroinkProvider extends TtsProvider {
  constructor(baseUrl = "http://localhost:50032") {
    super("COEIROINK", baseUrl);
  }

  async listSpeakers() {
    const response = await fetch(`${this.baseUrl}/v1/speakers`);
    if (!response.ok) {
      throw new Error(`Failed to get speakers: ${response.status}`);
    }

    const speakers = await response.json();
    return speakers.map((s) => ({
      name: s.speakerName,
      uuid: s.speakerUuid,
      styles: s.styles.map((st) => ({ id: st.styleId, name: st.styleName })),
    }));
  }

  async synthesize(text, params) {
    const payload = {
      speakerUuid: params.speakerUuid,
      styleId: params.styleId,
      text,
      speedScale: params.speed ?? 1.3,
    };

    const response = await fetch(`${this.baseUrl}/v1/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Speech generation failed: ${response.status} - ${errorText}`);
    }

    return await response.arrayBuffer();
  }

  async healthcheck() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/speakers`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * VOICEVOX TTS Provider (Stub)
 * VOICEVOX API互換エンジン用の実装スタブ。
 */
export class VoicevoxProvider extends TtsProvider {
  constructor(baseUrl = "http://localhost:50021") {
    super("VOICEVOX", baseUrl);
  }

  async listSpeakers() {
    const response = await fetch(`${this.baseUrl}/speakers`);
    if (!response.ok) {
      throw new Error(`Failed to get speakers: ${response.status}`);
    }

    const speakers = await response.json();
    return speakers.map((s) => ({
      name: s.name,
      uuid: s.speaker_uuid,
      styles: s.styles.map((st) => ({ id: st.id, name: st.name })),
    }));
  }

  async synthesize(text, params) {
    // Step 1: Audio query
    const queryUrl = new URL(`${this.baseUrl}/audio_query`);
    queryUrl.searchParams.set("text", text);
    queryUrl.searchParams.set("speaker", String(params.styleId));

    const queryRes = await fetch(queryUrl, { method: "POST" });
    if (!queryRes.ok) {
      throw new Error(`Audio query failed: ${queryRes.status}`);
    }

    const query = await queryRes.json();
    if (params.speed) {
      query.speedScale = params.speed;
    }

    // Step 2: Synthesis
    const synthUrl = new URL(`${this.baseUrl}/synthesis`);
    synthUrl.searchParams.set("speaker", String(params.styleId));

    const synthRes = await fetch(synthUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });

    if (!synthRes.ok) {
      throw new Error(`Synthesis failed: ${synthRes.status}`);
    }

    return await synthRes.arrayBuffer();
  }

  async healthcheck() {
    try {
      const response = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * OpenAI TTS Provider
 * gpt-4o-mini-tts モデルによるクラウドTTS。
 * 環境変数 OPENAI_API_KEY が必須。
 */
export class OpenaiTtsProvider extends TtsProvider {
  static VOICES = [
    "alloy", "ash", "ballad", "coral", "echo", "fable",
    "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
  ];

  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - API base URL
   * @param {string} [options.voice] - Voice name
   * @param {string} [options.model] - Model name
   * @param {string} [options.instructions] - Style instructions
   */
  constructor(options = {}) {
    super("OpenAI", options.baseUrl || "https://api.openai.com");
    this.voice = options.voice || "nova";
    this.model = options.model || "gpt-4o-mini-tts";
    this.instructions = options.instructions || "";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for OpenAI TTS provider"
      );
    }
    this.apiKey = apiKey;
  }

  async listSpeakers() {
    return OpenaiTtsProvider.VOICES.map((voice) => ({
      name: voice,
      uuid: voice,
      styles: [{ id: 0, name: "default" }],
    }));
  }

  async synthesize(text, params) {
    const voice = params.voice || this.voice;
    const speed = params.speed ?? 1.0;
    const instructions = params.instructions || this.instructions;

    const body = {
      model: this.model,
      input: text,
      voice,
      response_format: "wav",
      speed,
    };
    if (instructions) {
      body.instructions = instructions;
    }

    const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS failed: ${response.status} - ${errorText}`);
    }

    return await response.arrayBuffer();
  }

  async healthcheck() {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * OpenAI TTS では voice 名で直接指定するため、findSpeaker をオーバーライド。
   * @param {string} speakerName - voice 名
   */
  async findSpeaker(speakerName) {
    const normalized = speakerName.toLowerCase();
    if (OpenaiTtsProvider.VOICES.includes(normalized)) {
      return {
        speakerUuid: normalized,
        styleId: 0,
        speakerName: normalized,
        styleName: "default",
      };
    }
    throw new Error(
      `Unknown OpenAI voice: ${speakerName}. Available: ${OpenaiTtsProvider.VOICES.join(", ")}`
    );
  }
}

/**
 * Validate that a base URL points to localhost only (SSRF prevention).
 * @param {string} url
 * @throws {Error} if URL is not localhost
 */
function validateLocalhostUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid API base URL: ${url}`);
  }
  const allowed = ["localhost", "127.0.0.1", "::1", "[::1]"];
  if (!allowed.includes(parsed.hostname)) {
    throw new Error(
      `--api-base must be localhost (got: ${parsed.hostname}). ` +
      `Allowed hosts: ${allowed.join(", ")}`
    );
  }
}

/**
 * Create a TTS provider instance by name.
 * @param {"coeiroink" | "voicevox" | "openai"} providerName
 * @param {string} [baseUrl]
 * @param {object} [openaiOptions] - OpenAI固有オプション
 * @param {string} [openaiOptions.voice]
 * @param {string} [openaiOptions.model]
 * @param {string} [openaiOptions.instructions]
 * @returns {TtsProvider}
 */
export function createProvider(providerName = "coeiroink", baseUrl, openaiOptions = {}) {
  switch (providerName.toLowerCase()) {
    case "coeiroink":
      if (baseUrl) validateLocalhostUrl(baseUrl);
      return new CoeiroinkProvider(baseUrl);
    case "voicevox":
      if (baseUrl) validateLocalhostUrl(baseUrl);
      return new VoicevoxProvider(baseUrl);
    case "openai":
      // OpenAI: 公式API (https://api.openai.com) を使用。
      // baseUrlオーバーライドはプロキシ用途のみ想定。SSRF制約は不要。
      return new OpenaiTtsProvider({
        baseUrl,
        ...openaiOptions,
      });
    default:
      throw new Error(
        `Unknown TTS provider: ${providerName}. Supported: coeiroink, voicevox, openai`
      );
  }
}
