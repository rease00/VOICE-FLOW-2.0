

import { getAudioContext } from "./geminiService";

// The Worker Source Code as a string blob to avoid complex build steps
const WORKER_CODE = `
import { pipeline, env } from '@huggingface/transformers';

// Configure environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Singleton for the model
class TTSPipeline {
  static task = 'text-to-speech';
  static model = 'Xenova/speecht5_tts'; // High quality default, closest to F5 performance in browser
  static instance = null;
  static speaker_embeddings = 'Xenova/speecht5_speaker-embeddings';

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      // Using 'webgpu' device if available, otherwise 'wasm'
      this.instance = await pipeline(this.task, this.model, {
        dtype: 'fp32', // 'fp16' supported on some GPUs but fp32 is safer
        device: 'webgpu',
        progress_callback,
      });
    }
    return this.instance;
  }
}

// Main Message Handler
self.addEventListener('message', async (event) => {
  const { type, text, speaker_id } = event.data;

  if (type === 'load') {
    try {
      await TTSPipeline.getInstance((data) => {
        self.postMessage({ type: 'progress', data });
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
    return;
  }

  if (type === 'generate') {
    try {
      const synthesizer = await TTSPipeline.getInstance();
      
      // For SpeechT5, we need speaker embeddings
      // In a full app, we would fetch specific embeddings. 
      // Here we use a default mechanism or a fetch if provided.
      
      // Default speaker vector fetch if needed (simplified for this demo)
      // const speaker_embeddings = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin";
      const speaker_embeddings = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin";
      
      const out = await synthesizer(text, {
        speaker_embeddings,
      });

      // Send back audio data
      // Transformers.js returns { audio: Float32Array, sampling_rate: number }
      self.postMessage({
        type: 'result',
        audio: out.audio,
        sampling_rate: out.sampling_rate
      });

    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  }
});
`;

class F5OnnxService {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private progressCallback: ((data: any) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof window === 'undefined') return;

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url, { type: 'module' });

    this.worker.onmessage = (e) => {
      const { type, data, error } = e.data;
      if (type === 'progress' && this.progressCallback) {
        this.progressCallback(data);
      }
      if (type === 'error') {
        console.error("F5/Onnx Worker Error:", error);
      }
    };
  }

  public async loadModel(onProgress?: (data: any) => void): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.progressCallback = onProgress || null;

    this.readyPromise = new Promise((resolve, reject) => {
      if (!this.worker) return reject("Worker not initialized");

      const handler = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          this.worker?.removeEventListener('message', handler);
          resolve();
        }
        if (e.data.type === 'error') {
           this.worker?.removeEventListener('message', handler);
           reject(e.data.error);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'load' });
    });

    return this.readyPromise;
  }

  public async generate(text: string, speakerId: string = 'default'): Promise<AudioBuffer> {
    await this.loadModel(); // Ensure loaded

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject("Worker dead");

      const handler = (e: MessageEvent) => {
        if (e.data.type === 'result') {
          this.worker?.removeEventListener('message', handler);
          const { audio, sampling_rate } = e.data;
          resolve(this.createAudioBuffer(audio, sampling_rate));
        }
        if (e.data.type === 'error') {
          this.worker?.removeEventListener('message', handler);
          reject(e.data.error);
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'generate', text, speaker_id: speakerId });
    });
  }

  private createAudioBuffer(audioData: Float32Array, sampleRate: number): AudioBuffer {
    const ctx = getAudioContext();
    const audioBuffer = ctx.createBuffer(1, audioData.length, sampleRate);
    audioBuffer.copyToChannel(audioData, 0);
    return audioBuffer;
  }
}

// Singleton export
export const f5OnnxEngine = new F5OnnxService();