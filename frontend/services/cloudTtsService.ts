/**
 * Cloud TTS Service — Google Cloud Text-to-Speech API
 *
 * Uses service account JWT auth (server-side only).
 * 3-project failover with automatic rotation on quota/error.
 * Models: VECTOR → gemini-2.5-flash-lite-preview-tts, PRIME → gemini-2.5-pro-preview-tts
 * Audio: LINEAR16 24kHz PCM (for WebAudio decodeAudioData compatibility)
 */

import type { TextToSpeechClient } from '@google-cloud/text-to-speech';

// --------------- Types ---------------

export type TtsEngine = 'VECTOR' | 'PRIME';

export interface CloudTtsSynthesizeParams {
  text: string;
  voice?: string | undefined;
  engine: TtsEngine;
  language?: string | undefined;
  speed?: number | undefined;
  /** Optional multi-speaker config (max 2 speakers for Gemini built-in) */
  multiSpeaker?: Array<{ speaker: string; voice: string }> | undefined;
  /** Optional prompt/style hint */
  prompt?: string | undefined;
}

export interface CloudTtsSynthesizeResult {
  audioContent: Buffer;
  contentType: string;
  model: string;
  projectId: string;
}

// --------------- Constants ---------------

const VALID_VOICE_NAMES = new Set([
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe',
  'Callirrhoe', 'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux',
  'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel',
  'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
]);

const ENGINE_MODELS: Record<TtsEngine, { primary: string; fallback: string }> = {
  VECTOR: {
    primary: 'gemini-2.5-flash-lite-preview-tts',
    fallback: 'gemini-2.5-flash-preview-tts',
  },
  PRIME: {
    primary: 'gemini-2.5-pro-preview-tts',
    fallback: 'gemini-2.5-flash-preview-tts',
  },
};

const MAX_TEXT_LENGTH = 3000;
const DEFAULT_VOICE = 'Kore';

// --------------- GCP Project Pool ---------------

interface GcpProject {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const loadProjectPool = (): GcpProject[] => {
  const projects: GcpProject[] = [];

  // Primary
  const p1 = {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID ?? '',
    clientEmail: process.env.GOOGLE_CLOUD_CLIENT_EMAIL ?? '',
    privateKey: (process.env.GOOGLE_CLOUD_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  };
  if (p1.projectId && p1.clientEmail && p1.privateKey) projects.push(p1);

  // Backup 1
  const p2 = {
    projectId: process.env.GCP_TTS_BACKUP1_PROJECT_ID ?? '',
    clientEmail: process.env.GCP_TTS_BACKUP1_CLIENT_EMAIL ?? '',
    privateKey: (process.env.GCP_TTS_BACKUP1_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  };
  if (p2.projectId && p2.clientEmail && p2.privateKey) projects.push(p2);

  // Backup 2
  const p3 = {
    projectId: process.env.GCP_TTS_BACKUP2_PROJECT_ID ?? '',
    clientEmail: process.env.GCP_TTS_BACKUP2_CLIENT_EMAIL ?? '',
    privateKey: (process.env.GCP_TTS_BACKUP2_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  };
  if (p3.projectId && p3.clientEmail && p3.privateKey) projects.push(p3);

  return projects;
};

// --------------- Client Cache ---------------

const clientCache = new Map<string, TextToSpeechClient>();

const buildClient = async (project: GcpProject): Promise<TextToSpeechClient> => {
  const cached = clientCache.get(project.projectId);
  if (cached) return cached;

  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  const client = new TextToSpeechClient({
    projectId: project.projectId,
    credentials: {
      client_email: project.clientEmail,
      private_key: project.privateKey,
    },
  });
  clientCache.set(project.projectId, client);
  return client;
};

// --------------- Validation ---------------

const sanitizeVoice = (v: string): string => {
  const capitalized = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return VALID_VOICE_NAMES.has(capitalized) ? capitalized : DEFAULT_VOICE;
};

const sanitizeText = (text: string): string => {
  return text
    .replace(/["`${}]/g, '')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isQuotaError = (err: unknown): boolean => {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
};

const isModelUnavailableError = (err: unknown): boolean => {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('not supported') ||
    msg.includes('unavailable') ||
    msg.includes('deprecated')
  );
};

// --------------- Core Synthesis ---------------

const synthesizeWithClient = async (
  client: TextToSpeechClient,
  params: CloudTtsSynthesizeParams,
  model: string,
): Promise<Buffer> => {
  const text = sanitizeText(params.text);
  if (!text) throw new Error('Text is empty after sanitization.');

  const language = params.language ?? 'en-US';
  const isMultiSpeaker = params.multiSpeaker && params.multiSpeaker.length > 0;
  const cappedConfigs = params.multiSpeaker?.slice(0, 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceParams: Record<string, any> = {
    languageCode: language,
    modelName: model,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputParams: Record<string, any> = {
    text,
  };

  if (params.prompt) {
    inputParams.prompt = params.prompt.slice(0, 4000);
  }

  if (isMultiSpeaker && cappedConfigs) {
    voiceParams.multiSpeakerVoiceConfig = {
      speakerVoiceConfigs: cappedConfigs.map((sc) => ({
        speakerAlias: sc.speaker.replace(/\s+/g, ''),
        speakerId: sanitizeVoice(sc.voice),
      })),
    };
  } else {
    voiceParams.name = sanitizeVoice(params.voice ?? DEFAULT_VOICE);
  }

  const [response] = await client.synthesizeSpeech({
    input: inputParams,
    voice: voiceParams,
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 24000,
      speakingRate: clamp(params.speed ?? 1.0, 0.7, 1.3),
    },
  });

  if (!response.audioContent) {
    throw new Error('Cloud TTS returned no audio content.');
  }

  return Buffer.from(response.audioContent as Uint8Array);
};

// --------------- Public API ---------------

/**
 * Synthesize speech via Google Cloud TTS API with 3-project failover
 * and model fallback (primary model → fallback model per engine).
 */
export const synthesize = async (
  params: CloudTtsSynthesizeParams,
): Promise<CloudTtsSynthesizeResult> => {
  const projects = loadProjectPool();
  if (projects.length === 0) {
    throw new Error('No Google Cloud TTS credentials configured.');
  }

  const { primary, fallback } = ENGINE_MODELS[params.engine];
  const modelsToTry = [primary, fallback];

  let lastError: Error | null = null;

  for (const project of projects) {
    const client = await buildClient(project);

    for (const model of modelsToTry) {
      try {
        const audioContent = await synthesizeWithClient(client, params, model);
        return {
          audioContent,
          contentType: 'audio/wav',
          model,
          projectId: project.projectId,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[CloudTTS] ${project.projectId}/${model} failed:`,
          lastError.message,
        );

        // If model unavailable, try fallback model on same project
        if (isModelUnavailableError(err)) continue;

        // If quota error, try next project immediately
        if (isQuotaError(err)) break;

        // Other errors: try fallback model, then next project
        continue;
      }
    }
  }

  throw new Error(
    `All Cloud TTS projects exhausted. Last error: ${lastError?.message ?? 'unknown'}`,
  );
};

/**
 * Check if the Cloud TTS service is configured (has at least one project).
 */
export const isConfigured = (): boolean => {
  return loadProjectPool().length > 0;
};

export { MAX_TEXT_LENGTH, VALID_VOICE_NAMES, ENGINE_MODELS };
