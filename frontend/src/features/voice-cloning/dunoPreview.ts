import { buildBase64DataUrl, blobToBase64 } from '../../shared/audio/base64';
import { audioBufferToWav } from '../../shared/audio/wav';
import { generateSpeech } from '../../../services/geminiService';
import type { GenerationSettings } from '../../../types';

export interface DunoClonePreviewInput {
  backendBaseUrl?: string | undefined;
  voiceId: string;
  voiceName: string;
  voiceModel?: string | undefined;
}

const buildPreviewSettings = (input: DunoClonePreviewInput): GenerationSettings => ({
  engine: 'DUNO',
  voiceId: String(input.voiceId || '').trim(),
  speed: 1,
  pitch: 'Medium',
  language: 'en',
  emotion: 'Neutral',
  style: '',
  helperProvider: 'GEMINI',
  mediaBackendUrl: String(input.backendBaseUrl || '').trim(),
  voiceModel: String(input.voiceModel || '').trim(),
  runtimeProvider: 'DUNO',
} as GenerationSettings);

export const buildDunoClonePreviewUrl = async (input: DunoClonePreviewInput): Promise<string> => {
  const voiceId = String(input.voiceId || '').trim();
  const voiceName = String(input.voiceName || voiceId || 'voice').trim() || 'voice';
  if (!voiceId && !voiceName) {
    return '';
  }

  try {
    const previewText = `Hello, this is a preview of ${voiceName}.`;
    const previewSettings = buildPreviewSettings({
      ...input,
      voiceId,
      voiceName,
    });
    const audioBuffer = await generateSpeech(
      previewText,
      voiceName,
      previewSettings,
      'speech',
      undefined,
      {
        context: 'preview',
        preferLiveChunks: true,
        requestId: `duno-clone-preview:${voiceId || voiceName}`.replace(/\s+/g, '_'),
      }
    );
    const wavBlob = audioBufferToWav(audioBuffer);
    const audioBase64 = await blobToBase64(wavBlob);
    return buildBase64DataUrl(audioBase64, wavBlob.type || 'audio/wav');
  } catch {
    return '';
  }
};
