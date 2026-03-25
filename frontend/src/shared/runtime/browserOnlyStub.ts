export const env = {
  backends: {
    onnx: {
      wasm: {},
    },
  },
  logLevel: 'warning',
  wasm: {},
};

export class KokoroTTS {
  static async from_pretrained(): Promise<never> {
    throw new Error('Browser-only Kokoro module stub was loaded on the server.');
  }
}

const browserOnlyStub = function browserOnlyStub(): never {
  throw new Error('Browser-only module stub was loaded on the server.');
};

export default browserOnlyStub;
