'use strict';

const env = {
  backend: 'stub',
  logLevel: 'warning',
  wasm: {},
};

class InferenceSession {
  static async create() {
    throw new Error('onnxruntime-node stub was loaded in the Cloudflare build.');
  }
}

const stub = {
  env,
  InferenceSession,
};

module.exports = {
  ...stub,
  default: stub,
};
