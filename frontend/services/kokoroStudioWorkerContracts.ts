export type KokoroStudioWorkerErrorCode = 'UNSUPPORTED_BROWSER' | 'RUNTIME_ERROR' | 'ABORTED';

export interface KokoroStudioWorkerInitPayload {
  backendBaseUrl: string;
  voiceId: string;
  language?: string;
  speed?: number;
}

export interface KokoroStudioWorkerSynthesizePayload extends KokoroStudioWorkerInitPayload {
  text: string;
}

interface KokoroStudioWorkerEnvelope {
  requestId: string;
}

export interface KokoroStudioWorkerInitRequest extends KokoroStudioWorkerEnvelope {
  type: 'init';
  payload: KokoroStudioWorkerInitPayload;
}

export interface KokoroStudioWorkerSynthesizeRequest extends KokoroStudioWorkerEnvelope {
  type: 'synthesize';
  payload: KokoroStudioWorkerSynthesizePayload;
}

export interface KokoroStudioWorkerCancelRequest extends KokoroStudioWorkerEnvelope {
  type: 'cancel';
  targetRequestId: string;
}

export type KokoroStudioWorkerRequest =
  | KokoroStudioWorkerInitRequest
  | KokoroStudioWorkerSynthesizeRequest
  | KokoroStudioWorkerCancelRequest;

export interface KokoroStudioWorkerProgressResponse extends KokoroStudioWorkerEnvelope {
  type: 'progress';
  payload: {
    progressPct: number;
    stage: string;
    threadBudget: number;
  };
}

export interface KokoroStudioWorkerChunkResponse extends KokoroStudioWorkerEnvelope {
  type: 'chunk';
  payload: {
    index: number;
    text: string;
    durationMs: number;
    sampleRate: number;
    contentType: 'audio/wav';
    audioBase64: string;
  };
}

export interface KokoroStudioWorkerInitDoneResponse extends KokoroStudioWorkerEnvelope {
  type: 'init-done';
  payload: {
    threadBudget: number;
  };
}

export interface KokoroStudioWorkerDoneResponse extends KokoroStudioWorkerEnvelope {
  type: 'done';
  payload: {
    sampleRate: number;
    mergedAudio: ArrayBuffer;
    threadBudget: number;
  };
}

export interface KokoroStudioWorkerErrorResponse extends KokoroStudioWorkerEnvelope {
  type: 'error';
  error: {
    code: KokoroStudioWorkerErrorCode;
    message: string;
    recoverable: boolean;
  };
}

export type KokoroStudioWorkerResponse =
  | KokoroStudioWorkerProgressResponse
  | KokoroStudioWorkerChunkResponse
  | KokoroStudioWorkerInitDoneResponse
  | KokoroStudioWorkerDoneResponse
  | KokoroStudioWorkerErrorResponse;
