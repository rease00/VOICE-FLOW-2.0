class F5OnnxService {
  async generate(_text: string): Promise<AudioBuffer> {
    throw new Error(
      "Local WebGPU F5 runtime is unavailable in this build. Use GEM or KOKORO runtime engines."
    );
  }
}

export const f5OnnxEngine = new F5OnnxService();
