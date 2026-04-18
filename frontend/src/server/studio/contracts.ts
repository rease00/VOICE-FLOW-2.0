export type { DomainJobStatus as ReaderJobStatus } from '../jobs/domainJobStore';
export type { ReaderNovelJobRequest, ReaderNovelJobResponse } from '../audioNovel/contracts';

export interface ReaderModernizeRequest {
  text: string;
  targetLanguage: string;
}

export interface ReaderModernizeResponse {
  translatedText: string;
  model: string;
  style: 'modern-audiobook';
}

export interface ReaderSpeakerConfig {
  speaker: string;
  voice: string;
}

export interface ReaderStudioSynthesizeRequest {
  mode?: 'studio' | undefined;
  text: string;
  requestId?: string | undefined;
  language?: string | undefined;
  voice?: string | undefined;
  engine?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
  speakerConfigs?: ReaderSpeakerConfig[] | undefined;
}

export interface ReaderStudioExportDriveRequest {
  fileName?: string | undefined;
  mimeType?: string | undefined;
  googleAccessToken: string;
  audioBase64: string;
}

export interface ReaderStudioExportDriveResponse {
  fileId: string;
  fileName: string;
  webViewLink?: string | undefined;
}
