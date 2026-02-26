import { KokoroTTS } from "kokoro-js";

type KokoroProgressData = {
  status?: string;
  progress?: number;
  file?: string;
};

class KokoroService {
  private model: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private activeDevice: "webgpu" | "wasm" = "wasm";
  private static readonly MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
  private static readonly HINDI_VOICES = new Set(["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]);
  private static readonly VIRAMA = "\u094d";
  private static readonly ANUSVARA = "\u0902";
  private static readonly CHANDRABINDU = "\u0901";
  private static readonly VISARGA = "\u0903";

  private static readonly DEVANAGARI_TO_ROMAN: Record<string, string> = {
    "\u0905": "a",
    "\u0906": "aa",
    "\u0907": "i",
    "\u0908": "ii",
    "\u0909": "u",
    "\u090a": "uu",
    "\u090f": "e",
    "\u0910": "ai",
    "\u0913": "o",
    "\u0914": "au",
    "\u090b": "ri",
    "\u0915": "k",
    "\u0916": "kh",
    "\u0917": "g",
    "\u0918": "gh",
    "\u0919": "ng",
    "\u091a": "ch",
    "\u091b": "chh",
    "\u091c": "j",
    "\u091d": "jh",
    "\u091e": "ny",
    "\u091f": "t",
    "\u0920": "th",
    "\u0921": "d",
    "\u0922": "dh",
    "\u0923": "n",
    "\u0924": "t",
    "\u0925": "th",
    "\u0926": "d",
    "\u0927": "dh",
    "\u0928": "n",
    "\u092a": "p",
    "\u092b": "ph",
    "\u092c": "b",
    "\u092d": "bh",
    "\u092e": "m",
    "\u092f": "y",
    "\u0930": "r",
    "\u0932": "l",
    "\u0935": "v",
    "\u0936": "sh",
    "\u0937": "sh",
    "\u0938": "s",
    "\u0939": "h",
    "\u0958": "q",
    "\u0959": "kh",
    "\u095a": "gh",
    "\u095b": "z",
    "\u095c": "r",
    "\u095d": "rh",
    "\u095e": "f",
    "\u095f": "y",
  };

  private static readonly DEVANAGARI_MATRAS: Record<string, string> = {
    "\u093e": "aa",
    "\u093f": "i",
    "\u0940": "ii",
    "\u0941": "u",
    "\u0942": "uu",
    "\u0943": "ri",
    "\u0947": "e",
    "\u0948": "ai",
    "\u094b": "o",
    "\u094c": "au",
    "\u0946": "e",
    "\u094a": "o",
  };

  private static readonly HINDI_DIGITS: Record<string, string> = {
    "0": "shunya",
    "1": "ek",
    "2": "do",
    "3": "teen",
    "4": "chaar",
    "5": "paanch",
    "6": "chhe",
    "7": "saat",
    "8": "aath",
    "9": "nau",
  };

  private getAudioContext(): AudioContext {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext is not supported in this browser.");
    }
    return new AudioContextClass();
  }

  private createAudioBuffer(audio: any): AudioBuffer {
    const ctx = this.getAudioContext();
    const sampleRate = Number(audio?.sampling_rate) || 24000;
    const data = audio?.data instanceof Float32Array ? audio.data : null;

    if (!data || data.length === 0) {
      throw new Error("Kokoro returned empty audio data.");
    }

    const buffer = ctx.createBuffer(1, data.length, sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
  }

  private normalizeProgressData(data: any): KokoroProgressData {
    return {
      status: typeof data?.status === "string" ? data.status : undefined,
      progress: typeof data?.progress === "number" ? data.progress : undefined,
      file: typeof data?.file === "string" ? data.file : undefined,
    };
  }

  private containsDevanagari(text: string): boolean {
    return /[\u0900-\u097F]/.test(text);
  }

  private normalizeHindiText(text: string): string {
    return text
      .normalize("NFC")
      .replace(/[\u200c\u200d]/g, "")
      .replace(/\u0964|\u0965/g, ". ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private expandDigitsForHindiRomanization(text: string): string {
    return text.replace(/[0-9]/g, (d) => KokoroService.HINDI_DIGITS[d] || d);
  }

  private transliterateHindiToRoman(text: string): string {
    const source = this.expandDigitsForHindiRomanization(text);
    let out = "";

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];

      if (ch === KokoroService.ANUSVARA || ch === KokoroService.CHANDRABINDU) {
        out += "n";
        continue;
      }
      if (ch === KokoroService.VISARGA) {
        out += "h";
        continue;
      }

      const base = KokoroService.DEVANAGARI_TO_ROMAN[ch];
      if (!base) {
        out += ch;
        continue;
      }

      const next = source[i + 1];
      if (next === KokoroService.VIRAMA) {
        out += base;
        i += 1;
        continue;
      }

      const matra = KokoroService.DEVANAGARI_MATRAS[next];
      if (matra) {
        out += base + matra;
        i += 1;
        continue;
      }

      out += base + "a";
    }

    return out
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
  }

  private prepareTextForKokoro(text: string): { preparedText: string; isHindi: boolean } {
    const normalized = this.normalizeHindiText(text);
    if (!this.containsDevanagari(normalized)) {
      return { preparedText: normalized, isHindi: false };
    }

    // Kokoro tokenizer/phonemizer is optimized for Latin input.
    // For Hindi script input, transliterate first to keep tokenization stable.
    const romanized = this.transliterateHindiToRoman(normalized);
    return { preparedText: romanized, isHindi: true };
  }

  private splitForStableTokenization(text: string, isHindi: boolean): string[] {
    const units = text.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [text];
    const maxLen = isHindi ? 180 : 220;
    const chunks: string[] = [];
    let current = "";

    for (const unit of units) {
      if (!current) {
        current = unit;
        continue;
      }
      const next = `${current} ${unit}`.trim();
      if (next.length <= maxLen) {
        current = next;
      } else {
        chunks.push(current);
        current = unit;
      }
    }

    if (current) chunks.push(current);
    return chunks.filter((chunk) => chunk.length > 0);
  }

  private hasValidAudio(audio: any): boolean {
    return Boolean(audio?.data instanceof Float32Array && audio.data.length > 0);
  }

  private pickVoiceForLanguage(voiceId: string, isHindi: boolean): string {
    if (!isHindi) return voiceId;
    if (KokoroService.HINDI_VOICES.has(voiceId)) return voiceId;
    return "hf_alpha";
  }

  private async generateWithTokenizerFallback(
    model: KokoroTTS,
    preparedText: string,
    voice: string,
    speed: number
  ): Promise<any | null> {
    const tokenizer = (model as any).tokenizer;
    const generateFromIds = (model as any).generate_from_ids;
    if (!tokenizer || typeof generateFromIds !== "function") return null;

    const encoded = await tokenizer(preparedText, { truncation: true });
    const inputIds = encoded?.input_ids;
    const dims = inputIds?.dims;
    const tokenCount = Array.isArray(dims) && dims.length > 0 ? Number(dims[dims.length - 1]) : 0;
    if (!tokenCount || tokenCount <= 2) return null;

    return await generateFromIds.call(model, inputIds, { voice, speed });
  }

  private mergeChunkAudio(chunks: Float32Array[]): { data: Float32Array; sampling_rate: number } {
    const total = chunks.reduce((sum, part) => sum + part.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;

    for (const part of chunks) {
      merged.set(part, offset);
      offset += part.length;
    }

    return { data: merged, sampling_rate: 24000 };
  }

  async loadModel(onProgress?: (data: KokoroProgressData) => void): Promise<KokoroTTS> {
    if (this.model) return this.model;
    if (this.loadingPromise) return this.loadingPromise;

    const progressCallback = (data: any) => {
      if (onProgress) onProgress(this.normalizeProgressData(data));
    };

    this.loadingPromise = (async () => {
      try {
        this.activeDevice = "webgpu";
        this.model = await KokoroTTS.from_pretrained(KokoroService.MODEL_ID, {
          dtype: "fp32",
          device: "webgpu",
          progress_callback: progressCallback,
        });
      } catch (gpuErr) {
        this.activeDevice = "wasm";
        this.model = await KokoroTTS.from_pretrained(KokoroService.MODEL_ID, {
          dtype: "q8",
          device: "wasm",
          progress_callback: progressCallback,
        });
      }

      return this.model;
    })();

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  async synthesize(text: string, voiceId: string, speed: number = 1): Promise<AudioBuffer> {
    const model = await this.loadModel();
    const { preparedText, isHindi } = this.prepareTextForKokoro(text);
    const selectedVoice = this.pickVoiceForLanguage(voiceId, isHindi);
    const chunks = this.splitForStableTokenization(preparedText, isHindi);
    const audioChunks: Float32Array[] = [];

    for (const chunk of chunks) {
      let audio = await model.generate(chunk, {
        voice: selectedVoice as any,
        speed,
      });

      if (!this.hasValidAudio(audio) && isHindi) {
        const fallback = await this.generateWithTokenizerFallback(model, chunk, selectedVoice, speed);
        if (fallback) audio = fallback;
      }

      if (!this.hasValidAudio(audio)) {
        throw new Error("Kokoro returned empty audio data.");
      }

      audioChunks.push((audio as any).data as Float32Array);
    }

    return this.createAudioBuffer(this.mergeChunkAudio(audioChunks));
  }

  getDevice(): "webgpu" | "wasm" {
    return this.activeDevice;
  }
}

export const kokoroService = new KokoroService();
