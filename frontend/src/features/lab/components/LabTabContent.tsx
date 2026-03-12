import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  BringToFront,
  Camera,
  ChevronDown,
  ChevronLeft,
  Cpu,
  Clock3,
  Crown,
  Download,
  Film,
  GripVertical,
  Image as ImageIcon,
  Layers3,
  Mic,
  MonitorUp,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  Scissors,
  SendToBack,
  Share2,
  Shapes,
  Sparkles,
  SquareStack,
  Search,
  Trash2,
  Type,
  Undo2,
  Video,
  Waves,
} from 'lucide-react';

import type {
  GenerationSettings,
  LabAsset,
  LabCapabilityProfile,
  LabCatalogItem,
  LabCatalogKind,
  LabClip,
  LabExportFormat,
  LabExportJobState,
  LabJob,
  LabRailPanelId,
  LabRecordSource,
  LabRuntimeDefaults,
  LabRuntimeState,
  LabSeparationJobState,
  LabSession,
  LabStageTransform,
  LabTextPreset,
  LabTransition,
  LabTransitionEasing,
  LabTransitionKind,
  VoiceOption,
} from '../../../../types';
import { Button } from '../../../../components/Button';
import { BrandLogo } from '../../../../components/BrandLogo';
import { SectionCard } from '../../../../components/SectionCard';
import { UploadDropzone } from '../../../../components/ui/UploadDropzone';
import { createTtsJob } from '../../../shared/api/gatewayClient';
import { HttpError } from '../../../shared/api/httpClient';
import { readStorageJson } from '../../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { reportFrontendSignal } from '../../../shared/telemetry/frontendErrors';
import { useWorkspaceViewport } from '../../../shared/ui/useWorkspaceViewport';
import { getLabCapabilityProfile } from '../model/capabilities';
import {
  LAB_CANVAS_DIMENSION_LIMITS,
  LAB_CANVAS_PRESETS,
  formatLabAspectLabel,
  validateLabCanvasDimensions,
} from '../model/canvasPresets';
import { LAB_ELEMENT_PRESETS, LAB_TEXT_PRESETS } from '../model/visualPresets';
import { resolveLabExportExecutionMode, resolveLabRuntimeState } from '../model/orchestration';
import {
  buildClipForAsset,
  createDefaultStageTransform,
  createInitialLabState,
  getClipDurationMs,
  getSessionDurationMs,
  labReducer,
} from '../model/session';
import { decodeAudioBlobToPcmData, decodeAudioFileToPcmData, readVideoMetadata } from '../services/audioData';
import { runEncodeWavTask, runMixRenderTask, runWaveformTask, terminateMediaWorker } from '../services/mediaWorkerClient';
import {
  persistLabAssetBlob,
  persistLabCapabilities,
  persistLabPreferences,
  persistLabRuntimeDefaults,
  persistLabSessionSnapshot,
  readLabRuntimeDefaults,
  readLabAssetBlob,
  readLabPreferences,
  readLabSessionSnapshot,
  removeLabAssetBlob,
} from '../services/storage';
import {
  cancelLabExportJob,
  createLabExportJob,
  createLabSeparationJob,
  fetchLabExportArtifact,
  fetchLabExportJob,
  fetchLabRuntimeDefaults,
  fetchLabSeparationArtifact,
  fetchLabSeparationJob,
} from '../services/orchestration';
import {
  fetchImportedLabCatalogBlob,
  importLabCatalogItem,
  searchLabCatalog,
} from '../services/catalog';
import { exportLabCompositionLocally } from '../services/exportTools';
import { runStemSeparationTask, terminateSeparationWorker } from '../services/separationWorkerClient';
import {
  extractAudioFromVideoFile,
  getLabVideoAudioExtractionDisabledReason,
  isLabVideoAudioExtractionEnabled,
} from '../services/videoTools';
import type { LabPcmData } from '../workers/contracts';
import { createSynthesisTraceId, inferLanguageFromText, normalizeSynthesisRequest } from '../../../../services/synthesisContractService';
import { pollTtsGatewayJobForAudio } from '../../../../services/ttsGatewayJobService';
import { fetchEngineRuntimeVoices, getStaticVoiceFallback } from '../../../../services/ttsVoiceRegistryService';

interface LabTabContentProps {
  resolvedTheme: 'light' | 'dark';
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

interface LabRuntimeMetrics {
  hydrationMs?: number;
  waveformRenderMs?: number;
  previewRenderMs?: number;
}

interface ActiveStageEntry {
  asset: LabAsset;
  clip: LabClip;
  localTimeMs: number;
}

interface CatalogPanelState {
  items: LabCatalogItem[];
  warnings: string[];
  loading: boolean;
  error: string;
  provider: 'all' | 'openverse' | 'freesound' | 'pixabay';
  query: string;
  commercialPolicyVersion?: string;
  blockedProviders?: string[];
}

interface LabTimelineRow {
  rowId: string;
  layerOrder: number;
  clips: LabClip[];
}

interface LabTimelineTransitionBoundary {
  rowId: string;
  fromClip: LabClip;
  toClip: LabClip;
  transition: LabTransition | null;
  anchorMs: number;
}

interface RecordCaptureState {
  source: LabRecordSource;
  startedAt: number;
  mimeType: string;
}

interface TimelineViewportState {
  scrollLeft: number;
  width: number;
}

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg';
const VIDEO_ACCEPT = 'video/*,.mp4,.webm,.mov,.m4v';
const IMAGE_ACCEPT = 'image/*,.png,.jpg,.jpeg,.webp';
const MEDIA_ACCEPT = `${AUDIO_ACCEPT},${VIDEO_ACCEPT}`;
const PREVIEW_SAMPLE_RATE = 44100;
const LAB_BACKGROUND_SWATCHES = ['#0f172a', '#020617', '#111827', '#1d4ed8', '#0f766e', '#f97316', '#be123c', '#f8fafc'];
type LabTtsEngine = Exclude<GenerationSettings['engine'], 'KOKORO'>;
const LAB_DEFAULT_TTS_ENGINE: LabTtsEngine = 'GEM';
const LAB_DEFAULT_TTS_VOICE_ID = 'v1';
const LAB_TTS_ENGINE_LABELS: Record<LabTtsEngine, string> = {
  GEM: '2.5 Flash',
  NEURAL2: 'Vector',
};
const LAB_AUDIO_DISCOVERY_TAGS = ['background music', 'relaxing', 'upbeat', 'happy', 'beats', 'vlog music', 'motivation', 'funny', 'corporate', 'instrumental'];
const LAB_VISUAL_DISCOVERY_TAGS = ['background', 'travel', 'nature', 'flowers', 'sky', 'sunset', 'water', 'food', 'people', 'animals'];
const LAB_STICKER_PRESETS: Array<{ id: string; label: string; preset: LabTextPreset; text: string }> = [
  { id: 'new_episode', label: 'NEW EPISODE', preset: 'cta', text: 'NEW EPISODE' },
  { id: 'breaking', label: 'BREAKING', preset: 'cta', text: 'BREAKING' },
  { id: 'sale', label: 'SALE', preset: 'cta', text: 'SALE' },
  { id: 'subscribe', label: 'SUBSCRIBE', preset: 'lower_third', text: 'SUBSCRIBE NOW' },
];
const LAB_EMOJI_PRESETS = ['\u2728', '\ud83d\udd25', '\ud83d\udc4f', '\ud83d\ude0d', '\ud83d\ude02', '\ud83d\ude80', '\ud83c\udf89', '\ud83d\udca5'];
const LAB_GIF_QUICK_SEARCHES = [
  { id: 'celebration', label: 'Celebration loop', query: 'celebration loop' },
  { id: 'reaction', label: 'Reaction loop', query: 'reaction loop' },
  { id: 'gaming', label: 'Gaming motion', query: 'gaming motion' },
  { id: 'sports', label: 'Sports highlight', query: 'sports highlight' },
];
const AUTO_SEPARATION_QUEUE_RETRY_LIMIT = 2;
const AUTO_SEPARATION_QUEUE_RETRY_BASE_DELAY_MS = 1400;
const waitForMs = (durationMs: number): Promise<void> => (
  new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Math.round(Number(durationMs) || 0)));
  })
);
const isQueueFullHttpError = (error: unknown): boolean => {
  if (!(error instanceof HttpError)) return false;
  const detail = String(error.detail || error.message || '').trim().toLowerCase();
  return error.status === 503 && detail.includes('queue is full');
};
const LAB_PANELS: Array<{ id: LabRailPanelId; label: string; detail: string }> = [
  { id: 'media', label: 'Media', detail: 'Uploads and project library' },
  { id: 'canvas', label: 'Canvas', detail: 'All display presets and background' },
  { id: 'text', label: 'Text', detail: 'Overlay planning and copy' },
  { id: 'audio', label: 'Audio', detail: 'Voice, music, and separation tools' },
  { id: 'videos', label: 'Videos', detail: 'Video imports and extraction' },
  { id: 'images', label: 'Images', detail: 'Image slots and poster workflow' },
  { id: 'elements', label: 'Elements', detail: 'Branded scene accents' },
  { id: 'record', label: 'Record', detail: 'Audio, camera, and screen capture' },
  { id: 'tts', label: 'TTS', detail: 'Narration generation' },
];
const LAB_TEXT_EDIT_TABS = ['Text', 'Adjust', 'Background', 'Opacity', 'Time'] as const;
const LAB_TRANSITION_KINDS: Array<{ kind: LabTransitionKind; label: string }> = [
  { kind: 'cut', label: 'Cut' },
  { kind: 'crossfade', label: 'Crossfade' },
  { kind: 'fade', label: 'Fade' },
  { kind: 'wipe', label: 'Wipe' },
  { kind: 'slide', label: 'Slide' },
];
const LAB_TRANSITION_EASING_OPTIONS: Array<{ value: LabTransitionEasing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease_in', label: 'Ease In' },
  { value: 'ease_out', label: 'Ease Out' },
  { value: 'ease_in_out', label: 'Ease In/Out' },
];
const MEDIA_VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;
const MEDIA_AUDIO_EXTENSION_PATTERN = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus)$/i;

const getRailPanelIcon = (panelId: LabRailPanelId, size = 16): React.ReactNode => {
  switch (panelId) {
    case 'media':
      return <MonitorUp size={size} />;
    case 'canvas':
      return <SquareStack size={size} />;
    case 'text':
      return <Type size={size} />;
    case 'audio':
      return <Music2 size={size} />;
    case 'videos':
      return <Film size={size} />;
    case 'images':
      return <ImageIcon size={size} />;
    case 'elements':
      return <Shapes size={size} />;
    case 'record':
      return <Mic size={size} />;
    case 'tts':
      return <Waves size={size} />;
    default:
      return <Layers3 size={size} />;
  }
};

const makeId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const formatMs = (value: number): string => {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const TIMELINE_KEYBOARD_STEP_MS = 120;
const TIMELINE_KEYBOARD_FINE_STEP_MS = 40;
const TIMELINE_KEYBOARD_JUMP_STEP_MS = 1_000;
const TIMELINE_VIEWPORT_PADDING_MS = 3_500;
const shouldIgnoreEditorShortcut = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
};
const resolveTimelineRulerStepMs = (timelineDurationMs: number, timelineWidth: number, optimizeFor2Vcpu: boolean): number => {
  const pixelsPerSecond = timelineWidth / Math.max(1, timelineDurationMs / 1000);
  if (pixelsPerSecond >= 210) return 250;
  if (pixelsPerSecond >= 130) return 500;
  if (pixelsPerSecond >= 76) return 1_000;
  if (pixelsPerSecond >= 36) return 2_000;
  return optimizeFor2Vcpu ? 6_000 : 4_000;
};
const readViewportHeight = (): number => {
  if (typeof window === 'undefined') return 900;
  return Math.max(480, Math.round(window.innerHeight || 0));
};
const createCatalogPanelState = (): CatalogPanelState => ({
  items: [],
  warnings: [],
  loading: false,
  error: '',
  provider: 'all',
  query: '',
  commercialPolicyVersion: '',
  blockedProviders: [],
});

const normalizeLabTtsEngine = (value: unknown): LabTtsEngine => (
  String(value || '').trim().toUpperCase() === 'NEURAL2' ? 'NEURAL2' : LAB_DEFAULT_TTS_ENGINE
);

const dedupeVoiceOptions = (voices: VoiceOption[]): VoiceOption[] => {
  const byId = new Map<string, VoiceOption>();
  voices.forEach((voice) => {
    const voiceId = String(voice?.id || '').trim();
    if (!voiceId) return;
    const normalized: VoiceOption = {
      ...voice,
      id: voiceId,
      name: String(voice?.name || voiceId).trim() || voiceId,
    };
    byId.set(voiceId, normalized);
  });
  return Array.from(byId.values());
};

const readStoredLabTtsPreference = (): { engine: LabTtsEngine; voiceId: string } => {
  const saved = readStorageJson<Partial<GenerationSettings>>(STORAGE_KEYS.settings);
  const engine = normalizeLabTtsEngine(saved?.engine);
  const voiceId = String(saved?.voiceId || '').trim();
  return { engine, voiceId };
};

const classifyMediaImportFile = (file: File): 'audio' | 'video' | 'unknown' => {
  const mimeType = String(file.type || '').trim().toLowerCase();
  const fileName = String(file.name || '').trim().toLowerCase();
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (MEDIA_VIDEO_EXTENSION_PATTERN.test(fileName)) return 'video';
  if (MEDIA_AUDIO_EXTENSION_PATTERN.test(fileName)) return 'audio';
  return 'unknown';
};

const resolvePreferredLabTtsVoiceId = (
  voices: VoiceOption[],
  candidates: Array<string | null | undefined>
): string => {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    if (voices.some((voice) => voice.id === normalized)) return normalized;
  }
  return voices[0]?.id || LAB_DEFAULT_TTS_VOICE_ID;
};

const isVisualAssetKind = (kind: LabAsset['kind']): boolean => (
  kind === 'video' || kind === 'image' || kind === 'text' || kind === 'element' || kind === 'recording'
);

const getClipLocalTimeMs = (clip: LabClip, playheadMs: number): number => {
  const elapsedMs = Math.max(0, playheadMs - clip.startMs);
  const playbackMultiplier = Math.max(0.25, clip.playbackRate || 1);
  return clamp(
    clip.trimStartMs + Math.round(elapsedMs * playbackMultiplier),
    clip.trimStartMs,
    clip.trimEndMs
  );
};

const mixStemPcmToAudioTrack = (vocals: LabPcmData, background: LabPcmData): LabPcmData | null => {
  if (!vocals.channels.length || !background.channels.length) return null;
  if (vocals.sampleRate !== background.sampleRate) return null;
  const sampleRate = vocals.sampleRate;
  const channelCount = Math.max(vocals.channels.length, background.channels.length);
  const maxLength = Math.max(vocals.length, background.length);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || maxLength <= 0) return null;

  const channels: Float32Array[] = [];
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const vocalsChannel = vocals.channels[channelIndex]
      || vocals.channels[vocals.channels.length - 1]
      || vocals.channels[0];
    const backgroundChannel = background.channels[channelIndex]
      || background.channels[background.channels.length - 1]
      || background.channels[0];
    if (!vocalsChannel || !backgroundChannel) return null;
    const mixed = new Float32Array(maxLength);
    for (let sampleIndex = 0; sampleIndex < maxLength; sampleIndex += 1) {
      const voiceSample = (sampleIndex < vocalsChannel.length ? vocalsChannel[sampleIndex] : 0) ?? 0;
      const backgroundSample = (sampleIndex < backgroundChannel.length ? backgroundChannel[sampleIndex] : 0) ?? 0;
      mixed[sampleIndex] = clamp(voiceSample + backgroundSample, -1, 1);
    }
    channels.push(mixed);
  }
  return {
    sampleRate,
    length: maxLength,
    durationMs: Math.max(vocals.durationMs, background.durationMs, Math.round((maxLength / sampleRate) * 1000)),
    channels,
  };
};

const buildStageStyle = (transform: LabStageTransform): React.CSSProperties => ({
  position: 'absolute',
  left: `${clamp(transform.xPercent, 0, 100)}%`,
  top: `${clamp(transform.yPercent, 0, 100)}%`,
  width: `${clamp(transform.widthPercent, 4, 100)}%`,
  height: `${clamp(transform.heightPercent, 4, 100)}%`,
  opacity: clamp(transform.opacity, 0, 1),
  zIndex: Math.round(transform.zIndex || 0),
  transform: `translate(-50%, -50%) scale(${clamp(transform.scale, 0.2, 3)}) rotate(${transform.rotationDeg || 0}deg)`,
  transformOrigin: 'center center',
});

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const decodeBase64ToArrayBuffer = (value: string): ArrayBuffer => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const buildAudioAsset = (
  file: File,
  pcmData: LabPcmData,
  waveform?: LabAsset['waveform'],
  sourceAssetId?: string
): LabAsset => ({
  id: makeId('lab_asset'),
  kind: 'audio',
  name: file.name,
  mimeType: file.type || 'audio/wav',
  sizeBytes: file.size,
  durationMs: pcmData.durationMs,
  channelCount: pcmData.channels.length,
  sampleRate: pcmData.sampleRate,
  createdAt: Date.now(),
  ...(waveform ? { waveform } : {}),
  ...(sourceAssetId ? { sourceAssetId } : {}),
});

const buildVideoAsset = (
  file: File,
  durationMs: number
): LabAsset => ({
  id: makeId('lab_asset'),
  kind: 'video',
  name: file.name,
  mimeType: file.type || 'video/mp4',
  sizeBytes: file.size,
  durationMs,
  createdAt: Date.now(),
  stageTransform: createDefaultStageTransform({ kind: 'video' }),
});

const buildImageAsset = (
  file: File,
  dimensions: { width: number; height: number }
): LabAsset => ({
  id: makeId('lab_asset'),
  kind: 'image',
  name: file.name,
  mimeType: file.type || 'image/png',
  sizeBytes: file.size,
  durationMs: 8_000,
  intrinsicWidth: dimensions.width,
  intrinsicHeight: dimensions.height,
  createdAt: Date.now(),
  stageTransform: createDefaultStageTransform({ kind: 'image' }),
});

const buildTextAsset = (
  preset: LabTextPreset,
  text: string
): LabAsset => {
  const trimmedText = text.trim().replace(/\s+/g, ' ');
  return ({
  id: makeId('lab_asset'),
  kind: 'text',
  name: trimmedText.slice(0, 32) || `${preset.replace(/_/g, ' ')} text`,
  mimeType: 'application/x.voiceflow.text',
  sizeBytes: text.length,
  durationMs: 6_000,
  textStyle: {
    ...LAB_TEXT_PRESETS[preset],
    text,
  },
  createdAt: Date.now(),
  stageTransform: createDefaultStageTransform({ kind: 'text' }),
});
};

const buildElementAsset = (
  preset: keyof typeof LAB_ELEMENT_PRESETS
): LabAsset => ({
  id: makeId('lab_asset'),
  kind: 'element',
  name: preset.replace(/_/g, ' '),
  mimeType: 'application/x.voiceflow.element',
  sizeBytes: 1,
  durationMs: 8_000,
  elementStyle: {
    ...LAB_ELEMENT_PRESETS[preset],
  },
  createdAt: Date.now(),
  stageTransform: createDefaultStageTransform({ kind: 'element' }),
});

const buildRecordingAsset = (
  file: File,
  durationMs: number,
  source: LabRecordSource
): LabAsset => ({
  id: makeId('lab_asset'),
  kind: 'recording',
  name: file.name,
  mimeType: file.type || 'video/webm',
  sizeBytes: file.size,
  durationMs,
  recordSource: source,
  createdAt: Date.now(),
  stageTransform: createDefaultStageTransform({ kind: 'recording' }),
});

const toAudioFilename = (input: string, suffix: string, extension = 'wav'): string => {
  const base = input.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'lab_mix';
  const safeExtension = extension.replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'wav';
  return `${base}_${suffix}.${safeExtension}`;
};

const toVisualFilename = (suffix: string, extension: string): string => {
  const safeSuffix = suffix.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'lab';
  return `voiceflow_${safeSuffix}.${extension}`;
};

const chooseRecordMimeType = (source: LabRecordSource): string => {
  const candidates = source === 'audio'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return source === 'audio' ? 'audio/webm' : 'video/webm';
};

const extensionFromAudioMimeType = (mimeType: string): string => {
  const safe = String(mimeType || '').trim().toLowerCase();
  if (!safe) return 'wav';
  if (safe.includes('wav')) return 'wav';
  if (safe.includes('mpeg') || safe.includes('mp3')) return 'mp3';
  if (safe.includes('ogg')) return 'ogg';
  if (safe.includes('mp4') || safe.includes('aac')) return 'm4a';
  if (safe.includes('webm')) return 'webm';
  return 'wav';
};

const clipFingerprint = (session: LabSession): string => JSON.stringify({
  canvas: {
    presetId: session.canvas.presetId,
    width: session.canvas.width,
    height: session.canvas.height,
    isCustom: session.canvas.isCustom === true,
    customWidth: session.canvas.customWidth,
    customHeight: session.canvas.customHeight,
    background: session.canvas.background,
  },
  clips: session.clips.map((clip) => ({
    id: clip.id,
    assetId: clip.assetId,
    timelineRowId: clip.timelineRowId,
    layerOrder: clip.layerOrder,
    insertedAtPlayheadMs: clip.insertedAtPlayheadMs,
    startMs: clip.startMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    gain: clip.gain,
    muted: clip.muted,
    solo: clip.solo,
    playbackRate: clip.playbackRate,
    pitchSemitones: clip.pitchSemitones,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    normalize: clip.normalize,
    denoiseAmount: clip.denoiseAmount,
    eqPreset: clip.eqPreset,
    enabled: clip.enabled,
    visible: clip.visible,
    stageTransform: clip.stageTransform,
  })),
  assets: session.assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    durationMs: asset.durationMs,
    waveform: asset.waveform?.coarse.length || 0,
    text: asset.textStyle?.text || '',
    elementShape: asset.elementStyle?.shape || '',
  })),
  transitions: session.transitions.map((transition) => ({
    id: transition.id,
    kind: transition.kind,
    fromClipId: transition.fromClipId,
    toClipId: transition.toClipId,
    durationMs: transition.durationMs,
    easing: transition.easing,
    enabled: transition.enabled,
  })),
});

const renderPreviewMixForClips = async (
  clips: LabClip[],
  pcmDataByAssetId: Map<string, LabPcmData>,
  onProgress: (payload: { progressPct: number; message: string; runtime?: string }) => void,
  signal?: AbortSignal
): Promise<Blob | null> => {
  const audioClips = clips.filter((clip) => pcmDataByAssetId.has(clip.assetId));
  if (!audioClips.length) {
    return null;
  }
  const audioByAssetId = Object.fromEntries(
    Array.from(pcmDataByAssetId.entries()).map(([assetId, audio]) => [assetId, audio])
  );
  const renderResponse = await runMixRenderTask(audioClips, audioByAssetId, {
    outputSampleRate: PREVIEW_SAMPLE_RATE,
    normalizeMaster: true,
    ...(signal ? { signal } : {}),
    onProgress,
  });
  const wav = await runEncodeWavTask(renderResponse.audio);
  return wav.blob;
};

const readImageDimensions = async (file: File): Promise<{ width: number; height: number }> => {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        width: Math.max(1, image.naturalWidth || 1),
        height: Math.max(1, image.naturalHeight || 1),
      });
      image.onerror = () => reject(new Error('Unable to read image dimensions in this browser.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const LabTabContent: React.FC<LabTabContentProps> = ({ resolvedTheme, onToast }) => {
  const { mode, isPhone } = useWorkspaceViewport();
  const [state, dispatch] = useReducer(labReducer, undefined, createInitialLabState);
  const deferredSession = useDeferredValue(state.session);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const mediaImportInputRef = useRef<HTMLInputElement | null>(null);
  const audioImportInputRef = useRef<HTMLInputElement | null>(null);
  const videoImportInputRef = useRef<HTMLInputElement | null>(null);
  const imageImportInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string>('');
  const sessionRef = useRef<LabSession>(state.session);
  const playheadRef = useRef<number>(state.session.transport.playheadMs);
  const pcmDataByAssetIdRef = useRef<Map<string, LabPcmData>>(new Map());
  const urlRegistryRef = useRef<Set<string>>(new Set());
  const previewJobAbortRef = useRef<AbortController | null>(null);
  const actionJobAbortRef = useRef<AbortController | null>(null);
  const exportJobAbortRef = useRef<AbortController | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const clipButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stageVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const manualTransportOriginRef = useRef<{ startedAt: number; playheadMs: number } | null>(null);
  const recordingControllerRef = useRef<{
    recorder: MediaRecorder | null;
    streams: MediaStream[];
    chunks: BlobPart[];
    source: LabRecordSource | null;
    mimeType: string;
  }>({
    recorder: null,
    streams: [],
    chunks: [],
    source: null,
    mimeType: '',
  });
  const lastLayoutTelemetryRef = useRef<string>('');
  const lastTimelineTelemetryRef = useRef<string>('');
  const [isHydrating, setIsHydrating] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [runtimeMetrics, setRuntimeMetrics] = useState<LabRuntimeMetrics>({});
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [tabletInspectorOpen, setTabletInspectorOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<LabRailPanelId>('media');
  const [activeTextEditTab, setActiveTextEditTab] = useState<(typeof LAB_TEXT_EDIT_TABS)[number]>('Text');
  const [runtimeDefaults, setRuntimeDefaults] = useState<LabRuntimeDefaults>(() => readLabRuntimeDefaults());
  const [backendSeparationJob, setBackendSeparationJob] = useState<LabSeparationJobState | null>(null);
  const [backendExportJob, setBackendExportJob] = useState<LabExportJobState | null>(null);
  const initialLabTtsPreferenceRef = useRef(readStoredLabTtsPreference());
  const [ttsText, setTtsText] = useState('Create a clean narration clip for this timeline.');
  const [ttsEngine, setTtsEngine] = useState<LabTtsEngine>(() => initialLabTtsPreferenceRef.current.engine);
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<VoiceOption[]>(() => {
    const fallback = dedupeVoiceOptions(getStaticVoiceFallback(initialLabTtsPreferenceRef.current.engine));
    return fallback;
  });
  const [ttsVoiceId, setTtsVoiceId] = useState(() => {
    const preferred = String(initialLabTtsPreferenceRef.current.voiceId || '').trim();
    const fallback = dedupeVoiceOptions(getStaticVoiceFallback(initialLabTtsPreferenceRef.current.engine));
    return resolvePreferredLabTtsVoiceId(fallback, [preferred]);
  });
  const [textPreset, setTextPreset] = useState<LabTextPreset>('title');
  const [textDraft, setTextDraft] = useState('Big headline');
  const [customCanvasWidthDraft, setCustomCanvasWidthDraft] = useState('1080');
  const [customCanvasHeightDraft, setCustomCanvasHeightDraft] = useState('1920');
  const [customCanvasError, setCustomCanvasError] = useState('');
  const [audioSearch, setAudioSearch] = useState('');
  const [videoSearch, setVideoSearch] = useState('');
  const [imageSearch, setImageSearch] = useState('');
  const [audioCatalog, setAudioCatalog] = useState<CatalogPanelState>(() => createCatalogPanelState());
  const [videoCatalog, setVideoCatalog] = useState<CatalogPanelState>(() => createCatalogPanelState());
  const [imageCatalog, setImageCatalog] = useState<CatalogPanelState>(() => createCatalogPanelState());
  const videoExtractionEnabled = isLabVideoAudioExtractionEnabled();
  const videoExtractionDisabledReason = getLabVideoAudioExtractionDisabledReason();
  const [draggedTimelineRowId, setDraggedTimelineRowId] = useState('');
  const [draggedClipId, setDraggedClipId] = useState('');
  const [recordHint, setRecordHint] = useState('Recording tools are browser-first so backend separation capacity stays available.');
  const [recordingState, setRecordingState] = useState<RecordCaptureState | null>(null);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>(readViewportHeight);
  const [timelineSnapEnabled, setTimelineSnapEnabled] = useState(true);
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewportState>({
    scrollLeft: 0,
    width: isPhone ? 640 : mode === 'desktop' ? 920 : 780,
  });

  const isDarkUi = resolvedTheme === 'dark';
  const ttsEngineLabel = LAB_TTS_ENGINE_LABELS[ttsEngine];
  const selectedTtsVoice = useMemo(
    () => ttsVoiceOptions.find((voice) => voice.id === ttsVoiceId) || null,
    [ttsVoiceId, ttsVoiceOptions]
  );
  const capabilityProfile = useMemo<LabCapabilityProfile>(() => getLabCapabilityProfile({ runtimeMetrics }), [runtimeMetrics]);
  const activeCapabilities = state.capabilities ?? capabilityProfile;
  const selectedAsset = useMemo(
    () => state.session.assets.find((asset) => asset.id === state.selectedAssetId) || null,
    [state.selectedAssetId, state.session.assets]
  );
  const selectedClip = useMemo(
    () => state.session.clips.find((clip) => clip.id === state.selectedClipId) || null,
    [state.selectedClipId, state.session.clips]
  );
  const assetById = useMemo(
    () => new Map(state.session.assets.map((asset) => [asset.id, asset] as const)),
    [state.session.assets]
  );
  const selectedClipAsset = useMemo(
    () => (selectedClip ? assetById.get(selectedClip.assetId) || selectedAsset || null : selectedAsset || null),
    [assetById, selectedAsset, selectedClip]
  );
  const audioAssets = useMemo(
    () => state.session.assets.filter((asset) => asset.kind === 'audio'),
    [state.session.assets]
  );
  const videoAssets = useMemo(
    () => state.session.assets.filter((asset) => asset.kind === 'video' || asset.kind === 'recording'),
    [state.session.assets]
  );
  const imageAssets = useMemo(
    () => state.session.assets.filter((asset) => asset.kind === 'image'),
    [state.session.assets]
  );
  const textAssets = useMemo(
    () => state.session.assets.filter((asset) => asset.kind === 'text'),
    [state.session.assets]
  );
  const elementAssets = useMemo(
    () => state.session.assets.filter((asset) => asset.kind === 'element'),
    [state.session.assets]
  );
  const filteredAudioAssets = useMemo(
    () => audioAssets.filter((asset) => asset.name.toLowerCase().includes(audioSearch.trim().toLowerCase())),
    [audioAssets, audioSearch]
  );
  const filteredVideoAssets = useMemo(
    () => videoAssets.filter((asset) => asset.name.toLowerCase().includes(videoSearch.trim().toLowerCase())),
    [videoAssets, videoSearch]
  );
  const filteredImageAssets = useMemo(
    () => imageAssets.filter((asset) => asset.name.toLowerCase().includes(imageSearch.trim().toLowerCase())),
    [imageAssets, imageSearch]
  );
  const timelineDurationMs = useMemo(
    () => Math.max(getSessionDurationMs(state.session), selectedAsset?.durationMs || 0, 30_000),
    [selectedAsset?.durationMs, state.session]
  );
  const timelineWidth = Math.max(
    isPhone ? 640 : mode === 'desktop' ? 920 : 780,
    Math.round((timelineDurationMs / 1000) * (isPhone ? 52 : mode === 'desktop' ? 82 : 66) * state.session.transport.zoomLevel)
  );
  const deferredFingerprint = useDeferredValue(clipFingerprint(state.session));
  const persistableSession = useMemo(
    () => ({
      version: state.session.version,
      canvas: state.session.canvas,
      assets: state.session.assets,
      tracks: state.session.tracks,
      clips: state.session.clips,
      transitions: state.session.transitions,
      transport: {
        playheadMs: 0,
        zoomLevel: state.session.transport.zoomLevel,
        isPlaying: false,
      },
    }),
    [
      state.session.assets,
      state.session.canvas,
      state.session.clips,
      state.session.tracks,
      state.session.transitions,
      state.session.transport.zoomLevel,
      state.session.version,
    ]
  );
  const previewRenderableClips = deferredSession.clips;
  const visualClipCount = useMemo(
    () => state.session.clips.filter((clip) => {
      if (!clip.enabled || !clip.visible) return false;
      const asset = assetById.get(clip.assetId);
      return Boolean(asset && isVisualAssetKind(asset.kind));
    }).length,
    [assetById, state.session.clips]
  );
  const runtimeState = useMemo<LabRuntimeState>(
    () => resolveLabRuntimeState({
      capabilities: activeCapabilities,
      defaults: runtimeDefaults,
      timelineDurationMs,
      backendQueueActive: (
        backendSeparationJob?.status === 'queued'
        || backendSeparationJob?.status === 'running'
        || backendExportJob?.status === 'queued'
        || backendExportJob?.status === 'running'
      ),
    }),
    [activeCapabilities, backendExportJob?.status, backendSeparationJob?.status, runtimeDefaults, timelineDurationMs]
  );
  const exportExecutionMode = useMemo(
    () => resolveLabExportExecutionMode({
      capabilities: activeCapabilities,
      defaults: runtimeDefaults,
      runtimeState,
      timelineDurationMs,
      visualClipCount,
    }),
    [activeCapabilities, runtimeDefaults, runtimeState, timelineDurationMs, visualClipCount]
  );
  const activeStageEntries = useMemo<ActiveStageEntry[]>(
    () => state.session.clips
      .map((clip) => {
        if (!clip.enabled || !clip.visible) return null;
        const asset = assetById.get(clip.assetId);
        if (!asset || !isVisualAssetKind(asset.kind)) return null;
        const clipEndMs = clip.startMs + getClipDurationMs(clip);
        if (state.session.transport.playheadMs < clip.startMs || state.session.transport.playheadMs > clipEndMs) {
          return null;
        }
        return {
          asset,
          clip,
          localTimeMs: getClipLocalTimeMs(clip, state.session.transport.playheadMs),
        };
      })
      .filter((entry): entry is ActiveStageEntry => Boolean(entry))
      .sort((left, right) => left.clip.stageTransform.zIndex - right.clip.stageTransform.zIndex),
    [assetById, state.session.clips, state.session.transport.playheadMs]
  );
  const timelineRows = useMemo<LabTimelineRow[]>(
    () => Array.from(
      state.session.clips.reduce((map, clip) => {
        const rowId = clip.timelineRowId || clip.trackId || clip.id;
        const current = map.get(rowId) || { rowId, layerOrder: clip.layerOrder || 0, clips: [] as LabClip[] };
        current.layerOrder = Number.isFinite(clip.layerOrder) ? clip.layerOrder : current.layerOrder;
        current.clips.push(clip);
        map.set(rowId, current);
        return map;
      }, new Map<string, LabTimelineRow>())
    )
      .map(([, row]) => ({
        ...row,
        clips: [...row.clips].sort((left, right) => left.startMs - right.startMs),
      }))
      .sort((left, right) => left.layerOrder - right.layerOrder),
    [state.session.clips]
  );
  const timelineTransitionBoundaryByRow = useMemo(() => {
    const transitionByPair = new Map(
      state.session.transitions.map((transition) => [`${transition.fromClipId}__${transition.toClipId}`, transition] as const)
    );
    return timelineRows.reduce((map, row) => {
      const boundaries: LabTimelineTransitionBoundary[] = [];
      for (let index = 0; index < row.clips.length - 1; index += 1) {
        const fromClip = row.clips[index];
        const toClip = row.clips[index + 1];
        if (!fromClip || !toClip) continue;
        boundaries.push({
          rowId: row.rowId,
          fromClip,
          toClip,
          transition: transitionByPair.get(`${fromClip.id}__${toClip.id}`) || null,
          anchorMs: fromClip.startMs + getClipDurationMs(fromClip),
        });
      }
      map.set(row.rowId, boundaries);
      return map;
    }, new Map<string, LabTimelineTransitionBoundary[]>());
  }, [state.session.transitions, timelineRows]);
  const selectedTransitionBoundary = useMemo(() => {
    if (!selectedClip) return null;
    const outgoing = timelineTransitionBoundaryByRow
      .get(selectedClip.timelineRowId)
      ?.find((boundary) => boundary.fromClip.id === selectedClip.id);
    if (outgoing) return outgoing;
    return timelineTransitionBoundaryByRow
      .get(selectedClip.timelineRowId)
      ?.find((boundary) => boundary.toClip.id === selectedClip.id)
      || null;
  }, [selectedClip, timelineTransitionBoundaryByRow]);
  const activeTransition = selectedTransitionBoundary?.transition || null;
  const autoPreviewAllowed = runtimeState.autoPreviewAllowed;
  const compactUi = !isPhone;
  const ultraCompactUi = !isPhone;
  const isDesktopMode = mode === 'desktop';
  const isTightViewport = !isPhone && viewportHeight <= 980;
  const shellCardPadding = ultraCompactUi ? 'p-2.5' : 'p-3';
  const shellVerticalGapClass = compactUi ? (isTightViewport ? 'gap-2' : 'gap-2.5') : 'gap-4';
  const middleColumnGapClass = compactUi ? (isTightViewport ? 'gap-2' : 'gap-2.5') : 'gap-4';
  const panelHeaderPaddingClass = ultraCompactUi ? 'px-2.5 py-2.5' : (compactUi ? 'px-3 py-3' : 'px-4 py-4');
  const panelContentPaddingClass = ultraCompactUi ? 'p-2.5' : (compactUi ? 'p-3' : 'p-4');
  const compactIconButtonClass = ultraCompactUi ? 'h-8 w-8' : (compactUi ? 'h-9 w-9' : 'h-10 w-10');
  const railPanelButtonClass = ultraCompactUi
    ? 'min-w-[40px] px-1 py-1 text-[9px]'
    : (compactUi ? 'min-w-[46px] px-1.5 py-1.5 text-[9px]' : 'min-w-[52px] px-2 py-2 text-[10px]');
  const timelineLaneHeightClass = ultraCompactUi ? 'h-20' : (compactUi ? 'h-24' : 'h-28');
  const timelineClipClass = ultraCompactUi
    ? 'absolute top-1 h-16 overflow-hidden rounded-xl border px-1.5 py-1 text-left shadow-sm transition'
    : compactUi
      ? 'absolute top-1.5 h-[4.5rem] overflow-hidden rounded-xl border px-2 py-1.5 text-left shadow-sm transition'
      : 'absolute top-2 h-20 overflow-hidden rounded-2xl border px-3 py-2 text-left shadow-sm transition';
  const timelineWaveHeightClass = ultraCompactUi ? 'h-5' : (compactUi ? 'h-6' : 'h-7');
  const stageAspectRatio = Math.max(0.25, state.session.canvas.width / Math.max(1, state.session.canvas.height));
  const stageMaxHeightPx = clamp(
    Math.round(viewportHeight * (isPhone ? 0.4 : isDesktopMode ? 0.2 : 0.19)),
    isPhone ? 180 : 120,
    isPhone ? 320 : (isDesktopMode ? 210 : 190)
  );
  const stageMaxWidthPx = Math.round(stageMaxHeightPx * stageAspectRatio);
  const timelineMinHeightClass = isDesktopMode
    ? (isTightViewport ? 'min-h-[220px]' : 'min-h-[300px]')
    : 'min-h-[240px]';
  const cpuOptimizedTimelineEnabled = true;
  const timelineSnapStepMs = timelineSnapEnabled
    ? (cpuOptimizedTimelineEnabled ? 120 : 40)
    : 1;
  const timelineRulerStepMs = useMemo(
    () => resolveTimelineRulerStepMs(timelineDurationMs, timelineWidth, cpuOptimizedTimelineEnabled),
    [cpuOptimizedTimelineEnabled, timelineDurationMs, timelineWidth]
  );
  const timelineRulerLabelStepMs = useMemo(
    () => Math.max(1_000, timelineRulerStepMs * (timelineRulerStepMs < 1_000 ? 4 : 2)),
    [timelineRulerStepMs]
  );
  const timelineRulerMarks = useMemo(() => {
    const marks: number[] = [];
    const safeStep = Math.max(250, timelineRulerStepMs);
    for (let mark = 0; mark <= timelineDurationMs; mark += safeStep) {
      marks.push(mark);
    }
    if (marks[marks.length - 1] !== timelineDurationMs) {
      marks.push(timelineDurationMs);
    }
    return marks;
  }, [timelineDurationMs, timelineRulerStepMs]);
  const timelineRenderWindow = useMemo(() => {
    const safeWidth = Math.max(1, timelineViewport.width || (isPhone ? 640 : mode === 'desktop' ? 920 : 780));
    const msPerPixel = timelineDurationMs / Math.max(1, timelineWidth);
    const visibleStartMs = Math.max(0, timelineViewport.scrollLeft * msPerPixel);
    const visibleEndMs = Math.min(timelineDurationMs, (timelineViewport.scrollLeft + safeWidth) * msPerPixel);
    const bufferMs = cpuOptimizedTimelineEnabled ? TIMELINE_VIEWPORT_PADDING_MS : TIMELINE_VIEWPORT_PADDING_MS * 1.5;
    return {
      startMs: Math.max(0, visibleStartMs - bufferMs),
      endMs: Math.min(timelineDurationMs, visibleEndMs + bufferMs),
    };
  }, [cpuOptimizedTimelineEnabled, isPhone, mode, timelineDurationMs, timelineViewport.scrollLeft, timelineViewport.width, timelineWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewportHeight(readViewportHeight());
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    sessionRef.current = state.session;
    playheadRef.current = state.session.transport.playheadMs;
  }, [state.session]);

  useEffect(() => {
    if (activePanel !== 'tts') return;
    const latest = readStoredLabTtsPreference();
    if (latest.engine !== ttsEngine) {
      setTtsEngine(latest.engine);
    }
    if (latest.voiceId) {
      setTtsVoiceId((current) => (current === latest.voiceId ? current : latest.voiceId));
    }
  }, [activePanel, ttsEngine]);

  useEffect(() => {
    if (activePanel !== 'tts') return;

    let cancelled = false;
    const storedPreference = readStoredLabTtsPreference();
    const storedVoiceCandidate = storedPreference.engine === ttsEngine
      ? storedPreference.voiceId
      : '';

    const applyVoiceOptions = (voices: VoiceOption[]) => {
      const normalizedVoices = dedupeVoiceOptions(voices);
      if (cancelled) return;
      setTtsVoiceOptions(normalizedVoices);
      setTtsVoiceId((current) => (
        resolvePreferredLabTtsVoiceId(
          normalizedVoices,
          [current, storedVoiceCandidate, initialLabTtsPreferenceRef.current.voiceId]
        )
      ));
    };

    applyVoiceOptions(getStaticVoiceFallback(ttsEngine));

    const loadRuntimeVoices = async () => {
      try {
        const runtimeVoices = await fetchEngineRuntimeVoices(ttsEngine, '', 7000);
        if (runtimeVoices.length > 0) {
          applyVoiceOptions(runtimeVoices);
        }
      } catch {
        // Keep static voice fallback when runtime catalog fetch fails.
      }
    };

    void loadRuntimeVoices();

    return () => {
      cancelled = true;
    };
  }, [activePanel, ttsEngine]);

  useEffect(() => {
    if (selectedAsset?.kind === 'text') {
      setActiveTextEditTab('Text');
      setTextDraft(selectedAsset.textStyle?.text || textDraft);
      return;
    }
    if (activePanel === 'text') {
      setActiveTextEditTab('Text');
    }
  }, [activePanel, selectedAsset?.id, selectedAsset?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const width = state.session.canvas.isCustom
      ? state.session.canvas.customWidth || state.session.canvas.width
      : state.session.canvas.width;
    const height = state.session.canvas.isCustom
      ? state.session.canvas.customHeight || state.session.canvas.height
      : state.session.canvas.height;
    setCustomCanvasWidthDraft(String(Math.max(1, Math.round(Number(width || 1080)))));
    setCustomCanvasHeightDraft(String(Math.max(1, Math.round(Number(height || 1920)))));
    setCustomCanvasError('');
  }, [
    state.session.canvas.customHeight,
    state.session.canvas.customWidth,
    state.session.canvas.height,
    state.session.canvas.isCustom,
    state.session.canvas.width,
  ]);

  useEffect(() => {
    if (mode !== 'tablet') {
      setTabletInspectorOpen(false);
    }
  }, [mode, timelineWidth]);

  useEffect(() => {
    let cancelled = false;
    const restoreDefaults = async () => {
      try {
        const remoteDefaults = await fetchLabRuntimeDefaults();
        if (cancelled) return;
        setRuntimeDefaults(remoteDefaults);
        persistLabRuntimeDefaults(remoteDefaults);
      } catch (error) {
        if (cancelled) return;
        setRuntimeDefaults(readLabRuntimeDefaults());
        const status = error instanceof HttpError ? error.status : 0;
        void reportFrontendSignal({
          message: status === 401 || status === 403
            ? 'Lab runtime defaults request requires bearer auth. Using local defaults.'
            : 'Failed to sync Lab runtime defaults from backend. Using local defaults.',
          component: 'LabTabContent',
          severity: status === 401 || status === 403 ? 'warn' : 'error',
          metadata: {
            signal: status === 401 || status === 403
              ? 'lab_runtime_defaults_auth_required'
              : 'lab_runtime_defaults_sync_failed',
            backend: 'media',
            status: status || undefined,
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      }
    };
    void restoreDefaults();
    return () => {
      cancelled = true;
    };
  }, []);

  const recordRuntimeMetric = useCallback((key: keyof LabRuntimeMetrics, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setRuntimeMetrics((current) => {
      const previous = Number(current[key] || 0);
      if (previous >= value) return current;
      return { ...current, [key]: Math.round(value) };
    });
  }, []);

  const storeObjectUrl = useCallback((url: string): string => {
    urlRegistryRef.current.add(url);
    return url;
  }, []);

  const setJob = useCallback((job: LabJob | null) => {
    dispatch({ type: 'set-job', job });
  }, []);

  const runActionJob = useCallback(async <T,>(
    nextJob: Omit<LabJob, 'status' | 'progressPct' | 'startedAt'>,
    runner: (controller: AbortController) => Promise<T>
  ): Promise<T> => {
    actionJobAbortRef.current?.abort();
    const controller = new AbortController();
    actionJobAbortRef.current = controller;
    setJob({
      ...nextJob,
      status: 'running',
      progressPct: 5,
      startedAt: Date.now(),
    });
    try {
      const result = await runner(controller);
      if (!controller.signal.aborted) {
        setJob({
          ...nextJob,
          status: 'done',
          progressPct: 100,
          startedAt: Date.now(),
          message: nextJob.message,
        });
      }
      return result;
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      setJob({
        ...nextJob,
        status: isAbort ? 'cancelled' : 'error',
        progressPct: 0,
        startedAt: Date.now(),
        message: isAbort ? 'Lab action cancelled.' : nextJob.message,
        ...(isAbort ? {} : { error: error instanceof Error ? error.message : String(error) }),
      });
      throw error;
    } finally {
      if (actionJobAbortRef.current === controller) {
        actionJobAbortRef.current = null;
      }
    }
  }, [setJob]);

  const runExportJob = useCallback(async <T,>(
    nextJob: Omit<LabJob, 'status' | 'progressPct' | 'startedAt'>,
    runner: (controller: AbortController) => Promise<T>
  ): Promise<T> => {
    exportJobAbortRef.current?.abort();
    const controller = new AbortController();
    exportJobAbortRef.current = controller;
    setJob({
      ...nextJob,
      status: 'running',
      progressPct: 5,
      startedAt: Date.now(),
    });
    try {
      const result = await runner(controller);
      if (!controller.signal.aborted) {
        setJob({
          ...nextJob,
          status: 'done',
          progressPct: 100,
          startedAt: Date.now(),
          message: nextJob.message,
        });
      }
      return result;
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      setJob({
        ...nextJob,
        status: isAbort ? 'cancelled' : 'error',
        progressPct: 0,
        startedAt: Date.now(),
        message: isAbort ? 'Lab export cancelled.' : nextJob.message,
        ...(isAbort ? {} : { error: error instanceof Error ? error.message : String(error) }),
      });
      throw error;
    } finally {
      if (exportJobAbortRef.current === controller) {
        exportJobAbortRef.current = null;
      }
    }
  }, [setJob]);

  useEffect(() => {
    previewJobAbortRef.current?.abort();
    if (state.job?.status === 'running' && state.job.kind !== 'export') {
      actionJobAbortRef.current?.abort();
    }
  }, [
    activePanel,
    state.job?.kind,
    state.job?.status,
    state.selectedAssetId,
    state.selectedClipId,
    state.session.canvas.height,
    state.session.canvas.presetId,
    state.session.canvas.width,
    state.session.transport.zoomLevel,
  ]);

  useEffect(() => {
    dispatch({ type: 'set-capabilities', capabilities: capabilityProfile });
    persistLabCapabilities(capabilityProfile);
  }, [capabilityProfile]);

  useEffect(() => {
    const signature = `${mode}|${activeCapabilities.tier}|${activeCapabilities.runtimeGuardrails.degraded}`;
    if (lastLayoutTelemetryRef.current === signature) return;
    lastLayoutTelemetryRef.current = signature;
    void reportFrontendSignal({
      message: 'lab.layout_mode',
      component: 'LabTabContent',
      metadata: {
        layoutMode: mode,
        tier: activeCapabilities.tier,
        degraded: activeCapabilities.runtimeGuardrails.degraded,
      },
    });
  }, [activeCapabilities.runtimeGuardrails.degraded, activeCapabilities.tier, mode]);

  useEffect(() => {
    const registeredUrls = urlRegistryRef.current;

    const restore = async () => {
      const hydrationStartedAt = performance.now();
      setIsHydrating(true);
      try {
        const preferences = readLabPreferences();
        if (preferences?.selectedTool) {
          dispatch({ type: 'set-active-tool', tool: preferences.selectedTool });
        }
        if (preferences?.selectedPanel) {
          setActivePanel(preferences.selectedPanel);
        }

        const snapshot = readLabSessionSnapshot();
        if (!snapshot) {
          setIsHydrating(false);
          return;
        }

        const restoredAssets: LabAsset[] = [];
        for (const asset of snapshot.session.assets) {
          const nextAsset: LabAsset = { ...asset };
          const blob = await readLabAssetBlob(asset.id);
          if (blob) {
            const objectUrl = URL.createObjectURL(blob);
            registeredUrls.add(objectUrl);
            nextAsset.objectUrl = objectUrl;
          }
          if (asset.kind === 'audio' && blob) {
            const pcm = await decodeAudioBlobToPcmData(blob);
            pcmDataByAssetIdRef.current.set(asset.id, pcm);
            if (!asset.waveform) {
              const waveform = await runWaveformTask(pcm);
              nextAsset.waveform = {
                coarse: waveform.coarse,
                detail: waveform.detail,
                durationMs: waveform.durationMs,
                sampleRate: waveform.sampleRate,
                channels: waveform.channels,
              };
            }
          } else if ((asset.kind === 'video' || asset.kind === 'recording') && blob) {
            const file = new File([blob], asset.name, { type: asset.mimeType });
            const metadata = await readVideoMetadata(file).catch(() => ({ durationMs: asset.durationMs, posterBlob: null }));
            if (metadata.posterBlob) {
              const posterUrl = URL.createObjectURL(metadata.posterBlob);
              registeredUrls.add(posterUrl);
              nextAsset.posterUrl = posterUrl;
            }
          } else if (asset.kind === 'image' && blob && (!asset.intrinsicWidth || !asset.intrinsicHeight)) {
            const dimensions = await readImageDimensions(new File([blob], asset.name, { type: asset.mimeType })).catch(() => null);
            if (dimensions) {
              nextAsset.intrinsicWidth = dimensions.width;
              nextAsset.intrinsicHeight = dimensions.height;
            }
          }
          if (!blob && (asset.kind === 'audio' || asset.kind === 'video' || asset.kind === 'recording' || asset.kind === 'image')) {
            continue;
          }
          restoredAssets.push(nextAsset);
        }

        const restoredClips = snapshot.session.clips.filter((clip) => restoredAssets.some((asset) => asset.id === clip.assetId));
        const restoredClipIds = new Set(restoredClips.map((clip) => clip.id));
        const restoredTransitions = (snapshot.session.transitions || []).filter(
          (transition) => restoredClipIds.has(transition.fromClipId) && restoredClipIds.has(transition.toClipId)
        );

        const restoredSession: LabSession = {
          version: snapshot.session.version,
          canvas: snapshot.session.canvas || createInitialLabState().session.canvas,
          assets: restoredAssets,
          tracks: snapshot.session.tracks,
          clips: restoredClips,
          transitions: restoredTransitions,
          transport: snapshot.session.transport,
        };

        dispatch({
          type: 'hydrate',
          session: restoredSession,
          ...(snapshot.selectedAssetId ? { selectedAssetId: snapshot.selectedAssetId } : {}),
          ...(snapshot.selectedClipId ? { selectedClipId: snapshot.selectedClipId } : {}),
          ...(snapshot.selectedTool ? { activeTool: snapshot.selectedTool } : {}),
        });
      } finally {
        setIsHydrating(false);
        recordRuntimeMetric('hydrationMs', performance.now() - hydrationStartedAt);
      }
    };

    void restore();

    return () => {
      terminateMediaWorker();
      terminateSeparationWorker();
      previewJobAbortRef.current?.abort();
      actionJobAbortRef.current?.abort();
      exportJobAbortRef.current?.abort();
      recordingControllerRef.current.recorder?.stop();
      recordingControllerRef.current.streams.forEach((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      Array.from(registeredUrls).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore cleanup failure
        }
      });
    };
  }, [recordRuntimeMetric]);

  useEffect(() => {
    persistLabPreferences({ selectedTool: state.activeTool, selectedPanel: activePanel });
    persistLabSessionSnapshot(persistableSession, {
      selectedAssetId: state.selectedAssetId,
      selectedClipId: state.selectedClipId,
      selectedTool: state.activeTool,
    });
  }, [activePanel, persistableSession, state.activeTool, state.selectedAssetId, state.selectedClipId]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return undefined;

    const onTimeUpdate = () => {
      dispatch({ type: 'set-playhead', playheadMs: Math.round(audio.currentTime * 1000) });
    };
    const onPlay = () => setIsTransportPlaying(true);
    const onPause = () => setIsTransportPlaying(false);
    const onEnded = () => setIsTransportPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  useEffect(() => {
    if (!isTransportPlaying || previewUrl) return undefined;
    manualTransportOriginRef.current = {
      startedAt: performance.now(),
      playheadMs: playheadRef.current,
    };
    let frame = 0;
    const tick = () => {
      const origin = manualTransportOriginRef.current;
      if (!origin) return;
      const nextPlayhead = origin.playheadMs + (performance.now() - origin.startedAt);
      if (nextPlayhead >= timelineDurationMs) {
        dispatch({ type: 'set-playhead', playheadMs: timelineDurationMs });
        setIsTransportPlaying(false);
        return;
      }
      dispatch({ type: 'set-playhead', playheadMs: Math.round(nextPlayhead) });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isTransportPlaying, previewUrl, timelineDurationMs]);

  useEffect(() => {
    activeStageEntries.forEach((entry) => {
      if (entry.asset.kind !== 'video' && entry.asset.kind !== 'recording') return;
      const element = stageVideoRefs.current[entry.clip.id];
      if (!element) return;
      const nextTime = clamp(
        entry.localTimeMs / 1000,
        0,
        Math.max(0, Number.isFinite(element.duration) ? element.duration : entry.asset.durationMs / 1000)
      );
      if (Math.abs((element.currentTime || 0) - nextTime) > 0.12) {
        element.currentTime = nextTime;
      }
      if (isTransportPlaying) {
        void element.play().catch(() => undefined);
      } else {
        element.pause();
      }
    });
    Object.entries(stageVideoRefs.current).forEach(([clipId, element]) => {
      if (!element) return;
      if (!activeStageEntries.some((entry) => entry.clip.id === clipId) || !isTransportPlaying) {
        element.pause();
      }
    });
  }, [activeStageEntries, isTransportPlaying]);

  useEffect(() => {
    if (!recordingState) {
      setRecordingElapsedMs(0);
      return undefined;
    }
    setRecordingElapsedMs(Date.now() - recordingState.startedAt);
    const timer = window.setInterval(() => {
      setRecordingElapsedMs(Date.now() - recordingState.startedAt);
    }, 250);
    return () => window.clearInterval(timer);
  }, [recordingState]);

  const buildWaveform = useCallback(async (pcmData: LabPcmData): Promise<LabAsset['waveform']> => {
    const startedAt = performance.now();
    const waveform = await runWaveformTask(pcmData);
    recordRuntimeMetric('waveformRenderMs', performance.now() - startedAt);
    return {
      coarse: waveform.coarse,
      detail: activeCapabilities.waveformDetail === 'full' ? waveform.detail : waveform.coarse,
      durationMs: waveform.durationMs,
      sampleRate: waveform.sampleRate,
      channels: waveform.channels,
    };
  }, [activeCapabilities.waveformDetail, recordRuntimeMetric]);

  const addAudioFile = useCallback(async (
    file: File,
    options?: { sourceAssetId?: string; autoSelect?: boolean; recordSource?: LabRecordSource }
  ) => {
    const pcmData = await decodeAudioFileToPcmData(file);
    const waveform = await buildWaveform(pcmData);
    const asset = buildAudioAsset(file, pcmData, waveform, options?.sourceAssetId);
    if (options?.recordSource) {
      asset.recordSource = options.recordSource;
    }
    const clip = buildClipForAsset(sessionRef.current, asset);
    asset.objectUrl = storeObjectUrl(URL.createObjectURL(file));
    pcmDataByAssetIdRef.current.set(asset.id, pcmData);
    await persistLabAssetBlob(asset.id, file);
    startTransition(() => {
      dispatch({ type: 'add-asset', asset, clip });
    });
    if (options?.autoSelect !== false) {
      dispatch({ type: 'set-selected-asset', assetId: asset.id });
      dispatch({ type: 'set-selected-clip', clipId: clip.id });
      dispatch({ type: 'set-playhead', playheadMs: clip.startMs });
    }
    return asset;
  }, [buildWaveform, storeObjectUrl]);

  const addVideoFile = useCallback(async (file: File, kind: 'video' | 'recording' = 'video', recordSource?: LabRecordSource) => {
    const metadata = await readVideoMetadata(file);
    const asset = kind === 'recording'
      ? buildRecordingAsset(file, metadata.durationMs, recordSource || 'camera')
      : buildVideoAsset(file, metadata.durationMs);
    asset.objectUrl = storeObjectUrl(URL.createObjectURL(file));
    if (metadata.posterBlob) {
      asset.posterUrl = storeObjectUrl(URL.createObjectURL(metadata.posterBlob));
    }
    const clip = buildClipForAsset(sessionRef.current, asset);
    await persistLabAssetBlob(asset.id, file);
    startTransition(() => {
      dispatch({ type: 'add-asset', asset, clip });
    });
    dispatch({ type: 'set-selected-asset', assetId: asset.id });
    dispatch({ type: 'set-selected-clip', clipId: clip.id });
    dispatch({ type: 'set-playhead', playheadMs: clip.startMs });
    return asset;
  }, [storeObjectUrl]);

  const autoSeparateVideoImport = useCallback(async (
    file: File,
    videoAsset: LabAsset
  ): Promise<boolean> => {
    if (videoAsset.kind !== 'video' && videoAsset.kind !== 'recording') {
      return false;
    }

    type AutoSeparationArtifacts = {
      extractedAudioBlob: Blob;
      extractedAudioMimeType: string;
      vocalsBlob: Blob | null;
      backgroundBlob: Blob | null;
      runtime: 'browser' | 'backend';
      degradedReason?: 'queue_full';
    };

    const artifacts = await runActionJob<AutoSeparationArtifacts>(
      {
        id: 'lab_video_auto_split',
        kind: 'stem',
        message: 'Auto-separating imported video...',
      },
      async (controller) => {
        let extractedAudioBlob: Blob | null = null;
        let extractedAudioMimeType = 'audio/wav';
        setJob({
          id: 'lab_video_auto_split',
          kind: 'stem',
          status: 'running',
          progressPct: 8,
          message: 'Extracting audio track from imported video...',
          startedAt: Date.now(),
        });
        try {
          extractedAudioBlob = await extractAudioFromVideoFile(file, {
            signal: controller.signal,
            onProgress: (payload) => {
              const mappedProgress = Math.max(8, Math.min(40, Math.round(8 + (payload.progressPct * 0.32))));
              setJob({
                id: 'lab_video_auto_split',
                kind: 'stem',
                status: 'running',
                progressPct: mappedProgress,
                message: payload.message,
                startedAt: Date.now(),
              });
            },
          });
          extractedAudioMimeType = String(extractedAudioBlob.type || 'audio/webm').trim() || 'audio/webm';
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          setJob({
            id: 'lab_video_auto_split',
            kind: 'stem',
            status: 'running',
            progressPct: 40,
            message: 'Direct audio extraction unavailable. Falling back to backend separation...',
            startedAt: Date.now(),
            runtime: 'backend',
          });
        }

        let vocalsBlob: Blob | null = null;
        let backgroundBlob: Blob | null = null;
        let runtime: 'browser' | 'backend' = 'backend';
        let degradedReason: 'queue_full' | undefined;
        setJob({
          id: 'lab_video_auto_split',
          kind: 'stem',
          status: 'running',
          progressPct: 52,
          message: 'Queueing backend Demucs separation for this video...',
          startedAt: Date.now(),
          runtime: 'backend',
        });
        const queuedFile = new File([file], file.name, { type: file.type || videoAsset.mimeType || 'video/mp4' });
        let created: LabSeparationJobState | null = null;
        let queueRetryAttempt = 0;
        while (!controller.signal.aborted) {
          try {
            created = await createLabSeparationJob(queuedFile, { modelName: 'htdemucs_ft' });
            break;
          } catch (error) {
            if (!isQueueFullHttpError(error)) {
              throw error;
            }
            if (queueRetryAttempt >= AUTO_SEPARATION_QUEUE_RETRY_LIMIT) {
              if (!extractedAudioBlob) {
                throw new Error('Lab separation queue is full right now and fallback extraction was unavailable. Retry in a moment.');
              }
              degradedReason = 'queue_full';
              setJob({
                id: 'lab_video_auto_split',
                kind: 'stem',
                status: 'running',
                progressPct: 96,
                message: 'Separation queue is full. Importing video + extracted audio now; run stem split later from Audio tools.',
                startedAt: Date.now(),
                runtime: 'backend',
              });
              break;
            }
            queueRetryAttempt += 1;
            const backoffMs = AUTO_SEPARATION_QUEUE_RETRY_BASE_DELAY_MS * queueRetryAttempt;
            setJob({
              id: 'lab_video_auto_split',
              kind: 'stem',
              status: 'running',
              progressPct: 52,
              message: `Separation queue is full (${queueRetryAttempt}/${AUTO_SEPARATION_QUEUE_RETRY_LIMIT + 1}). Retrying in ${Math.max(1, Math.round(backoffMs / 1000))}s...`,
              startedAt: Date.now(),
              runtime: 'backend',
            });
            await waitForMs(backoffMs);
          }
        }
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!created && degradedReason === 'queue_full') {
          if (!extractedAudioBlob) {
            throw new Error('Lab separation queue is full right now and extracted audio is unavailable. Retry in a moment.');
          }
          return {
            extractedAudioBlob,
            extractedAudioMimeType,
            vocalsBlob: null,
            backgroundBlob: null,
            runtime,
            degradedReason,
          };
        }
        if (!created) {
          throw new Error('Unable to queue backend separation for this video.');
        }
        setBackendSeparationJob(created);
        let settledJob = created;
        while (!controller.signal.aborted) {
          const nextJob = await fetchLabSeparationJob(created.id);
          settledJob = nextJob;
          setBackendSeparationJob(nextJob);
          setJob({
            id: 'lab_video_auto_split',
            kind: 'stem',
            status: nextJob.status === 'failed' ? 'error' : 'running',
            progressPct: Math.max(52, Math.min(95, Number.isFinite(nextJob.progress) ? Math.round(nextJob.progress) : 52)),
            message: nextJob.message || 'Running Demucs separation...',
            startedAt: Date.now(),
            runtime: nextJob.backendMode || 'backend',
            ...(nextJob.error ? { error: nextJob.error } : {}),
          });
          if (nextJob.status === 'completed' || nextJob.status === 'failed') {
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1300));
        }
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (settledJob.status !== 'completed') {
          throw new Error(settledJob.error || 'Backend separation failed for this video.');
        }
        const [backendVocals, backendBackground] = await Promise.all([
          fetchLabSeparationArtifact(settledJob.id, 'vocals'),
          fetchLabSeparationArtifact(settledJob.id, 'instrumental'),
        ]);
        vocalsBlob = backendVocals;
        backgroundBlob = backendBackground;
        if (!vocalsBlob || !backgroundBlob) {
          throw new Error('Auto separation did not produce vocals/background artifacts.');
        }

        if (!extractedAudioBlob) {
          setJob({
            id: 'lab_video_auto_split',
            kind: 'stem',
            status: 'running',
            progressPct: 96,
            message: 'Rebuilding audio track from separated stems...',
            startedAt: Date.now(),
            runtime,
          });
          const [vocalsPcm, backgroundPcm] = await Promise.all([
            decodeAudioBlobToPcmData(vocalsBlob),
            decodeAudioBlobToPcmData(backgroundBlob),
          ]);
          const mergedPcm = mixStemPcmToAudioTrack(vocalsPcm, backgroundPcm);
          if (mergedPcm) {
            const mergedWav = await runEncodeWavTask(mergedPcm);
            extractedAudioBlob = mergedWav.blob;
            extractedAudioMimeType = 'audio/wav';
          } else {
            extractedAudioBlob = backgroundBlob;
            extractedAudioMimeType = String(backgroundBlob.type || 'audio/wav').trim() || 'audio/wav';
          }
        }

        return {
          extractedAudioBlob,
          extractedAudioMimeType,
          vocalsBlob,
          backgroundBlob,
          runtime,
          ...(degradedReason ? { degradedReason } : {}),
        };
      }
    );

    const extractedAudioFile = new File(
      [artifacts.extractedAudioBlob],
      toAudioFilename(file.name, 'audio_track', extensionFromAudioMimeType(artifacts.extractedAudioMimeType)),
      { type: artifacts.extractedAudioMimeType }
    );
    const extractedAudioAsset = await addAudioFile(extractedAudioFile, {
      sourceAssetId: videoAsset.id,
      autoSelect: false,
    });
    if (artifacts.vocalsBlob && artifacts.backgroundBlob) {
      const vocalsFile = new File([artifacts.vocalsBlob], toAudioFilename(file.name, 'vocals'), { type: 'audio/wav' });
      const backgroundFile = new File([artifacts.backgroundBlob], toAudioFilename(file.name, 'bg_music'), { type: 'audio/wav' });
      await addAudioFile(vocalsFile, {
        sourceAssetId: extractedAudioAsset.id || videoAsset.id,
        autoSelect: false,
      });
      await addAudioFile(backgroundFile, {
        sourceAssetId: extractedAudioAsset.id || videoAsset.id,
        autoSelect: false,
      });
      onToast(
        `Auto split complete for ${file.name}: video, audio, vocals, and background music are now in the timeline (${artifacts.runtime}).`,
        'success'
      );
    } else {
      const queueNote = artifacts.degradedReason === 'queue_full'
        ? ' Separation queue is at capacity right now, so stems were skipped.'
        : '';
      onToast(
        `Video + audio import completed for ${file.name}.${queueNote} Run Split later from Audio tools.`,
        'info'
      );
    }
    return true;
  }, [addAudioFile, onToast, runActionJob, setJob]);

  const addImageFile = useCallback(async (file: File) => {
    const dimensions = await readImageDimensions(file);
    const asset = buildImageAsset(file, dimensions);
    const clip = buildClipForAsset(sessionRef.current, asset);
    asset.objectUrl = storeObjectUrl(URL.createObjectURL(file));
    await persistLabAssetBlob(asset.id, file);
    startTransition(() => {
      dispatch({ type: 'add-asset', asset, clip });
    });
    dispatch({ type: 'set-selected-asset', assetId: asset.id });
    dispatch({ type: 'set-selected-clip', clipId: clip.id });
    dispatch({ type: 'set-playhead', playheadMs: clip.startMs });
    return asset;
  }, [storeObjectUrl]);

  const updateCatalogPanel = useCallback((
    kind: LabCatalogKind,
    patch: Partial<CatalogPanelState> | ((current: CatalogPanelState) => CatalogPanelState)
  ) => {
    const updater = (current: CatalogPanelState) => (typeof patch === 'function' ? patch(current) : { ...current, ...patch });
    if (kind === 'audio') {
      setAudioCatalog(updater);
      return;
    }
    if (kind === 'video') {
      setVideoCatalog(updater);
      return;
    }
    setImageCatalog(updater);
  }, []);

  const runCatalogSearch = useCallback(async (
    kind: LabCatalogKind,
    options?: { query?: string; tag?: string; provider?: CatalogPanelState['provider'] }
  ) => {
    const query = String(options?.query || '').trim();
    const tag = String(options?.tag || '').trim();
    const provider = options?.provider || 'all';
    updateCatalogPanel(kind, (current) => ({
      ...current,
      loading: true,
      error: '',
      query: query || tag,
      provider,
    }));
    try {
      const result = await searchLabCatalog(kind, {
        q: query,
        tag,
        provider,
      });
      const policyWarning = result.blockedProviders?.length
        ? `Commercial policy blocked providers: ${result.blockedProviders.join(', ')}.`
        : '';
      updateCatalogPanel(kind, (current) => ({
        ...current,
        items: result.items,
        warnings: policyWarning ? [...result.warnings, policyWarning] : result.warnings,
        loading: false,
        error: '',
        commercialPolicyVersion: result.commercialPolicyVersion || '',
        blockedProviders: result.blockedProviders || [],
      }));
    } catch (error) {
      updateCatalogPanel(kind, (current) => ({
        ...current,
        items: [],
        warnings: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Catalog search failed.',
        commercialPolicyVersion: '',
        blockedProviders: [],
      }));
    }
  }, [updateCatalogPanel]);

  const handleImportCatalogItem = useCallback(async (item: LabCatalogItem) => {
    if (item.commercialUseStatus && item.commercialUseStatus !== 'allowed') {
      onToast(
        item.commercialUseReason || 'This catalog item is blocked by the current commercial-use policy.',
        'info'
      );
      return;
    }
    try {
      const imported = await importLabCatalogItem(item);
      const blob = await fetchImportedLabCatalogBlob(imported.importId);
      const file = new File([blob], imported.filename, { type: imported.mimeType || blob.type || 'application/octet-stream' });
      let asset: LabAsset;
      if (item.kind === 'audio') {
        asset = await addAudioFile(file);
      } else if (item.kind === 'video') {
        asset = await addVideoFile(file, 'video');
        try {
          await autoSeparateVideoImport(file, asset);
        } catch (error) {
          onToast(
            error instanceof Error
              ? `Video imported, but auto split failed: ${error.message}`
              : 'Video imported, but auto split failed.',
            'error'
          );
        }
      } else {
        asset = await addImageFile(file);
      }
      const importedAssetPatch: Partial<LabAsset> = {
        provider: imported.provider,
        remoteAssetId: imported.item.id,
        ...(imported.item.thumbUrl ? { thumbUrl: imported.item.thumbUrl } : {}),
        ...(imported.item.creator ? { creator: imported.item.creator } : {}),
        ...(imported.item.license ? { license: imported.item.license } : {}),
        ...(imported.item.attributionUrl ? { attributionUrl: imported.item.attributionUrl } : {}),
      };
      dispatch({
        type: 'update-asset',
        assetId: asset.id,
        patch: importedAssetPatch,
      });
      onToast(`${imported.item.title} added to the Lab timeline.`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Catalog import failed.', 'error');
    }
  }, [addAudioFile, addImageFile, addVideoFile, autoSeparateVideoImport, onToast]);

  const handleMediaFilesSelected = useCallback(async (files: File[]) => {
    if (!files.length) return;

    let importedAudioCount = 0;
    let importedVideoCount = 0;
    let autoSplitCount = 0;
    let unsupportedCount = 0;
    let blockedVideoCount = 0;
    let failedCount = 0;

    for (const file of files) {
      const mediaKind = classifyMediaImportFile(file);
      if (mediaKind === 'unknown') {
        unsupportedCount += 1;
        continue;
      }

      if (mediaKind === 'audio') {
        try {
          await addAudioFile(file);
          importedAudioCount += 1;
        } catch {
          failedCount += 1;
        }
        continue;
      }

      if (!activeCapabilities.videoImportEnabled) {
        blockedVideoCount += 1;
        continue;
      }

      try {
        const videoAsset = await addVideoFile(file);
        importedVideoCount += 1;
        try {
          const didSplit = await autoSeparateVideoImport(file, videoAsset);
          if (didSplit) autoSplitCount += 1;
        } catch {
          // Keep successful import even if auto split fails.
        }
      } catch {
        failedCount += 1;
      }
    }

    const importedCount = importedAudioCount + importedVideoCount;
    if (importedCount > 0) {
      const summaryParts: string[] = [];
      if (importedAudioCount) summaryParts.push(`${importedAudioCount} audio`);
      if (importedVideoCount) summaryParts.push(`${importedVideoCount} video`);
      const importSummary = summaryParts.join(' + ');
      const autoSplitSummary = autoSplitCount ? ` Auto-split completed for ${autoSplitCount}.` : '';
      onToast(`${importSummary} file${importedCount > 1 ? 's' : ''} added to Lab.${autoSplitSummary}`, 'success');
    }
    if (blockedVideoCount > 0) {
      onToast(`Skipped ${blockedVideoCount} video file${blockedVideoCount > 1 ? 's' : ''}: video tools are paused on this device.`, 'info');
    }
    if (unsupportedCount > 0) {
      onToast(`Skipped ${unsupportedCount} unsupported file${unsupportedCount > 1 ? 's' : ''}.`, 'info');
    }
    if (failedCount > 0) {
      onToast(`${failedCount} file${failedCount > 1 ? 's' : ''} could not be imported.`, 'error');
    }
  }, [activeCapabilities.videoImportEnabled, addAudioFile, addVideoFile, autoSeparateVideoImport, onToast]);

  const handleAudioFilesSelected = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      for (const file of files) {
        await addAudioFile(file);
      }
      onToast(`${files.length} audio asset${files.length > 1 ? 's' : ''} added to Lab.`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Audio import failed.', 'error');
    }
  }, [addAudioFile, onToast]);

  const handleVideoFilesSelected = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (!activeCapabilities.videoImportEnabled) {
      onToast('Video import is disabled on this device profile.', 'info');
      return;
    }
    try {
      let autoSplitCount = 0;
      for (const file of files) {
        const videoAsset = await addVideoFile(file);
        try {
          const didSplit = await autoSeparateVideoImport(file, videoAsset);
          if (didSplit) autoSplitCount += 1;
        } catch (error) {
          onToast(
            error instanceof Error
              ? `Video added, but auto split failed for ${file.name}: ${error.message}`
              : `Video added, but auto split failed for ${file.name}.`,
            'error'
          );
        }
      }
      onToast(
        `${files.length} video asset${files.length > 1 ? 's' : ''} added to Lab.${autoSplitCount ? ` Auto-split completed for ${autoSplitCount}.` : ''}`,
        'success'
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Video import failed.', 'error');
    }
  }, [activeCapabilities.videoImportEnabled, addVideoFile, autoSeparateVideoImport, onToast]);

  const handleImageFilesSelected = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      for (const file of files) {
        await addImageFile(file);
      }
      onToast(`${files.length} image layer${files.length > 1 ? 's' : ''} added to Lab.`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Image import failed.', 'error');
    }
  }, [addImageFile, onToast]);

  const handleAudioInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void handleAudioFilesSelected(files);
  };

  const handleVideoInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void handleVideoFilesSelected(files);
  };

  const handleImageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void handleImageFilesSelected(files);
  };

  const handleMediaInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void handleMediaFilesSelected(files);
  };

  const selectedAudioAsset = useMemo(() => {
    if (selectedAsset?.kind === 'audio') return selectedAsset;
    if (selectedClip) {
      const clipAsset = state.session.assets.find((asset) => asset.id === selectedClip.assetId && asset.kind === 'audio');
      if (clipAsset) return clipAsset;
    }
    return null;
  }, [selectedAsset, selectedClip, state.session.assets]);
  const selectedSeparationAsset = useMemo(() => {
    if (selectedAsset && (selectedAsset.kind === 'audio' || selectedAsset.kind === 'video' || selectedAsset.kind === 'recording')) return selectedAsset;
    if (!selectedClip) return null;
    const clipAsset = state.session.assets.find((asset) => asset.id === selectedClip.assetId);
    if (clipAsset && (clipAsset.kind === 'audio' || clipAsset.kind === 'video' || clipAsset.kind === 'recording')) return clipAsset;
    return null;
  }, [selectedAsset, selectedClip, state.session.assets]);

  const runPreviewJob = useCallback(async (clips: LabClip[], autoPreview: boolean): Promise<Blob | null> => {
    previewJobAbortRef.current?.abort();
    const controller = new AbortController();
    previewJobAbortRef.current = controller;
    setJob({
      id: 'lab_preview',
      kind: 'mix',
      status: 'running',
      progressPct: 4,
      message: autoPreview ? 'Rendering Lab preview mix...' : 'Refreshing Lab preview mix...',
      startedAt: Date.now(),
    });
    const previewStartedAt = performance.now();
    try {
      const blob = await renderPreviewMixForClips(
        clips,
        pcmDataByAssetIdRef.current,
        (payload) => {
          setJob({
            id: 'lab_preview',
            kind: 'mix',
            status: 'running',
            progressPct: payload.progressPct,
            message: payload.message,
            startedAt: Date.now(),
            ...(payload.runtime ? { runtime: payload.runtime } : {}),
          });
        },
        controller.signal
      );
      if (!blob) {
        setJob(null);
        return null;
      }
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const nextUrl = URL.createObjectURL(blob);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      const previewRenderMs = performance.now() - previewStartedAt;
      recordRuntimeMetric('previewRenderMs', previewRenderMs);
      void reportFrontendSignal({
        message: 'lab.preview_render_latency',
        component: 'LabTabContent',
        metadata: {
          layoutMode: mode,
          previewRenderMs: Math.round(previewRenderMs),
          autoPreview,
          tier: activeCapabilities.tier,
          clipCount: clips.length,
        },
      });
      setJob({
        id: 'lab_preview',
        kind: 'mix',
        status: 'done',
        progressPct: 100,
        message: autoPreview ? 'Preview mix ready.' : 'Preview refreshed.',
        startedAt: Date.now(),
      });
      return blob;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setJob({
          id: 'lab_preview',
          kind: 'mix',
          status: 'error',
          progressPct: 0,
          message: 'Preview generation failed.',
          startedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      if (previewJobAbortRef.current === controller) {
        previewJobAbortRef.current = null;
      }
    }
  }, [activeCapabilities.tier, mode, recordRuntimeMetric, setJob]);

  useEffect(() => {
    if (!selectedClip) {
      return;
    }
    const clipButton = clipButtonRefs.current[selectedClip.id];
    if (clipButton) {
      clipButton.scrollIntoView({ block: 'nearest', inline: 'center', behavior: cpuOptimizedTimelineEnabled ? 'auto' : 'smooth' });
    }
  }, [cpuOptimizedTimelineEnabled, isPhone, selectedClip]);

  useEffect(() => {
    const timeline = timelineScrollRef.current;
    if (!timeline) return undefined;

    let rafId = 0;
    let timeoutId: number | null = null;
    const updateViewport = () => {
      const nextScrollLeft = Math.max(0, Math.round(timeline.scrollLeft));
      const nextWidth = Math.max(320, Math.round(timeline.clientWidth || 0));
      setTimelineViewport((previous) => {
        if (Math.abs(previous.scrollLeft - nextScrollLeft) < 2 && Math.abs(previous.width - nextWidth) < 2) {
          return previous;
        }
        return { scrollLeft: nextScrollLeft, width: nextWidth };
      });
    };
    const scheduleViewport = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateViewport();
      });
    };
    const onScroll = () => {
      scheduleViewport();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const signature = `${mode}|${Math.round(timeline.scrollLeft / 24)}`;
        if (lastTimelineTelemetryRef.current === signature) return;
        lastTimelineTelemetryRef.current = signature;
        void reportFrontendSignal({
          message: 'lab.timeline_scroll',
          component: 'LabTabContent',
          metadata: {
            layoutMode: mode,
            scrollLeft: Math.round(timeline.scrollLeft),
          },
        });
      }, 180);
    };
    const onResize = () => scheduleViewport();

    scheduleViewport();
    timeline.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      timeline.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [mode]);

  useEffect(() => {
    if (isHydrating || !autoPreviewAllowed) return undefined;
    if (!previewRenderableClips.some((clip) => pcmDataByAssetIdRef.current.has(clip.assetId))) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = '';
        setPreviewUrl('');
      }
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void runPreviewJob(previewRenderableClips, true).catch(() => undefined);
    }, 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoPreviewAllowed, deferredFingerprint, isHydrating, previewRenderableClips, runPreviewJob]);

  const quantizeTimelineMs = useCallback((valueMs: number): number => {
    const bounded = clamp(Math.round(valueMs), 0, timelineDurationMs);
    if (!timelineSnapEnabled) return bounded;
    return clamp(Math.round(bounded / timelineSnapStepMs) * timelineSnapStepMs, 0, timelineDurationMs);
  }, [timelineDurationMs, timelineSnapEnabled, timelineSnapStepMs]);

  const handleTogglePlayback = useCallback(async () => {
    const audio = previewAudioRef.current;
    if (previewUrl && audio) {
      if (audio.paused) {
        audio.currentTime = Math.max(0, state.session.transport.playheadMs / 1000);
        await audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
      return;
    }
    if (isTransportPlaying) {
      setIsTransportPlaying(false);
      return;
    }
    manualTransportOriginRef.current = {
      startedAt: performance.now(),
      playheadMs: state.session.transport.playheadMs,
    };
    setIsTransportPlaying(true);
  }, [isTransportPlaying, previewUrl, state.session.transport.playheadMs]);

  const handleSeek = useCallback((playheadMs: number) => {
    const resolvedPlayheadMs = clamp(Math.round(playheadMs), 0, timelineDurationMs);
    dispatch({ type: 'set-playhead', playheadMs: resolvedPlayheadMs });
    const audio = previewAudioRef.current;
    if (audio && previewUrl) {
      audio.currentTime = resolvedPlayheadMs / 1000;
    }
    if (isTransportPlaying && !previewUrl) {
      manualTransportOriginRef.current = { startedAt: performance.now(), playheadMs: resolvedPlayheadMs };
    }
  }, [dispatch, isTransportPlaying, previewUrl, timelineDurationMs]);

  const handleNudgePlayhead = useCallback((deltaMs: number) => {
    handleSeek(quantizeTimelineMs(state.session.transport.playheadMs + deltaMs));
  }, [handleSeek, quantizeTimelineMs, state.session.transport.playheadMs]);

  const handleNudgeSelectedClip = useCallback((deltaMs: number) => {
    if (!selectedClip) return;
    const nextStartMs = quantizeTimelineMs(selectedClip.startMs + deltaMs);
    dispatch({
      type: 'patch-selected-clip',
      patch: { startMs: nextStartMs },
    });
    handleSeek(nextStartMs);
  }, [dispatch, handleSeek, quantizeTimelineMs, selectedClip]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreEditorShortcut(event.target)) return;
      const safeKey = String(event.key || '').toLowerCase();
      if (event.code === 'Space') {
        event.preventDefault();
        void handleTogglePlayback();
        return;
      }
      if ((safeKey === 'delete' || safeKey === 'backspace') && selectedClip) {
        event.preventDefault();
        dispatch({ type: 'delete-selected-clip' });
        onToast('Clip removed from Lab timeline.', 'success');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && safeKey === 'd' && selectedClip) {
        event.preventDefault();
        dispatch({ type: 'duplicate-selected-clip' });
        return;
      }
      if (!event.ctrlKey && !event.metaKey && safeKey === 's' && selectedClip) {
        event.preventDefault();
        dispatch({ type: 'split-selected-clip' });
        return;
      }
      if (safeKey === 'arrowleft') {
        event.preventDefault();
        const step = event.shiftKey ? TIMELINE_KEYBOARD_JUMP_STEP_MS : TIMELINE_KEYBOARD_STEP_MS;
        if (event.altKey && selectedClip) {
          handleNudgeSelectedClip(-step);
        } else {
          handleNudgePlayhead(-step);
        }
        return;
      }
      if (safeKey === 'arrowright') {
        event.preventDefault();
        const step = event.shiftKey ? TIMELINE_KEYBOARD_JUMP_STEP_MS : TIMELINE_KEYBOARD_STEP_MS;
        if (event.altKey && selectedClip) {
          handleNudgeSelectedClip(step);
        } else {
          handleNudgePlayhead(step);
        }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && safeKey === ',') {
        event.preventDefault();
        handleNudgePlayhead(-TIMELINE_KEYBOARD_FINE_STEP_MS);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && safeKey === '.') {
        event.preventDefault();
        handleNudgePlayhead(TIMELINE_KEYBOARD_FINE_STEP_MS);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    dispatch,
    handleNudgePlayhead,
    handleNudgeSelectedClip,
    handleTogglePlayback,
    onToast,
    selectedClip,
  ]);

  const handleExtractVideoAudio = async () => {
    if (!selectedAsset || (selectedAsset.kind !== 'video' && selectedAsset.kind !== 'recording')) {
      onToast('Select a video or recording asset first.', 'info');
      return;
    }
    if (!videoExtractionEnabled) {
      onToast(videoExtractionDisabledReason || 'Video audio extraction is disabled for this deployment profile.', 'info');
      return;
    }
    if (!runtimeState.heavyToolsEnabled) {
      onToast('Video extraction is paused on this device profile to keep Lab responsive.', 'info');
      return;
    }
    const blob = await readLabAssetBlob(selectedAsset.id);
    if (!blob) {
      onToast('Video source is no longer cached for extraction.', 'error');
      return;
    }
    try {
      const audioBlob = await runActionJob(
        {
          id: 'lab_video_extract',
          kind: 'video_extract',
          message: 'Extracting audio from imported video...',
        },
        async (controller) => extractAudioFromVideoFile(new File([blob], selectedAsset.name, { type: selectedAsset.mimeType }), {
          signal: controller.signal,
          onProgress: (payload) => {
            setJob({
              id: 'lab_video_extract',
              kind: 'video_extract',
              status: 'running',
              progressPct: payload.progressPct,
              message: payload.message,
              startedAt: Date.now(),
            });
          },
        })
      );
      const audioMimeType = String(audioBlob.type || 'audio/webm').trim() || 'audio/webm';
      const extractedFile = new File(
        [audioBlob],
        toAudioFilename(selectedAsset.name, 'audio', extensionFromAudioMimeType(audioMimeType)),
        { type: audioMimeType }
      );
      await addAudioFile(extractedFile, { sourceAssetId: selectedAsset.id });
      onToast('Audio extracted from video and added to the Lab timeline.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Video audio extraction failed.', 'error');
    }
  };

  const waitForBackendSeparationJob = useCallback(async (jobId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      const nextJob = await fetchLabSeparationJob(jobId);
      setBackendSeparationJob(nextJob);
      setJob({
        id: nextJob.id,
        kind: 'hq_stem',
        status: nextJob.status === 'completed' ? 'done' : nextJob.status === 'failed' ? 'error' : 'running',
        progressPct: nextJob.progress,
        message: nextJob.message,
        startedAt: Date.now(),
        ...(nextJob.backendMode ? { runtime: nextJob.backendMode } : {}),
        ...(nextJob.error ? { error: nextJob.error } : {}),
      });
      if (nextJob.status === 'completed' || nextJob.status === 'failed') {
        return nextJob;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new DOMException('Aborted', 'AbortError');
  }, [setJob]);

  const waitForBackendExportJob = useCallback(async (jobId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      const nextJob = await fetchLabExportJob(jobId);
      setBackendExportJob(nextJob);
      setJob({
        id: nextJob.id,
        kind: 'export',
        status: nextJob.status === 'completed' ? 'done' : nextJob.status === 'failed' ? 'error' : nextJob.status === 'cancelled' ? 'cancelled' : 'running',
        progressPct: nextJob.progress,
        message: nextJob.message,
        startedAt: Date.now(),
        ...(nextJob.backendMode ? { runtime: nextJob.backendMode } : {}),
        ...(nextJob.error ? { error: nextJob.error } : {}),
      });
      if (nextJob.status === 'completed' || nextJob.status === 'failed' || nextJob.status === 'cancelled') {
        return nextJob;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new DOMException('Aborted', 'AbortError');
  }, [setJob]);

  const runStemAction = async (downloadMode?: 'voice' | 'background') => {
    if (!selectedAudioAsset || !activeCapabilities.sourceSeparationEnabled) {
      onToast('Source separation is unavailable for this device profile.', 'info');
      return;
    }
    const pcmData = pcmDataByAssetIdRef.current.get(selectedAudioAsset.id);
    if (!pcmData) {
      onToast('The selected audio asset is not decoded yet.', 'info');
      return;
    }
    try {
      const separated = await runActionJob(
        {
          id: 'lab_stem',
          kind: 'stem',
          message: 'Running vocal/background extraction locally...',
        },
        async (controller) => {
          return runStemSeparationTask(pcmData, activeCapabilities, {
            signal: controller.signal,
            onProgress: (payload) => {
              setJob({
                id: 'lab_stem',
                kind: 'stem',
                status: 'running',
                progressPct: payload.progressPct,
                message: payload.message,
                startedAt: Date.now(),
                ...(payload.runtime ? { runtime: payload.runtime } : {}),
              });
            },
          });
        }
      );

      const [voiceWav, backgroundWav] = await Promise.all([
        runEncodeWavTask(separated.voice),
        runEncodeWavTask(separated.background),
      ]);

      if (downloadMode === 'voice') {
        downloadBlob(voiceWav.blob, toAudioFilename(selectedAudioAsset.name, 'voice_only'));
      } else if (downloadMode === 'background') {
        downloadBlob(backgroundWav.blob, toAudioFilename(selectedAudioAsset.name, 'background_only'));
      }

      const voiceFile = new File([voiceWav.blob], toAudioFilename(selectedAudioAsset.name, 'voice_stem'), { type: 'audio/wav' });
      const backgroundFile = new File([backgroundWav.blob], toAudioFilename(selectedAudioAsset.name, 'background_stem'), { type: 'audio/wav' });
      await addAudioFile(voiceFile, { sourceAssetId: selectedAudioAsset.id, autoSelect: false });
      await addAudioFile(backgroundFile, { sourceAssetId: selectedAudioAsset.id, autoSelect: false });
      onToast(`Stem extraction complete via ${separated.runtime}.`, 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Stem extraction failed.', 'error');
    }
  };

  const runBackendStemAction = async (mode: 'insert' | 'download_vocals' | 'download_instrumental' = 'insert') => {
    if (!selectedSeparationAsset) {
      onToast('Select an audio or video asset first.', 'info');
      return;
    }
    const blob = await readLabAssetBlob(selectedSeparationAsset.id);
    if (!blob) {
      onToast('The selected source is no longer cached locally.', 'error');
      return;
    }
    try {
      const completedJob = await runActionJob(
        {
          id: 'lab_hq_stem',
          kind: 'hq_stem',
          message: 'Queueing Demucs HQ separation...',
        },
        async (controller) => {
          const created = await createLabSeparationJob(
            new File([blob], selectedSeparationAsset.name, { type: selectedSeparationAsset.mimeType }),
            { modelName: 'htdemucs_ft' }
          );
          setBackendSeparationJob(created);
          return waitForBackendSeparationJob(created.id, controller.signal);
        }
      );
      if (completedJob.status !== 'completed') {
        throw new Error(completedJob.error || 'Demucs HQ separation failed.');
      }
      const [vocalsBlob, instrumentalBlob] = await Promise.all([
        fetchLabSeparationArtifact(completedJob.id, 'vocals'),
        fetchLabSeparationArtifact(completedJob.id, 'instrumental'),
      ]);
      if (mode === 'download_vocals') {
        downloadBlob(vocalsBlob, toAudioFilename(selectedSeparationAsset.name, 'vocals_hq'));
      } else if (mode === 'download_instrumental') {
        downloadBlob(instrumentalBlob, toAudioFilename(selectedSeparationAsset.name, 'instrumental_hq'));
      } else {
        await addAudioFile(
          new File([vocalsBlob], toAudioFilename(selectedSeparationAsset.name, 'vocals_hq'), { type: 'audio/wav' }),
          { sourceAssetId: selectedSeparationAsset.id, autoSelect: false }
        );
        await addAudioFile(
          new File([instrumentalBlob], toAudioFilename(selectedSeparationAsset.name, 'instrumental_hq'), { type: 'audio/wav' }),
          { sourceAssetId: selectedSeparationAsset.id, autoSelect: false }
        );
      }
      onToast('Demucs HQ separation completed from the backend queue.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Demucs HQ separation failed.', 'error');
    }
  };

  const handleCreateTtsClip = async () => {
    const safeText = ttsText.trim();
    if (!safeText) {
      onToast('Enter narration text before generating TTS.', 'info');
      return;
    }
    const safeVoiceId = resolvePreferredLabTtsVoiceId(ttsVoiceOptions, [ttsVoiceId, selectedTtsVoice?.id]);
    if (!safeVoiceId) {
      onToast('No compatible TTS voice is available for the current engine.', 'error');
      return;
    }
    if (safeVoiceId !== ttsVoiceId) {
      setTtsVoiceId(safeVoiceId);
    }
    try {
      const traceId = createSynthesisTraceId(ttsEngine);
      const requestPayload = normalizeSynthesisRequest({
        engine: ttsEngine,
        text: safeText,
        voiceId: safeVoiceId,
        language: inferLanguageFromText(safeText),
        speed: 1,
        traceId,
      });
      const result = await runActionJob(
        {
          id: 'lab_tts',
          kind: 'tts',
          message: 'Generating TTS narration for Lab...',
        },
        async (controller) => {
          const created = await createTtsJob({
            engine: ttsEngine,
            ...requestPayload,
            voiceId: requestPayload.voice_id,
            request_id: traceId,
          });
          if (created.status === 'completed' && created.result?.audioBase64) {
            return {
              audioBytes: decodeBase64ToArrayBuffer(created.result.audioBase64),
              responseHeaders: created.result.headers || {},
            };
          }
          const jobId = String(created.jobId || created.requestId || '').trim();
          if (!jobId) {
            throw new Error('TTS queue did not return a job id.');
          }
          return pollTtsGatewayJobForAudio({
            jobId,
            runtimeLabel: `Lab ${ttsEngineLabel}`,
            engine: ttsEngine,
            signal: controller.signal,
          });
        }
      );
      const audioFile = new File([result.audioBytes], toAudioFilename(`tts_${Date.now()}`, 'narration'), { type: 'audio/wav' });
      await addAudioFile(audioFile);
      onToast('TTS narration added to the Lab timeline.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Lab TTS failed.', 'error');
    }
  };

  const resolveExportAudioBlob = useCallback(async (signal: AbortSignal): Promise<Blob | null> => {
    return renderPreviewMixForClips(
      state.session.clips,
      pcmDataByAssetIdRef.current,
      (payload) => {
        setJob({
          id: 'lab_export_audio',
          kind: 'mix',
          status: 'running',
          progressPct: Math.max(8, payload.progressPct),
          message: payload.message,
          startedAt: Date.now(),
          ...(payload.runtime ? { runtime: payload.runtime } : {}),
        });
      },
      signal
    );
  }, [setJob, state.session.clips]);

  const handleExportMix = async () => {
    try {
      const blob = await runActionJob(
        {
          id: 'lab_export_audio',
          kind: 'mix',
          message: 'Rendering final Lab WAV export...',
        },
        async (controller) => resolveExportAudioBlob(controller.signal)
      );
      if (!blob) {
        onToast('Add at least one audio clip before exporting.', 'info');
        return;
      }
      downloadBlob(blob, 'voiceflow_lab_mix.wav');
      onToast('Final Lab mix exported as WAV.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Mix export failed.', 'error');
    }
  };

  const captureLocalVisualExport = useCallback(async (
    controller: AbortController,
    format: LabExportFormat
  ): Promise<Blob> => {
    const audioBlob = await resolveExportAudioBlob(controller.signal).catch(() => null);
    return exportLabCompositionLocally({
      canvas: state.session.canvas,
      assets: state.session.assets,
      clips: state.session.clips.filter((clip) => clip.enabled),
      audioBlob,
      signal: controller.signal,
      onProgress: (payload) => {
        setJob({
          id: format === 'webm' ? 'lab_export_webm' : 'lab_export_capture',
          kind: 'export',
          status: 'running',
          progressPct: Math.max(10, payload.progressPct),
          message: payload.message,
          startedAt: Date.now(),
          runtime: runtimeState.effectiveBrowserMode,
        });
      },
      resolveAssetBlob: readLabAssetBlob,
    });
  }, [resolveExportAudioBlob, runtimeState.effectiveBrowserMode, setJob, state.session.assets, state.session.canvas, state.session.clips]);

  const handleExportWebm = async () => {
    try {
      const blob = await runExportJob(
        {
          id: 'lab_export_webm',
          kind: 'export',
          message: exportExecutionMode === 'backend_queue'
            ? 'Capturing a conservative local WebM before backend finalization...'
            : 'Capturing Lab WebM locally...',
        },
        async (controller) => captureLocalVisualExport(controller, 'webm')
      );
      downloadBlob(blob, toVisualFilename('lab_export', 'webm'));
      onToast('WebM export completed locally.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'WebM export failed.', 'error');
    }
  };

  const handleQueueMp4Export = async () => {
    try {
      const completedJob = await runExportJob(
        {
          id: 'lab_export_mp4',
          kind: 'export',
          message: exportExecutionMode === 'backend_queue'
            ? 'Capturing browser-safe source, then queueing MP4 finalization...'
            : 'Preparing browser-first source for queued MP4 finalization...',
        },
        async (controller) => {
          const captureBlob = await captureLocalVisualExport(controller, 'mp4');
          const captureFile = new File([captureBlob], toVisualFilename('capture', 'webm'), { type: captureBlob.type || 'video/webm' });
          const created = await createLabExportJob(captureFile, {
            format: 'mp4',
            sourceMediaType: captureFile.type,
            browserMode: runtimeState.effectiveBrowserMode,
          });
          setBackendExportJob(created);
          return waitForBackendExportJob(created.id, controller.signal);
        }
      );
      if (completedJob.status !== 'completed') {
        throw new Error(completedJob.error || 'Queued MP4 export failed.');
      }
      const artifact = await fetchLabExportArtifact(completedJob.id);
      downloadBlob(artifact, toVisualFilename('final_export', 'mp4'));
      onToast('Queued MP4 export completed.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Queued MP4 export failed.', 'error');
    }
  };

  const handleRemoveSelectedClip = () => {
    if (!selectedClip) return;
    dispatch({ type: 'delete-selected-clip' });
    onToast('Clip removed from Lab timeline.', 'success');
  };

  const handleRemoveSelectedAsset = async () => {
    if (!selectedAsset) return;
    dispatch({ type: 'remove-asset', assetId: selectedAsset.id });
    pcmDataByAssetIdRef.current.delete(selectedAsset.id);
    await removeLabAssetBlob(selectedAsset.id);
    if (selectedAsset.objectUrl) {
      URL.revokeObjectURL(selectedAsset.objectUrl);
      urlRegistryRef.current.delete(selectedAsset.objectUrl);
    }
    if (selectedAsset.posterUrl) {
      URL.revokeObjectURL(selectedAsset.posterUrl);
      urlRegistryRef.current.delete(selectedAsset.posterUrl);
    }
    onToast('Asset removed from Lab.', 'success');
  };

  const clipSummaryLabel = selectedClip ? `${formatMs(getClipDurationMs(selectedClip))} clip` : 'Select a clip to edit';
  const showAdvancedTools = runtimeState.heavyToolsEnabled;
  const activePanelMeta = LAB_PANELS.find((panel) => panel.id === activePanel) || LAB_PANELS[0]!;
  const projectDateLabel = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const insertTextOverlay = useCallback((preset: LabTextPreset, draftText: string) => {
    const safeText = draftText.trim();
    if (!safeText) {
      onToast('Enter text before inserting an overlay.', 'info');
      return;
    }
    const asset = buildTextAsset(preset, safeText);
    const clip = buildClipForAsset(sessionRef.current, asset);
    startTransition(() => {
      dispatch({ type: 'add-asset', asset, clip });
    });
    dispatch({ type: 'set-selected-asset', assetId: asset.id });
    dispatch({ type: 'set-selected-clip', clipId: clip.id });
    dispatch({ type: 'set-playhead', playheadMs: clip.startMs });
    onToast('Text overlay added to the Lab stage.', 'success');
  }, [onToast]);

  const handleInsertText = () => {
    insertTextOverlay(textPreset, textDraft);
  };

  const handleInsertPresetOverlay = (preset: LabTextPreset, nextText?: string) => {
    const seededText = nextText || LAB_TEXT_PRESETS[preset].text;
    setTextPreset(preset);
    setTextDraft(seededText);
    insertTextOverlay(preset, seededText);
  };

  const handleUpdateSelectedText = () => {
    if (!selectedAsset || selectedAsset.kind !== 'text' || !selectedClip) {
      onToast('Select a text layer first.', 'info');
      return;
    }
    const safeText = textDraft.trim();
    dispatch({
      type: 'update-asset',
      assetId: selectedAsset.id,
      patch: {
        name: safeText.slice(0, 32) || `${textPreset.replace(/_/g, ' ')} text`,
        textStyle: {
          ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
          preset: textPreset,
          text: safeText,
        },
      },
    });
    dispatch({
      type: 'patch-selected-clip',
      patch: { label: safeText.slice(0, 32) || selectedClip.label },
    });
    onToast('Selected text overlay updated.', 'success');
  };

  const handleInsertElement = (preset: keyof typeof LAB_ELEMENT_PRESETS) => {
    const asset = buildElementAsset(preset);
    const clip = buildClipForAsset(sessionRef.current, asset);
    startTransition(() => {
      dispatch({ type: 'add-asset', asset, clip });
    });
    dispatch({ type: 'set-selected-asset', assetId: asset.id });
    dispatch({ type: 'set-selected-clip', clipId: clip.id });
    dispatch({ type: 'set-playhead', playheadMs: clip.startMs });
    onToast(`${preset.replace(/_/g, ' ')} element added to the stage.`, 'success');
  };

  const handleQuickGifDiscovery = useCallback((query: string) => {
    const safeQuery = String(query || '').trim();
    if (!safeQuery) return;
    setActivePanel('images');
    setImageSearch(safeQuery);
    void runCatalogSearch('image', { query: safeQuery, provider: imageCatalog.provider });
    onToast(`Opened image discovery for "${safeQuery}".`, 'info');
  }, [imageCatalog.provider, onToast, runCatalogSearch]);

  const handleApplyCustomCanvas = useCallback(() => {
    const parsedWidth = Number(customCanvasWidthDraft);
    const parsedHeight = Number(customCanvasHeightDraft);
    const validation = validateLabCanvasDimensions(parsedWidth, parsedHeight);
    if (!validation.valid) {
      setCustomCanvasError(
        `Custom ratio must stay between ${LAB_CANVAS_DIMENSION_LIMITS.min}px and ${LAB_CANVAS_DIMENSION_LIMITS.max}px.`
      );
      onToast(
        `Canvas dimensions must be between ${LAB_CANVAS_DIMENSION_LIMITS.min}px and ${LAB_CANVAS_DIMENSION_LIMITS.max}px.`,
        'info'
      );
      return;
    }
    setCustomCanvasError('');
    dispatch({ type: 'set-canvas-custom', width: validation.width, height: validation.height, label: 'Custom' });
    onToast(`Custom ratio applied: ${validation.width}x${validation.height}.`, 'success');
  }, [customCanvasHeightDraft, customCanvasWidthDraft, onToast]);

  const handleSetTransitionKind = useCallback((kind: LabTransitionKind) => {
    if (!selectedTransitionBoundary) {
      onToast('Select a clip boundary to apply a transition.', 'info');
      return;
    }
    const seedTransition = selectedTransitionBoundary.transition;
    dispatch({
      type: 'add-transition',
      fromClipId: selectedTransitionBoundary.fromClip.id,
      toClipId: selectedTransitionBoundary.toClip.id,
      kind,
      ...(seedTransition && Number.isFinite(seedTransition.durationMs)
        ? { durationMs: seedTransition.durationMs }
        : {}),
      ...(seedTransition?.easing ? { easing: seedTransition.easing } : {}),
    });
  }, [onToast, selectedTransitionBoundary]);

  const handleUpdateActiveTransition = useCallback((patch: Partial<LabTransition>) => {
    if (!activeTransition) return;
    dispatch({
      type: 'update-transition',
      transitionId: activeTransition.id,
      patch,
    });
  }, [activeTransition]);

  const handleSelectTransitionBoundary = useCallback((boundary: LabTimelineTransitionBoundary) => {
    dispatch({ type: 'set-selected-clip', clipId: boundary.fromClip.id });
    dispatch({ type: 'set-selected-asset', assetId: boundary.fromClip.assetId });
    handleSeek(Math.max(0, Math.round(boundary.anchorMs - Math.max(120, boundary.transition?.durationMs || 0))));
    if (isPhone) {
      setMobileInspectorOpen(true);
    } else if (mode === 'tablet') {
      setTabletInspectorOpen(true);
    }
    if (!boundary.transition) {
      dispatch({
        type: 'add-transition',
        fromClipId: boundary.fromClip.id,
        toClipId: boundary.toClip.id,
        kind: 'crossfade',
      });
    }
  }, [handleSeek, isPhone, mode]);

  const handlePrimaryRailAction = () => {
    switch (activePanel) {
      case 'audio':
        audioImportInputRef.current?.click();
        break;
      case 'media':
        mediaImportInputRef.current?.click();
        break;
      case 'videos':
        videoImportInputRef.current?.click();
        break;
      case 'images':
        imageImportInputRef.current?.click();
        break;
      case 'text':
        handleInsertText();
        break;
      case 'elements':
        handleInsertElement('accent_bar');
        break;
      case 'record':
        void startRecording('audio');
        break;
      case 'tts':
        void handleCreateTtsClip();
        break;
      case 'canvas':
      default:
        setActivePanel('media');
        mediaImportInputRef.current?.click();
        break;
    }
  };

  const primaryRailActionLabel = (() => {
    switch (activePanel) {
      case 'text':
        return 'Add text overlay';
      case 'elements':
        return 'Add element';
      case 'record':
        return 'Start recording';
      case 'tts':
        return 'Generate narration';
      case 'videos':
        return 'Import video';
      case 'images':
        return 'Import image';
      case 'canvas':
        return 'Import media';
      default:
        return 'Import media';
    }
  })();

  const handleOpenMobileEditSheet = () => {
    if (selectedAsset?.kind === 'text') {
      setActivePanel('text');
    } else if (selectedAsset?.kind === 'image') {
      setActivePanel('images');
    } else if (selectedAsset?.kind === 'element') {
      setActivePanel('elements');
    } else if (selectedAsset?.kind === 'video' || selectedAsset?.kind === 'recording') {
      setActivePanel('videos');
    } else if (selectedAsset?.kind === 'audio') {
      setActivePanel('audio');
    } else {
      setActivePanel('media');
    }
    setMobileInspectorOpen(true);
  };

  const handleSelectTimelineClip = useCallback((clip: LabClip) => {
    dispatch({ type: 'set-selected-clip', clipId: clip.id });
    dispatch({ type: 'set-selected-asset', assetId: clip.assetId });
    handleSeek(clip.startMs);
  }, [handleSeek]);

  const handleMoveTimelineRow = useCallback((sourceRowId: string, targetRowId: string) => {
    if (!sourceRowId || !targetRowId || sourceRowId === targetRowId) return;
    dispatch({ type: 'move-clip-row', sourceRowId, targetRowId });
  }, []);

  const handleMoveClipToRowAtTime = useCallback((clipId: string, rowId: string, startMs: number) => {
    const safeClipId = String(clipId || '').trim();
    const safeRowId = String(rowId || '').trim();
    if (!safeClipId || !safeRowId) return;
    const targetRow = timelineRows.find((row) => row.rowId === safeRowId);
    if (!targetRow) return;
    const clip = state.session.clips.find((item) => item.id === safeClipId);
    if (!clip) return;
    const resolvedStartMs = quantizeTimelineMs(startMs);
    dispatch({
      type: 'move-clip',
      clipId: safeClipId,
      targetRowId: safeRowId,
      startMs: resolvedStartMs,
      targetLayerOrder: targetRow.layerOrder,
    });
    dispatch({ type: 'set-selected-clip', clipId: safeClipId });
    dispatch({ type: 'set-selected-asset', assetId: clip.assetId });
    handleSeek(resolvedStartMs);
  }, [dispatch, handleSeek, quantizeTimelineMs, state.session.clips, timelineRows]);

  const handleShiftSelectedLayer = (delta: number) => {
    if (!selectedClip || !selectedClipAsset || !isVisualAssetKind(selectedClipAsset.kind)) {
      onToast('Select a visual layer before changing its order.', 'info');
      return;
    }
    handleUpdateSelectedClipTransform({
      zIndex: clamp((selectedClip.stageTransform.zIndex || 0) + delta, 0, 100),
    });
  };

  const handleUpdateSelectedClipTransform = (patch: Partial<LabStageTransform>) => {
    if (!selectedClip) return;
    dispatch({
      type: 'patch-selected-clip',
      patch: {
        stageTransform: {
          ...selectedClip.stageTransform,
          ...patch,
        },
      },
    });
  };

  const stopRecording = useCallback(() => {
    const controller = recordingControllerRef.current;
    if (!controller.recorder) return;
    setRecordHint('Finalizing browser recording and inserting it into the timeline.');
    controller.recorder.stop();
  }, []);

  const startRecording = useCallback(async (source: LabRecordSource) => {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices) {
      setRecordHint('This browser cannot expose recording devices here.');
      onToast('Recording APIs are unavailable in this browser.', 'info');
      return;
    }
    if (recordingControllerRef.current.recorder) {
      stopRecording();
      return;
    }
    try {
      const streams: MediaStream[] = [];
      let stream: MediaStream;
      if (source === 'audio') {
        stream = await mediaDevices.getUserMedia({ audio: true });
        streams.push(stream);
      } else if (source === 'camera') {
        stream = await mediaDevices.getUserMedia({ audio: true, video: true });
        streams.push(stream);
      } else if (source === 'screen') {
        stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
        streams.push(stream);
      } else {
        const screenStream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
        const micStream = await mediaDevices.getUserMedia({ audio: true });
        streams.push(screenStream, micStream);
        stream = new MediaStream([
          ...screenStream.getVideoTracks(),
          ...screenStream.getAudioTracks(),
          ...micStream.getAudioTracks(),
        ]);
      }
      const mimeType = chooseRecordMimeType(source);
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        recordingControllerRef.current.streams.forEach((item) => {
          item.getTracks().forEach((track) => track.stop());
        });
        recordingControllerRef.current = {
          recorder: null,
          streams: [],
          chunks: [],
          source: null,
          mimeType: '',
        };
        setRecordingState(null);
        const file = new File([blob], toVisualFilename(`record_${source}_${Date.now()}`, 'webm'), { type: mimeType });
        void (async () => {
          try {
            if (source === 'audio') {
              await addAudioFile(file, { recordSource: source });
            } else {
              const videoAsset = await addVideoFile(file, 'recording', source);
              try {
                await autoSeparateVideoImport(file, videoAsset);
              } catch (error) {
                onToast(
                  error instanceof Error
                    ? `Recording saved, but auto split failed: ${error.message}`
                    : 'Recording saved, but auto split failed.',
                  'error'
                );
              }
            }
            onToast('Recording inserted into the Lab timeline.', 'success');
          } catch (error) {
            onToast(error instanceof Error ? error.message : 'Recording import failed.', 'error');
          }
        })();
      };
      recordingControllerRef.current = {
        recorder,
        streams: source === 'screen_camera' ? streams : [stream],
        chunks,
        source,
        mimeType,
      };
      recorder.start(250);
      setRecordingState({
        source,
        startedAt: Date.now(),
        mimeType,
      });
      setRecordHint(
        source === 'audio'
          ? 'Recording microphone input locally.'
          : source === 'camera'
            ? 'Recording camera and microphone locally.'
            : source === 'screen'
              ? 'Recording screen capture locally.'
              : 'Recording screen and microphone locally.'
      );
      onToast('Recording started in the browser.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording permission was denied.';
      setRecordHint(`Recording check failed: ${message}`);
      onToast(message, 'error');
    }
  }, [addAudioFile, addVideoFile, autoSeparateVideoImport, onToast, stopRecording]);

  const handleCancelActiveWork = async () => {
    previewJobAbortRef.current?.abort();
    actionJobAbortRef.current?.abort();
    exportJobAbortRef.current?.abort();
    if (backendExportJob && ['queued', 'running'].includes(backendExportJob.status)) {
      try {
        const cancelled = await cancelLabExportJob(backendExportJob.id);
        setBackendExportJob(cancelled);
      } catch {
        // ignore cancellation errors
      }
    }
    onToast('Cancelled active Lab work.', 'info');
  };

  const handleRecordProbe = async (kind: 'audio' | 'camera' | 'screen') => {
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices) {
      setRecordHint('This browser cannot expose recording devices here.');
      onToast('Recording APIs are unavailable in this browser.', 'info');
      return;
    }
    try {
      const stream = kind === 'screen'
        ? await mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setRecordHint(
        kind === 'audio'
          ? 'Microphone permission looks healthy for browser-first recording.'
          : kind === 'camera'
            ? 'Camera + microphone permission looks healthy for browser-first capture.'
            : 'Screen capture permission looks healthy for browser-first recording.'
      );
      onToast('Recording permissions look healthy on this device.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording permission was denied.';
      setRecordHint(`Recording check failed: ${message}`);
      onToast(message, 'error');
    }
  };

  const panelContent = (
    <div className="space-y-2.5">
      {activePanel === 'media' ? (
        <>
          <UploadDropzone
            accept={MEDIA_ACCEPT}
            multiple
            label="Import media"
            hint={activeCapabilities.videoImportEnabled
              ? 'Drop WAV, MP3, M4A, FLAC, OGG, MP4, MOV, or WebM'
              : 'Drop audio files. Video tools are paused for this device.'}
            className="rounded-2xl px-3 py-3"
            onFilesSelected={(files) => { void handleMediaFilesSelected(files); }}
          />
          {state.session.assets.length ? (
            <div className="grid grid-cols-2 gap-2">
              {state.session.assets.slice(0, 4).map((asset) => (
                <button
                  key={`media_card_${asset.id}`}
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'set-selected-asset', assetId: asset.id });
                    const firstClip = state.session.clips.find((clip) => clip.assetId === asset.id);
                    if (firstClip) {
                      dispatch({ type: 'set-selected-clip', clipId: firstClip.id });
                      handleSeek(firstClip.startMs);
                    }
                  }}
                  className={`rounded-2xl border p-2.5 text-left transition ${
                    state.selectedAssetId === asset.id
                      ? isDarkUi
                        ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-100'
                        : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                      : isDarkUi
                        ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className={`flex h-16 items-center justify-center rounded-xl ${asset.kind === 'audio' ? 'bg-emerald-500/20' : asset.kind === 'video' || asset.kind === 'recording' ? 'bg-amber-500/20' : 'bg-slate-500/20'}`}>
                    {asset.kind === 'audio' ? <Waves size={22} /> : asset.kind === 'image' ? <ImageIcon size={22} /> : asset.kind === 'text' ? <Type size={22} /> : asset.kind === 'element' ? <Shapes size={22} /> : <Film size={22} />}
                  </div>
                  <div className="mt-1.5 truncate text-[11px] font-semibold">{asset.name}</div>
                  <div className={`text-[10px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{formatMs(asset.durationMs)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className={`rounded-2xl border p-2.5 text-[11px] ${isDarkUi ? 'border-slate-800 bg-slate-900/60 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
              {state.session.assets.length} project assets are cached in IndexedDB so reloads stay fast without straining the backend.
            </div>
          )}
          <div className={`grid grid-cols-4 gap-1 rounded-2xl border p-1 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
            {[
              { label: 'OV', onClick: () => { setActivePanel('images'); updateCatalogPanel('image', { provider: 'openverse' }); } },
              { label: 'PX', onClick: () => { setActivePanel('videos'); updateCatalogPanel('video', { provider: 'pixabay' }); } },
              { label: 'FS', onClick: () => { setActivePanel('audio'); updateCatalogPanel('audio', { provider: 'freesound' }); } },
              { label: 'TTS', onClick: () => setActivePanel('tts') },
            ].map((providerButton, index) => (
              <button
                key={`media_provider_${index}`}
                type="button"
                onClick={providerButton.onClick}
                className={`flex h-8 items-center justify-center rounded-xl ${isDarkUi ? 'text-slate-400 hover:bg-slate-900 hover:text-slate-100' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}
              >
                <span className="text-[11px] font-black tracking-[0.18em]">{providerButton.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {activePanel === 'canvas' ? (
        <>
          <div className="grid gap-2">
            {LAB_CANVAS_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => dispatch({ type: 'set-canvas-preset', presetId: preset.id })}
                className={`rounded-2xl border px-3 py-2 text-left transition ${
                  state.session.canvas.presetId === preset.id
                    ? isDarkUi
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-50'
                      : 'border-cyan-300 bg-cyan-50 text-cyan-700'
                    : isDarkUi
                      ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{preset.label}</span>
                  <span className="text-[11px] opacity-75">{preset.aspectLabel}</span>
                </div>
                <div className="text-[11px] opacity-75">{preset.audienceLabel} | {preset.width}x{preset.height}</div>
              </button>
            ))}
          </div>
          <div className={`rounded-2xl border p-3 ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-700'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Custom ratio</div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDarkUi ? 'bg-slate-900 text-slate-400' : 'bg-gray-100 text-gray-500'}`}>
                {formatLabAspectLabel(Number(customCanvasWidthDraft) || state.session.canvas.width, Number(customCanvasHeightDraft) || state.session.canvas.height)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Width</span>
                <input
                  type="number"
                  min={LAB_CANVAS_DIMENSION_LIMITS.min}
                  max={LAB_CANVAS_DIMENSION_LIMITS.max}
                  value={customCanvasWidthDraft}
                  onChange={(event) => setCustomCanvasWidthDraft(event.target.value)}
                  className={`h-9 rounded-xl border px-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`}
                />
              </label>
              <label className="grid gap-1">
                <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Height</span>
                <input
                  type="number"
                  min={LAB_CANVAS_DIMENSION_LIMITS.min}
                  max={LAB_CANVAS_DIMENSION_LIMITS.max}
                  value={customCanvasHeightDraft}
                  onChange={(event) => setCustomCanvasHeightDraft(event.target.value)}
                  className={`h-9 rounded-xl border px-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`}
                />
              </label>
            </div>
            <div className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
              Supported range: {LAB_CANVAS_DIMENSION_LIMITS.min}px to {LAB_CANVAS_DIMENSION_LIMITS.max}px.
            </div>
            {customCanvasError ? (
              <div className={`mt-2 text-[11px] ${isDarkUi ? 'text-rose-300' : 'text-rose-600'}`}>{customCanvasError}</div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleApplyCustomCanvas}>
                Apply custom ratio
              </Button>
              {state.session.canvas.isCustom ? (
                <span className={`text-[11px] ${isDarkUi ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  Active {state.session.canvas.width}x{state.session.canvas.height}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {LAB_BACKGROUND_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Canvas background ${swatch}`}
                onClick={() => dispatch({ type: 'set-canvas-background', background: swatch })}
                className={`h-9 w-9 rounded-full border-2 ${state.session.canvas.background === swatch ? 'border-cyan-400' : 'border-white/20'}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </>
      ) : null}
      {activePanel === 'text' ? (
        selectedAsset?.kind === 'text' && selectedClip ? (
          <div className="space-y-3">
            <div className={`flex flex-wrap gap-2 rounded-2xl border p-1 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
              {LAB_TEXT_EDIT_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTextEditTab(tab)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold ${activeTextEditTab === tab ? (isDarkUi ? 'bg-slate-100 text-slate-950' : 'bg-gray-900 text-white') : (isDarkUi ? 'text-slate-300' : 'text-gray-600')}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {activeTextEditTab === 'Text' ? (
              <>
                <textarea
                  value={selectedAsset.textStyle?.text || textDraft}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setTextDraft(nextText);
                    dispatch({
                      type: 'update-asset',
                      assetId: selectedAsset.id,
                      patch: {
                        textStyle: {
                          ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
                          text: nextText,
                        },
                      },
                    });
                  }}
                  rows={4}
                  className={`w-full rounded-2xl border px-3 py-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`}
                />
                <div className="grid grid-cols-5 gap-2">
                  {['#ffffff', '#111827', '#ef4444', '#fb923c', '#fbbf24', '#22c55e', '#3b82f6', '#8b5cf6', '#db2777'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => dispatch({
                        type: 'update-asset',
                        assetId: selectedAsset.id,
                        patch: {
                          textStyle: {
                            ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
                            color,
                          },
                        },
                      })}
                      className="h-8 w-8 rounded-full border-2 border-white/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {activeTextEditTab === 'Adjust' ? (
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Font size</span>
                  <input
                    type="range"
                    min={20}
                    max={140}
                    value={selectedAsset.textStyle?.fontSize || 60}
                    onChange={(event) => dispatch({
                      type: 'update-asset',
                      assetId: selectedAsset.id,
                      patch: {
                        textStyle: {
                          ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
                          fontSize: Number(event.target.value),
                        },
                      },
                    })}
                    className="w-full"
                  />
                </label>
                <label className="grid gap-1">
                  <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Weight</span>
                  <input
                    type="range"
                    min={300}
                    max={900}
                    step={100}
                    value={selectedAsset.textStyle?.fontWeight || 700}
                    onChange={(event) => dispatch({
                      type: 'update-asset',
                      assetId: selectedAsset.id,
                      patch: {
                        textStyle: {
                          ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
                          fontWeight: Number(event.target.value),
                        },
                      },
                    })}
                    className="w-full"
                  />
                </label>
              </div>
            ) : null}
            {activeTextEditTab === 'Background' ? (
              <label className="grid gap-2">
                <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Background</span>
                <input
                  type="color"
                  value={(selectedAsset.textStyle?.backgroundColor || '#000000').slice(0, 7)}
                  onChange={(event) => dispatch({
                    type: 'update-asset',
                    assetId: selectedAsset.id,
                    patch: {
                      textStyle: {
                        ...(selectedAsset.textStyle || LAB_TEXT_PRESETS[textPreset]),
                        backgroundColor: event.target.value,
                      },
                    },
                  })}
                  className="h-10 w-full rounded-2xl border border-transparent bg-transparent"
                />
              </label>
            ) : null}
            {activeTextEditTab === 'Opacity' ? (
              <label className="grid gap-1">
                <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Opacity</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={selectedClip.stageTransform.opacity}
                  onChange={(event) => handleUpdateSelectedClipTransform({ opacity: Number(event.target.value) })}
                  className="w-full"
                />
              </label>
            ) : null}
            {activeTextEditTab === 'Time' ? (
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Start</span>
                  <input type="range" min={0} max={timelineDurationMs} value={selectedClip.startMs} onChange={(event) => dispatch({ type: 'set-selected-clip-start', startMs: Number(event.target.value) })} className="w-full" />
                </label>
                <label className="grid gap-1">
                  <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Trim out</span>
                  <input type="range" min={selectedClip.trimStartMs + 50} max={Math.max(selectedClip.trimStartMs + 50, selectedAsset.durationMs || selectedClip.trimEndMs)} value={selectedClip.trimEndMs} onChange={(event) => dispatch({ type: 'set-selected-clip-trim-end', trimEndMs: Number(event.target.value) })} className="w-full" />
                </label>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(LAB_TEXT_PRESETS) as LabTextPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTextPreset(preset);
                    setTextDraft(LAB_TEXT_PRESETS[preset].text);
                    handleInsertPresetOverlay(preset, LAB_TEXT_PRESETS[preset].text);
                  }}
                  className={`rounded-2xl border p-3 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`}
                >
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-500">{preset.replace(/_/g, ' ')}</div>
                  <div className="mt-3 truncate text-lg font-semibold">{LAB_TEXT_PRESETS[preset].text}</div>
                </button>
              ))}
            </div>
          </div>
        )
      ) : null}
      {activePanel === 'audio' ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
            <Search size={14} className={isDarkUi ? 'text-slate-500' : 'text-gray-400'} />
            <input
              value={audioSearch}
              onChange={(event) => setAudioSearch(event.target.value)}
              placeholder="Search music..."
              className={`w-full bg-transparent text-sm outline-none ${isDarkUi ? 'text-slate-100 placeholder:text-slate-500' : 'text-gray-800 placeholder:text-gray-400'}`}
            />
            <button
              type="button"
              onClick={() => { void runCatalogSearch('audio', { query: audioSearch, provider: audioCatalog.provider }); }}
              className={`rounded-xl px-2 py-1 text-xs font-semibold ${isDarkUi ? 'bg-slate-900 text-slate-200' : 'bg-gray-100 text-gray-700'}`}
            >
              Search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={audioCatalog.provider}
              onChange={(event) => updateCatalogPanel('audio', { provider: event.target.value as CatalogPanelState['provider'] })}
              className={`h-9 rounded-xl border px-3 text-xs ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-700'}`}
            >
              <option value="all">All providers</option>
              <option value="openverse">Openverse</option>
              <option value="freesound">Freesound</option>
            </select>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {LAB_AUDIO_DISCOVERY_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setAudioSearch(tag);
                  void runCatalogSearch('audio', { tag, provider: audioCatalog.provider });
                }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${audioSearch === tag ? (isDarkUi ? 'bg-slate-100 text-slate-950' : 'bg-gray-900 text-white') : (isDarkUi ? 'bg-slate-900 text-slate-300' : 'bg-gray-100 text-gray-700')}`}
              >
                {tag}
              </button>
            ))}
          </div>
          {audioCatalog.warnings.length ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {audioCatalog.warnings.join(' ')}
            </div>
          ) : null}
          <div className="grid gap-2">
            {filteredAudioAssets.length ? filteredAudioAssets.map((asset) => (
              <button
                key={`audio_pick_${asset.id}`}
                type="button"
                onClick={() => {
                  dispatch({ type: 'set-selected-asset', assetId: asset.id });
                  const firstClip = state.session.clips.find((clip) => clip.assetId === asset.id);
                  if (firstClip) {
                    dispatch({ type: 'set-selected-clip', clipId: firstClip.id });
                    handleSeek(firstClip.startMs);
                  }
                }}
                className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
              >
                <span>
                  <span className="block text-sm font-semibold">{asset.name}</span>
                  <span className={`block text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Project audio | {formatMs(asset.durationMs)}</span>
                </span>
                <Music2 size={16} />
              </button>
            )) : (
              <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
                Imported audio appears here. Use the Media tab to add clips, then come back to Audio for selection and separation.
              </div>
            )}
          </div>
          {audioCatalog.loading ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
              Searching audio providers...
            </div>
          ) : null}
          {audioCatalog.error ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-rose-500/20 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
              {audioCatalog.error}
            </div>
          ) : null}
          {audioCatalog.items.length ? (
            <div className="grid gap-2">
              {audioCatalog.items.map((item) => (
                <button
                  key={`${item.provider}_${item.id}`}
                  type="button"
                  onClick={() => { void handleImportCatalogItem(item); }}
                  className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    <span className={`block truncate text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                      {(item.provider || '').toUpperCase()} {item.creator ? `| ${item.creator}` : ''} {item.durationSec ? `| ${formatMs(item.durationSec * 1000)}` : ''}
                    </span>
                  </span>
                  <Download size={15} />
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Button size="sm" variant="secondary" icon={<Music2 size={14} />} onClick={() => { void runStemAction(); }} disabled={!selectedAudioAsset || !showAdvancedTools}>
              Quick separate in browser
            </Button>
            <Button size="sm" variant="secondary" icon={<Cpu size={14} />} onClick={() => { void runBackendStemAction('insert'); }} disabled={!selectedSeparationAsset}>
              Queue Demucs HQ
            </Button>
          </div>
        </div>
      ) : null}
      {activePanel === 'videos' ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
            <Search size={14} className={isDarkUi ? 'text-slate-500' : 'text-gray-400'} />
            <input
              value={videoSearch}
              onChange={(event) => setVideoSearch(event.target.value)}
              placeholder="Search videos..."
              className={`w-full bg-transparent text-sm outline-none ${isDarkUi ? 'text-slate-100 placeholder:text-slate-500' : 'text-gray-800 placeholder:text-gray-400'}`}
            />
            <button
              type="button"
              onClick={() => { void runCatalogSearch('video', { query: videoSearch, provider: videoCatalog.provider }); }}
              className={`rounded-xl px-2 py-1 text-xs font-semibold ${isDarkUi ? 'bg-slate-900 text-slate-200' : 'bg-gray-100 text-gray-700'}`}
            >
              Search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={videoCatalog.provider}
              onChange={(event) => updateCatalogPanel('video', { provider: event.target.value as CatalogPanelState['provider'] })}
              className={`h-9 rounded-xl border px-3 text-xs ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-700'}`}
            >
              <option value="all">All providers</option>
              <option value="pixabay">Pixabay</option>
            </select>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {LAB_VISUAL_DISCOVERY_TAGS.map((tag) => (
              <button
                key={`video_tag_${tag}`}
                type="button"
                onClick={() => {
                  setVideoSearch(tag);
                  void runCatalogSearch('video', { tag, provider: videoCatalog.provider });
                }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${videoSearch === tag ? (isDarkUi ? 'bg-slate-100 text-slate-950' : 'bg-gray-900 text-white') : (isDarkUi ? 'bg-slate-900 text-slate-300' : 'bg-gray-100 text-gray-700')}`}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {filteredVideoAssets.length ? filteredVideoAssets.map((asset) => (
              <button
                key={`video_pick_${asset.id}`}
                type="button"
                onClick={() => {
                  dispatch({ type: 'set-selected-asset', assetId: asset.id });
                  const firstClip = state.session.clips.find((clip) => clip.assetId === asset.id);
                  if (firstClip) {
                    dispatch({ type: 'set-selected-clip', clipId: firstClip.id });
                    handleSeek(firstClip.startMs);
                  }
                }}
                className={`rounded-2xl border p-2 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
              >
                <div className={`flex h-24 items-end rounded-xl bg-cover bg-center ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`} style={asset.posterUrl ? { backgroundImage: `url(${asset.posterUrl})` } : undefined}>
                  <span className="m-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">{formatMs(asset.durationMs)}</span>
                </div>
                <div className="mt-2 truncate text-xs font-semibold">{asset.name}</div>
              </button>
            )) : (
              <div className={`col-span-2 rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
                Import or record video to populate this grid.
              </div>
            )}
          </div>
          {videoCatalog.warnings.length ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {videoCatalog.warnings.join(' ')}
            </div>
          ) : null}
          {!videoExtractionEnabled && videoExtractionDisabledReason ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {videoExtractionDisabledReason}
            </div>
          ) : null}
          {videoCatalog.items.length ? (
            <div className="grid grid-cols-2 gap-2">
              {videoCatalog.items.map((item) => (
                <button
                  key={`${item.provider}_${item.id}`}
                  type="button"
                  onClick={() => { void handleImportCatalogItem(item); }}
                  className={`rounded-2xl border p-2 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                  <div className={`flex h-24 items-end rounded-xl bg-cover bg-center ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`} style={item.thumbUrl ? { backgroundImage: `url(${item.thumbUrl})` } : undefined}>
                    {item.durationSec ? <span className="m-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">{formatMs(item.durationSec * 1000)}</span> : null}
                  </div>
                  <div className="mt-2 truncate text-xs font-semibold">{item.title}</div>
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-2">
            <Button size="sm" variant="secondary" icon={<Video size={14} />} onClick={() => videoImportInputRef.current?.click()} disabled={!activeCapabilities.videoImportEnabled}>
              Import video
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Film size={14} />}
              onClick={() => { void handleExtractVideoAudio(); }}
              disabled={!(selectedAsset?.kind === 'video' || selectedAsset?.kind === 'recording') || !showAdvancedTools || !videoExtractionEnabled}
            >
              Extract audio from selected video
            </Button>
          </div>
        </div>
      ) : null}
      {activePanel === 'images' ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
            <Search size={14} className={isDarkUi ? 'text-slate-500' : 'text-gray-400'} />
            <input
              value={imageSearch}
              onChange={(event) => setImageSearch(event.target.value)}
              placeholder="Search images..."
              className={`w-full bg-transparent text-sm outline-none ${isDarkUi ? 'text-slate-100 placeholder:text-slate-500' : 'text-gray-800 placeholder:text-gray-400'}`}
            />
            <button
              type="button"
              onClick={() => { void runCatalogSearch('image', { query: imageSearch, provider: imageCatalog.provider }); }}
              className={`rounded-xl px-2 py-1 text-xs font-semibold ${isDarkUi ? 'bg-slate-900 text-slate-200' : 'bg-gray-100 text-gray-700'}`}
            >
              Search
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={imageCatalog.provider}
              onChange={(event) => updateCatalogPanel('image', { provider: event.target.value as CatalogPanelState['provider'] })}
              className={`h-9 rounded-xl border px-3 text-xs ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-700'}`}
            >
              <option value="all">All providers</option>
              <option value="openverse">Openverse</option>
              <option value="pixabay">Pixabay</option>
            </select>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {LAB_VISUAL_DISCOVERY_TAGS.map((tag) => (
              <button
                key={`image_tag_${tag}`}
                type="button"
                onClick={() => {
                  setImageSearch(tag);
                  void runCatalogSearch('image', { tag, provider: imageCatalog.provider });
                }}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${imageSearch === tag ? (isDarkUi ? 'bg-slate-100 text-slate-950' : 'bg-gray-900 text-white') : (isDarkUi ? 'bg-slate-900 text-slate-300' : 'bg-gray-100 text-gray-700')}`}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {filteredImageAssets.length ? filteredImageAssets.map((asset) => (
              <button
                key={`image_pick_${asset.id}`}
                type="button"
                onClick={() => {
                  dispatch({ type: 'set-selected-asset', assetId: asset.id });
                  const firstClip = state.session.clips.find((clip) => clip.assetId === asset.id);
                  if (firstClip) {
                    dispatch({ type: 'set-selected-clip', clipId: firstClip.id });
                    handleSeek(firstClip.startMs);
                  }
                }}
                className={`rounded-2xl border p-2 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
              >
                <div className={`flex h-24 rounded-xl bg-cover bg-center ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`} style={asset.objectUrl ? { backgroundImage: `url(${asset.objectUrl})` } : undefined} />
                <div className="mt-2 truncate text-xs font-semibold">{asset.name}</div>
              </button>
            )) : (
              <div className={`col-span-2 rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
                Import artwork to populate this image panel.
              </div>
            )}
          </div>
          {imageCatalog.warnings.length ? (
            <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {imageCatalog.warnings.join(' ')}
            </div>
          ) : null}
          {imageCatalog.items.length ? (
            <div className="grid grid-cols-2 gap-2">
              {imageCatalog.items.map((item) => (
                <button
                  key={`${item.provider}_${item.id}`}
                  type="button"
                  onClick={() => { void handleImportCatalogItem(item); }}
                  className={`rounded-2xl border p-2 text-left ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                >
                  <div className={`flex h-24 rounded-xl bg-cover bg-center ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`} style={item.thumbUrl ? { backgroundImage: `url(${item.thumbUrl})` } : undefined} />
                  <div className="mt-2 truncate text-xs font-semibold">{item.title}</div>
                </button>
              ))}
            </div>
          ) : null}
          <UploadDropzone
            accept={IMAGE_ACCEPT}
            multiple
            label="Import artwork"
            hint="Posters, backgrounds, and product shots"
            onFilesSelected={(files) => { void handleImageFilesSelected(files); }}
          />
        </div>
      ) : null}
      {activePanel === 'elements' ? (
        <div className="space-y-3">
          <details className="space-y-3" open>
            <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Shapes</summary>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(LAB_ELEMENT_PRESETS).map(([presetKey, preset]) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => handleInsertElement(presetKey as keyof typeof LAB_ELEMENT_PRESETS)}
                  className={`flex h-16 items-center justify-center rounded-2xl border ${
                    isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span
                    className="block h-8 w-8 rounded-xl border"
                    style={{
                      background: preset.fill,
                      borderColor: preset.stroke || 'transparent',
                      borderRadius: preset.shape === 'circle' ? '9999px' : preset.shape === 'pill' ? '9999px' : '12px',
                    }}
                  />
                </button>
              ))}
            </div>
          </details>
          <details className="space-y-3" open>
            <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Stickers</summary>
            <div className="grid grid-cols-2 gap-2" data-testid="lab-elements-stickers">
              {LAB_STICKER_PRESETS.map((sticker) => (
                <button
                  key={sticker.id}
                  type="button"
                  onClick={() => handleInsertPresetOverlay(sticker.preset, sticker.text)}
                  className={`rounded-2xl border px-3 py-2 text-left text-xs font-semibold ${
                    isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-100 hover:border-slate-700' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {sticker.label}
                </button>
              ))}
            </div>
          </details>
          <details className="space-y-3" open>
            <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Emoji</summary>
            <div className="grid grid-cols-4 gap-2" data-testid="lab-elements-emoji">
              {LAB_EMOJI_PRESETS.map((emoji) => (
                <button
                  key={`emoji_${emoji}`}
                  type="button"
                  onClick={() => handleInsertPresetOverlay('title', emoji)}
                  className={`flex h-12 items-center justify-center rounded-2xl border text-xl ${
                    isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-100 hover:border-slate-700' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </details>
          <details className="space-y-3" open>
            <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>GIFs</summary>
            <div className="grid gap-2" data-testid="lab-elements-gifs">
              {LAB_GIF_QUICK_SEARCHES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleQuickGifDiscovery(item.query)}
                  className={`rounded-2xl border px-3 py-2 text-left text-xs font-semibold ${
                    isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-100 hover:border-slate-700' : 'border-gray-200 bg-white text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className={`text-[11px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
              Quick GIF picks open the Images panel with motion-oriented discovery terms.
            </div>
          </details>
        </div>
      ) : null}
      {activePanel === 'record' ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button size="sm" variant="secondary" icon={<Mic size={14} />} onClick={() => { void startRecording('audio'); }}>
              {recordingState?.source === 'audio' ? 'Stop mic capture' : 'Record audio'}
            </Button>
            <Button size="sm" variant="secondary" icon={<Camera size={14} />} onClick={() => { void startRecording('camera'); }}>
              {recordingState?.source === 'camera' ? 'Stop camera capture' : 'Record camera'}
            </Button>
            <Button size="sm" variant="ghost" icon={<MonitorUp size={14} />} onClick={() => { void startRecording('screen'); }}>
              {recordingState?.source === 'screen' ? 'Stop screen capture' : 'Record screen'}
            </Button>
            <Button size="sm" variant="ghost" icon={<Layers3 size={14} />} onClick={() => { void startRecording('screen_camera'); }}>
              {recordingState?.source === 'screen_camera' ? 'Stop screen + mic' : 'Record screen + mic'}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button size="sm" variant="ghost" onClick={() => { void handleRecordProbe('audio'); }}>Check microphone</Button>
            <Button size="sm" variant="ghost" onClick={() => { void handleRecordProbe('camera'); }}>Check camera</Button>
            <Button size="sm" variant="ghost" onClick={() => { void handleRecordProbe('screen'); }}>Check screen share</Button>
          </div>
          <div className={`rounded-2xl border p-3 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-900/60 text-slate-400' : 'border-gray-200 bg-white text-gray-600'}`}>
            {recordingState
              ? `Recording ${recordingState.source.replace(/_/g, ' ')} locally for ${formatMs(recordingElapsedMs)}.`
              : recordHint}
          </div>
        </div>
      ) : null}
      {activePanel === 'tts' ? (
        <div className="space-y-3">
          <div className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-xs ${isDarkUi ? 'border-slate-800 bg-slate-950/70 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            <span>Engine</span>
            <span className={`font-semibold ${isDarkUi ? 'text-cyan-300' : 'text-cyan-700'}`}>{ttsEngineLabel}</span>
          </div>
          <select
            value={ttsVoiceOptions.length > 0 ? ttsVoiceId : ''}
            onChange={(event) => setTtsVoiceId(event.target.value)}
            className={`h-10 w-full rounded-2xl border px-3 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`}
            disabled={ttsVoiceOptions.length === 0}
          >
            {ttsVoiceOptions.length === 0 ? (
              <option value="">No voices available</option>
            ) : ttsVoiceOptions.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name || voice.id}
              </option>
            ))}
          </select>
          <div className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
            Using {selectedTtsVoice?.name || 'default'} ({ttsVoiceId || LAB_DEFAULT_TTS_VOICE_ID}) on {ttsEngineLabel}. Kokoro is disabled in Lab.
          </div>
          <textarea value={ttsText} onChange={(event) => setTtsText(event.target.value)} rows={6} className={`w-full rounded-2xl border px-3 py-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`} />
          <Button size="sm" variant="secondary" icon={<Sparkles size={14} />} onClick={() => { void handleCreateTtsClip(); }}>
            Generate narration clip
          </Button>
        </div>
      ) : null}
    </div>
  );

  const handleRefreshPreview = async () => {
    try {
      const blob = await runPreviewJob(state.session.clips, false);
      if (!blob) {
        onToast('Add at least one audio clip to build a preview mix.', 'info');
        return;
      }
      onToast('Preview mix refreshed locally.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onToast(error instanceof Error ? error.message : 'Preview refresh failed.', 'error');
    }
  };

  const shellGridClass = mode === 'desktop'
    ? 'grid-cols-[minmax(15rem,19vw)_minmax(0,1fr)_minmax(13.5rem,17vw)]'
    : mode === 'tablet'
      ? 'grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]'
      : 'grid-cols-1';

  const mobileActionButtons: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    disabled?: boolean;
    onClick: () => void;
  }> = [
    {
      id: 'split',
      label: 'Split',
      icon: <Scissors size={15} />,
      disabled: !selectedClip,
      onClick: () => dispatch({ type: 'split-selected-clip' }),
    },
    {
      id: 'edit',
      label: 'Edit',
      icon: <Pencil size={15} />,
      onClick: handleOpenMobileEditSheet,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <Layers3 size={15} />,
      disabled: !selectedClip,
      onClick: () => dispatch({ type: 'duplicate-selected-clip' }),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={15} />,
      disabled: !selectedClip,
      onClick: handleRemoveSelectedClip,
    },
    {
      id: 'time',
      label: 'Time',
      icon: <Clock3 size={15} />,
      disabled: !selectedClip,
      onClick: () => setMobileInspectorOpen(true),
    },
    {
      id: 'front',
      label: 'Front',
      icon: <BringToFront size={15} />,
      disabled: !selectedClip || !selectedClipAsset || !isVisualAssetKind(selectedClipAsset.kind),
      onClick: () => handleShiftSelectedLayer(1),
    },
    {
      id: 'back',
      label: 'Back',
      icon: <SendToBack size={15} />,
      disabled: !selectedClip || !selectedClipAsset || !isVisualAssetKind(selectedClipAsset.kind),
      onClick: () => handleShiftSelectedLayer(-1),
    },
  ];

  const inspectorContent = (
    <div className="space-y-4">
      <div>
        <div className={`text-xs font-bold uppercase tracking-[0.14em] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Inspector</div>
        <div className={`mt-1 text-lg font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{selectedClip?.label || selectedAsset?.name || 'Nothing selected'}</div>
        <div className={`text-sm ${isDarkUi ? 'text-slate-400' : 'text-gray-600'}`}>
          {selectedClip ? 'Non-destructive clip controls for fast local editing.' : 'Select a clip to tune gain, trim, fades, speed, pitch, EQ, and cleanup.'}
        </div>
      </div>

      {selectedClip ? (
        <div className="space-y-3">
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Start</div>
            <input type="range" min={0} max={timelineDurationMs} value={selectedClip.startMs} onChange={(event) => dispatch({ type: 'set-selected-clip-start', startMs: Number(event.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Trim In</div>
            <input type="range" min={0} max={Math.max(100, selectedAsset?.durationMs || selectedClip.trimEndMs)} value={selectedClip.trimStartMs} onChange={(event) => dispatch({ type: 'set-selected-clip-trim-start', trimStartMs: Number(event.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Trim Out</div>
            <input type="range" min={selectedClip.trimStartMs + 50} max={Math.max(selectedClip.trimStartMs + 50, selectedAsset?.durationMs || selectedClip.trimEndMs)} value={selectedClip.trimEndMs} onChange={(event) => dispatch({ type: 'set-selected-clip-trim-end', trimEndMs: Number(event.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Gain</div>
            <input type="range" min={0} max={2} step={0.01} value={selectedClip.gain} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { gain: Number(event.target.value) } })} className="w-full" />
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Speed</div>
            <input type="range" min={0.5} max={1.75} step={0.01} value={selectedClip.playbackRate} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { playbackRate: Number(event.target.value) } })} className="w-full" />
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Pitch</div>
            <input type="range" min={-6} max={6} step={1} value={selectedClip.pitchSemitones} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { pitchSemitones: Number(event.target.value) } })} className="w-full" />
          </label>
          <div className={`grid gap-3 ${isPhone ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <label className="block">
              <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Fade In</div>
              <input type="range" min={0} max={4000} step={50} value={selectedClip.fadeInMs} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { fadeInMs: Number(event.target.value) } })} className="w-full" />
            </label>
            <label className="block">
              <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Fade Out</div>
              <input type="range" min={0} max={4000} step={50} value={selectedClip.fadeOutMs} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { fadeOutMs: Number(event.target.value) } })} className="w-full" />
            </label>
          </div>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>EQ preset</div>
            <select value={selectedClip.eqPreset} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { eqPreset: event.target.value as LabClip['eqPreset'] } })} className={`h-10 w-full rounded-xl border px-3 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}>
              <option value="flat">Flat</option>
              <option value="warm">Warm</option>
              <option value="presence">Presence</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </label>
          <label className="block">
            <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Light denoise</div>
            <input type="range" min={0} max={1} step={0.05} value={selectedClip.denoiseAmount} onChange={(event) => dispatch({ type: 'patch-selected-clip', patch: { denoiseAmount: Number(event.target.value) } })} className="w-full" />
          </label>
          <div className={`grid gap-2 ${isPhone ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button type="button" onClick={() => dispatch({ type: 'patch-selected-clip', patch: { muted: !selectedClip.muted } })} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${selectedClip.muted ? (isDarkUi ? 'border-rose-500/35 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700') : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-600')}`}>
              {selectedClip.muted ? 'Muted' : 'Mute clip'}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'patch-selected-clip', patch: { solo: !selectedClip.solo } })} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${selectedClip.solo ? (isDarkUi ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-600')}`}>
              {selectedClip.solo ? 'Soloed' : 'Solo clip'}
            </button>
          </div>
          <button type="button" onClick={() => dispatch({ type: 'patch-selected-clip', patch: { normalize: !selectedClip.normalize } })} className={`w-full rounded-xl border px-3 py-3 text-xs font-semibold ${selectedClip.normalize ? (isDarkUi ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-100' : 'border-cyan-200 bg-cyan-50 text-cyan-700') : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-600')}`}>
            {selectedClip.normalize ? 'Clip normalize enabled' : 'Enable clip normalize'}
          </button>
          <div className={`space-y-3 rounded-2xl border p-3 ${isDarkUi ? 'border-slate-800 bg-slate-900/70 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-500">Transitions</div>
              <span className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                {activeTransition ? activeTransition.kind : 'No transition'}
              </span>
            </div>
            {selectedTransitionBoundary ? (
              <>
                <div className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                  {selectedTransitionBoundary.fromClip.label} to {selectedTransitionBoundary.toClip.label}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {LAB_TRANSITION_KINDS.map((option) => (
                    <button
                      key={option.kind}
                      type="button"
                      onClick={() => handleSetTransitionKind(option.kind)}
                      className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                        activeTransition?.kind === option.kind
                          ? isDarkUi
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                            : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                          : isDarkUi
                            ? 'border-slate-700 bg-slate-950 text-slate-300'
                            : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {activeTransition ? (
                  <>
                    {activeTransition.kind !== 'cut' ? (
                      <>
                        <label className="grid gap-1">
                          <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                            Duration {Math.round(activeTransition.durationMs)} ms
                          </span>
                          <input
                            type="range"
                            min={80}
                            max={1800}
                            step={20}
                            value={Math.max(80, Math.round(activeTransition.durationMs))}
                            onChange={(event) => handleUpdateActiveTransition({ durationMs: Number(event.target.value) })}
                            className="w-full"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Easing</span>
                          <select
                            value={activeTransition.easing}
                            onChange={(event) => handleUpdateActiveTransition({ easing: event.target.value as LabTransitionEasing })}
                            className={`h-9 rounded-xl border px-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                          >
                            {LAB_TRANSITION_EASING_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : (
                      <div className={`text-[11px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
                        Cut transitions switch instantly with no overlap duration.
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateActiveTransition({ enabled: !activeTransition.enabled })}
                        className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${activeTransition.enabled ? (isDarkUi ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-300' : 'border-gray-200 bg-white text-gray-700')}`}
                      >
                        {activeTransition.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'remove-transition', transitionId: activeTransition.id })}
                        className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${isDarkUi ? 'border-rose-500/35 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700'}`}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className={`text-[11px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
                Select a clip that has a neighboring clip on the same layer to apply transitions.
              </div>
            )}
          </div>
          {selectedClipAsset && isVisualAssetKind(selectedClipAsset.kind) ? (
            <div className={`space-y-3 rounded-2xl border p-3 ${isDarkUi ? 'border-slate-800 bg-slate-900/70 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-500">Stage</div>
              <label className="block">
                <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Horizontal position</div>
                <input type="range" min={0} max={100} step={1} value={selectedClip.stageTransform.xPercent} onChange={(event) => handleUpdateSelectedClipTransform({ xPercent: Number(event.target.value) })} className="w-full" />
              </label>
              <label className="block">
                <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Vertical position</div>
                <input type="range" min={0} max={100} step={1} value={selectedClip.stageTransform.yPercent} onChange={(event) => handleUpdateSelectedClipTransform({ yPercent: Number(event.target.value) })} className="w-full" />
              </label>
              <div className={`grid gap-3 ${isPhone ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Width</div>
                  <input type="range" min={6} max={100} step={1} value={selectedClip.stageTransform.widthPercent} onChange={(event) => handleUpdateSelectedClipTransform({ widthPercent: Number(event.target.value) })} className="w-full" />
                </label>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Height</div>
                  <input type="range" min={6} max={100} step={1} value={selectedClip.stageTransform.heightPercent} onChange={(event) => handleUpdateSelectedClipTransform({ heightPercent: Number(event.target.value) })} className="w-full" />
                </label>
              </div>
              <div className={`grid gap-3 ${isPhone ? 'grid-cols-1' : 'grid-cols-3'}`}>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Scale</div>
                  <input type="range" min={0.2} max={2.4} step={0.05} value={selectedClip.stageTransform.scale} onChange={(event) => handleUpdateSelectedClipTransform({ scale: Number(event.target.value) })} className="w-full" />
                </label>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Rotation</div>
                  <input type="range" min={-180} max={180} step={1} value={selectedClip.stageTransform.rotationDeg} onChange={(event) => handleUpdateSelectedClipTransform({ rotationDeg: Number(event.target.value) })} className="w-full" />
                </label>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Opacity</div>
                  <input type="range" min={0.1} max={1} step={0.01} value={selectedClip.stageTransform.opacity} onChange={(event) => handleUpdateSelectedClipTransform({ opacity: Number(event.target.value) })} className="w-full" />
                </label>
              </div>
              <label className="block">
                <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Layer order</div>
                <input type="range" min={0} max={100} step={1} value={selectedClip.stageTransform.zIndex} onChange={(event) => handleUpdateSelectedClipTransform({ zIndex: Number(event.target.value) })} className="w-full" />
              </label>
            </div>
          ) : null}
          {selectedAsset?.kind === 'text' && selectedAsset.textStyle ? (
            <div className="space-y-3">
              <textarea value={selectedAsset.textStyle.text} onChange={(event) => {
                dispatch({ type: 'update-asset', assetId: selectedAsset.id, patch: { textStyle: { ...selectedAsset.textStyle!, text: event.target.value } } });
                setTextDraft(event.target.value);
              }} rows={4} className={`w-full rounded-2xl border px-3 py-2 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-gray-800'}`} />
              <div className={`grid gap-3 ${isPhone ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Text color</div>
                  <input type="color" value={selectedAsset.textStyle.color} onChange={(event) => dispatch({ type: 'update-asset', assetId: selectedAsset.id, patch: { textStyle: { ...selectedAsset.textStyle!, color: event.target.value } } })} className="h-10 w-full rounded-xl border border-transparent bg-transparent" />
                </label>
                <label className="block">
                  <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Background</div>
                  <input type="color" value={(selectedAsset.textStyle.backgroundColor || '#000000').slice(0, 7)} onChange={(event) => dispatch({ type: 'update-asset', assetId: selectedAsset.id, patch: { textStyle: { ...selectedAsset.textStyle!, backgroundColor: event.target.value } } })} className="h-10 w-full rounded-xl border border-transparent bg-transparent" />
                </label>
              </div>
            </div>
          ) : null}
          {selectedAsset?.kind === 'element' && selectedAsset.elementStyle ? (
            <div className={`grid gap-3 ${isPhone ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <label className="block">
                <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Fill</div>
                <input type="color" value={selectedAsset.elementStyle.fill.slice(0, 7)} onChange={(event) => dispatch({ type: 'update-asset', assetId: selectedAsset.id, patch: { elementStyle: { ...selectedAsset.elementStyle!, fill: event.target.value } } })} className="h-10 w-full rounded-xl border border-transparent bg-transparent" />
              </label>
              <label className="block">
                <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Stroke</div>
                <input type="color" value={(selectedAsset.elementStyle.stroke || '#ffffff').slice(0, 7)} onChange={(event) => dispatch({ type: 'update-asset', assetId: selectedAsset.id, patch: { elementStyle: { ...selectedAsset.elementStyle!, stroke: event.target.value } } })} className="h-10 w-full rounded-xl border border-transparent bg-transparent" />
              </label>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={`rounded-2xl border border-dashed p-4 text-sm ${isDarkUi ? 'border-slate-800 text-slate-500' : 'border-gray-200 text-gray-500'}`}>
          Import media, add a text or image layer, or start a browser recording to bring the editor to life.
        </div>
      )}
    </div>
  );

  return (
    <div className={isPhone ? 'space-y-4 pb-4' : 'vf-lab-compact flex h-full min-h-0 flex-col gap-2.5 text-[12px]'}>
      <audio ref={previewAudioRef} src={previewUrl} className="hidden" />
      <input
        ref={mediaImportInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        onChange={handleMediaInputChange}
        className="hidden"
      />
      <input
        ref={audioImportInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        onChange={handleAudioInputChange}
        className="hidden"
      />
      <input
        ref={videoImportInputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple
        onChange={handleVideoInputChange}
        className="hidden"
        disabled={!activeCapabilities.videoImportEnabled}
      />
      <input
        ref={imageImportInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        onChange={handleImageInputChange}
        className="hidden"
      />

      {!isPhone ? (
        <SectionCard className={`shrink-0 rounded-[20px] ${shellCardPadding} ${isDarkUi ? 'border-slate-800 bg-slate-950/85' : 'border-gray-200 bg-white'}`}>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]" data-testid="lab-topbar">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${isDarkUi ? 'border-slate-800 bg-slate-900/80' : 'border-gray-200 bg-gray-50'}`}>
                <BrandLogo size="sm" tone={isDarkUi ? 'light' : 'dark'} showWordmark={false} />
              </div>
              <div className="min-w-0">
                <div className={`truncate text-[15px] font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Lab workspace</div>
                <div className={`truncate text-[11px] font-semibold tracking-wide ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{projectDateLabel}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              <div className={`flex items-center gap-2 rounded-xl border p-1 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}>
                <button
                  type="button"
                  aria-label="Undo"
                  onClick={() => dispatch({ type: 'undo' })}
                  disabled={!state.historyPast.length}
                  className={`flex ${compactIconButtonClass} items-center justify-center rounded-xl border transition ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 disabled:text-slate-600' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 disabled:text-gray-400'}`}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Redo"
                  onClick={() => dispatch({ type: 'redo' })}
                  disabled={!state.historyFuture.length}
                  className={`flex ${compactIconButtonClass} items-center justify-center rounded-xl border transition ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 disabled:text-slate-600' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 disabled:text-gray-400'}`}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <button
                type="button"
                aria-label="Premium"
                title="Premium"
                onClick={() => undefined}
                className={`flex ${compactIconButtonClass} items-center justify-center rounded-xl border ${isDarkUi ? 'border-amber-500/20 bg-amber-500/10 text-amber-200 hover:border-amber-400/30' : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300'}`}
              >
                <Crown size={16} />
              </button>
              <Button size="sm" variant="secondary" icon={<Video size={14} />} onClick={() => { void handleQueueMp4Export(); }}>
                Export
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className={`grid ${isPhone ? '' : 'min-h-0 flex-1'} ${shellVerticalGapClass} ${shellGridClass}`} data-testid="lab-shell">
        {!isPhone ? (
        <SectionCard className={`min-h-0 overflow-hidden rounded-3xl ${shellCardPadding} ${isDarkUi ? 'border-slate-800 bg-slate-950/80' : 'border-gray-200 bg-white'}`}>
          <div className={`grid h-full min-h-0 gap-3 ${mode === 'desktop' ? 'grid-cols-[64px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
            <div
              className={`flex ${mode === 'desktop' ? 'flex-col items-center' : 'flex-row items-center justify-start overflow-x-auto'} gap-1 rounded-[18px] border px-1.5 py-1.5 ${isDarkUi ? 'border-slate-800 bg-[#070b16]' : 'border-gray-200 bg-gray-50'}`}
              data-testid="lab-rail"
            >
              <button
                type="button"
                aria-label={primaryRailActionLabel}
                title={primaryRailActionLabel}
                onClick={handlePrimaryRailAction}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] transition hover:bg-blue-500"
              >
                <Plus size={20} />
              </button>
              <div className={`h-px w-8 shrink-0 ${isDarkUi ? 'bg-slate-800' : 'bg-gray-200'}`} />
              <div className={`flex ${mode === 'desktop' ? 'flex-col' : 'flex-row'} gap-2`}>
                {LAB_PANELS.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    onClick={() => setActivePanel(panel.id)}
                    className={`flex flex-col items-center gap-1 rounded-xl text-center font-semibold transition ${railPanelButtonClass} ${
                      activePanel === panel.id
                        ? isDarkUi
                          ? 'bg-slate-800 text-cyan-100'
                          : 'bg-cyan-50 text-cyan-700'
                        : isDarkUi
                          ? 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                          : 'text-gray-500 hover:bg-white hover:text-gray-900'
                    }`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${activePanel === panel.id ? (isDarkUi ? 'bg-cyan-500/12 text-cyan-200' : 'bg-cyan-100 text-cyan-700') : (isDarkUi ? 'bg-slate-900 text-slate-300' : 'bg-gray-100 text-gray-600')}`}>
                      {getRailPanelIcon(panel.id, ultraCompactUi ? 13 : compactUi ? 14 : 16)}
                    </span>
                    <span className="leading-tight">{panel.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={`flex min-w-0 min-h-0 flex-col overflow-hidden rounded-[20px] border ${isDarkUi ? 'border-slate-800 bg-[#0a0f1d]' : 'border-gray-200 bg-white'}`} data-testid="lab-panel">
              <div className={`flex items-start justify-between gap-2.5 border-b ${panelHeaderPaddingClass} ${isDarkUi ? 'border-slate-800 bg-slate-950/55' : 'border-gray-200 bg-gray-50/80'}`}>
                <div className="min-w-0">
                  <div className={`text-[11px] font-bold uppercase tracking-[0.14em] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>{projectDateLabel}</div>
                  <div className={`mt-1 truncate text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{activePanelMeta.label}</div>
                  <div className={`mt-1 text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-600'}`}>{activePanelMeta.detail}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${isDarkUi ? 'bg-slate-900 text-slate-300' : 'bg-gray-100 text-gray-600'}`}>
                  {state.session.assets.length} assets
                </span>
              </div>

              <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto ${panelContentPaddingClass}`}>
                {panelContent}
              </div>
            </div>
          </div>
        </SectionCard>
        ) : null}

        <div className={`flex min-h-0 flex-col ${middleColumnGapClass}`}>
          <SectionCard className={`shrink-0 rounded-3xl ${shellCardPadding} ${isDarkUi ? 'border-slate-800 bg-slate-950/80' : 'border-gray-200 bg-white'}`}>
            <div className={`${isPhone ? 'sticky top-3 z-10 -mx-3 rounded-2xl px-3 py-3 backdrop-blur' : ''} flex flex-wrap items-center justify-between ${compactUi ? 'gap-1.5' : 'gap-3'} border-b pb-2.5 ${isDarkUi ? 'border-slate-800 bg-slate-950/90' : 'border-gray-200 bg-white/90'}`}>
              {isPhone ? (
                <>
                  <button
                    type="button"
                    aria-label="Back"
                    onClick={() => setMobileInspectorOpen(false)}
                    className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Undo"
                      onClick={() => dispatch({ type: 'undo' })}
                      disabled={!state.historyPast.length}
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200 disabled:text-slate-600' : 'border-gray-200 bg-white text-gray-700 disabled:text-gray-400'}`}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Redo"
                      onClick={() => dispatch({ type: 'redo' })}
                      disabled={!state.historyFuture.length}
                      className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200 disabled:text-slate-600' : 'border-gray-200 bg-white text-gray-700 disabled:text-gray-400'}`}
                    >
                      <Redo2 size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="Export"
                    onClick={() => { void handleQueueMp4Export(); }}
                    className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${isDarkUi ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-gray-200 bg-white text-gray-700'}`}
                  >
                    <Share2 size={18} />
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <div className={`text-xs font-bold uppercase tracking-[0.14em] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Preview</div>
                    <div className={`mt-0.5 text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{selectedAsset?.name || 'Lab stage preview'}</div>
                    <div className={`text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-600'}`}>{state.session.canvas.label} | {state.session.canvas.aspectLabel} | {clipSummaryLabel}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" icon={isTransportPlaying ? <Pause size={14} /> : <Play size={14} />} onClick={() => { void handleTogglePlayback(); }} disabled={!previewUrl && !activeStageEntries.length && !state.session.clips.length}>
                      {isTransportPlaying ? 'Pause' : 'Play'}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Waves size={14} />} onClick={() => { void handleRefreshPreview(); }} disabled={!state.session.clips.some((clip) => pcmDataByAssetIdRef.current.has(clip.assetId))}>
                      Refresh preview
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Sparkles size={14} />} onClick={() => { void handleExportMix(); }}>
                      Export WAV
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Video size={14} />} onClick={() => { void handleExportWebm(); }}>
                      Export WebM
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={handleRemoveSelectedClip} disabled={!selectedClip}>
                      Delete clip
                    </Button>
                  </div>
                </>
              )}
            </div>

            {isPhone ? (
              <div className="mt-3">
                <div className={`text-base font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{selectedAsset?.name || 'Lab stage preview'}</div>
                <div className={`text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-600'}`}>{state.session.canvas.label} | {state.session.canvas.aspectLabel} | {clipSummaryLabel}</div>
              </div>
            ) : null}

            <div className="mt-2.5">
              <div className={`rounded-2xl border p-2 ${isDarkUi ? 'border-slate-800 bg-black/40' : 'border-gray-200 bg-gray-50'}`}>
                <div
                  ref={previewStageRef}
                  data-testid="lab-stage"
                  className="mx-auto overflow-hidden rounded-2xl border"
                  style={{
                    aspectRatio: `${state.session.canvas.width}/${state.session.canvas.height}`,
                    background: state.session.canvas.background,
                    borderColor: isDarkUi ? 'rgba(30, 41, 59, 0.9)' : 'rgba(229, 231, 235, 1)',
                    maxHeight: `${stageMaxHeightPx}px`,
                    maxWidth: `${stageMaxWidthPx}px`,
                    width: '100%',
                  }}
                >
                  <div className="relative h-full w-full">
                    {activeStageEntries.map((entry) => {
                      const sharedStyle = buildStageStyle(entry.clip.stageTransform);
                      if ((entry.asset.kind === 'video' || entry.asset.kind === 'recording') && entry.asset.objectUrl) {
                        return (
                          <video
                            key={entry.clip.id}
                            ref={(element) => {
                              stageVideoRefs.current[entry.clip.id] = element;
                            }}
                            src={entry.asset.objectUrl}
                            poster={entry.asset.posterUrl}
                            className="absolute bg-black object-cover"
                            style={sharedStyle}
                            playsInline
                            muted
                          />
                        );
                      }
                      if (entry.asset.kind === 'image' && entry.asset.objectUrl) {
                        return (
                          <img
                            key={entry.clip.id}
                            src={entry.asset.objectUrl}
                            alt={entry.asset.name}
                            className="absolute object-cover"
                            style={sharedStyle}
                          />
                        );
                      }
                      if (entry.asset.kind === 'text' && entry.asset.textStyle) {
                        return (
                          <div
                            key={entry.clip.id}
                            className="absolute flex items-center justify-center px-4"
                            style={{
                              ...sharedStyle,
                              color: entry.asset.textStyle.color,
                              background: entry.asset.textStyle.backgroundColor || 'transparent',
                              fontFamily: entry.asset.textStyle.fontFamily,
                              fontSize: `${Math.max(16, entry.asset.textStyle.fontSize * (state.session.canvas.height / 1080))}px`,
                              fontWeight: entry.asset.textStyle.fontWeight,
                              lineHeight: String(entry.asset.textStyle.lineHeight),
                              letterSpacing: `${entry.asset.textStyle.letterSpacing}px`,
                              textAlign: entry.asset.textStyle.textAlign,
                              textShadow: entry.asset.textStyle.shadow ? '0 10px 24px rgba(15,23,42,0.32)' : undefined,
                            }}
                          >
                            <span className="block w-full">{entry.asset.textStyle.text}</span>
                          </div>
                        );
                      }
                      if (entry.asset.kind === 'element' && entry.asset.elementStyle) {
                        return (
                          <div
                            key={entry.clip.id}
                            className="absolute"
                            style={{
                              ...sharedStyle,
                              borderRadius: entry.asset.elementStyle.shape === 'circle'
                                ? '9999px'
                                : entry.asset.elementStyle.shape === 'pill'
                                  ? '9999px'
                                  : `${Math.max(8, entry.asset.elementStyle.radius || 18)}px`,
                              background: entry.asset.elementStyle.shape === 'frame' ? 'transparent' : entry.asset.elementStyle.fill,
                              border: `${entry.asset.elementStyle.strokeWidth || 0}px solid ${entry.asset.elementStyle.stroke || 'transparent'}`,
                            }}
                          />
                        );
                      }
                      return null;
                    })}
                    {activeStageEntries.length === 0 ? (
                      <div className={`flex h-full items-center justify-center border border-dashed ${isDarkUi ? 'border-slate-800 text-slate-500' : 'border-gray-200 text-gray-500'}`}>
                        <div className="text-center">
                          <Waves size={28} className="mx-auto mb-2" />
                          <div className="text-sm font-semibold">{previewUrl ? 'Mix preview ready' : (selectedClip ? 'Move the playhead into the selected clip to see it on stage.' : 'Import media or add overlays to build the stage.')}</div>
                          <div className="mt-1 text-xs">All editing and rendering stays on the client device.</div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2.5 space-y-2">
                  <label className="block">
                    <div className={`mb-1 text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Playhead</div>
                    <input
                      type="range"
                      min={0}
                      max={timelineDurationMs}
                      value={Math.min(timelineDurationMs, state.session.transport.playheadMs)}
                      onChange={(event) => handleSeek(Number(event.target.value))}
                      className="w-full"
                    />
                  </label>
                  <div className={`flex items-center justify-between text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                    <span>{formatMs(state.session.transport.playheadMs)}</span>
                    <span>{formatMs(timelineDurationMs)}</span>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard className={`rounded-3xl ${shellCardPadding} ${isPhone ? '' : 'flex flex-1 min-h-0 flex-col'} ${isDarkUi ? 'border-slate-800 bg-slate-950/80' : 'border-gray-200 bg-white'}`}>
            <div className={`${isPhone ? 'sticky top-24 z-10 -mx-3 rounded-2xl px-3 py-3 backdrop-blur' : ''} flex flex-wrap items-center justify-between ${compactUi ? 'gap-1.5' : 'gap-3'} border-b pb-2.5 ${isDarkUi ? 'border-slate-800 bg-slate-950/90' : 'border-gray-200 bg-white/90'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" icon={<Scissors size={14} />} title="Split clip (S)" onClick={() => dispatch({ type: 'split-selected-clip' })} disabled={!selectedClip}>
                  Split
                </Button>
                <Button size="sm" variant="ghost" icon={<Sparkles size={14} />} title="Duplicate clip (Ctrl/Cmd + D)" onClick={() => dispatch({ type: 'duplicate-selected-clip' })} disabled={!selectedClip}>
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} title="Delete selected clip (Delete)" onClick={handleRemoveSelectedClip} disabled={!selectedClip}>
                  Delete
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={isTransportPlaying ? <Pause size={14} /> : <Play size={14} />} onClick={() => { void handleTogglePlayback(); }} disabled={!previewUrl && !activeStageEntries.length && !state.session.clips.length}>
                  {isTransportPlaying ? 'Pause' : 'Play'}
                </Button>
                <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} title="Nudge playhead left (Arrow Left)" onClick={() => handleNudgePlayhead(-TIMELINE_KEYBOARD_STEP_MS)}>
                  Prev
                </Button>
                <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} className="rotate-180" />} title="Nudge playhead right (Arrow Right)" onClick={() => handleNudgePlayhead(TIMELINE_KEYBOARD_STEP_MS)}>
                  Next
                </Button>
                <div className={`text-xs font-semibold tabular-nums ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>
                  {formatMs(state.session.transport.playheadMs)} / {formatMs(timelineDurationMs)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" icon={<Waves size={14} />} onClick={() => { void handleRefreshPreview(); }} disabled={!state.session.clips.some((clip) => pcmDataByAssetIdRef.current.has(clip.assetId))}>
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Clock3 size={14} />}
                  title="Toggle timeline snap precision"
                  onClick={() => setTimelineSnapEnabled((previous) => !previous)}
                >
                  {timelineSnapEnabled ? `Snap ${timelineSnapStepMs}ms` : 'Snap off'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'set-zoom', zoomLevel: state.session.transport.zoomLevel - 0.25 })}>-</Button>
                <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'set-zoom', zoomLevel: state.session.transport.zoomLevel + 0.25 })}>+</Button>
                {isPhone ? (
                  <Button size="sm" variant="secondary" onClick={() => setMobileInspectorOpen(true)} disabled={!selectedClip && !selectedAsset}>
                    Inspector
                  </Button>
                ) : mode === 'tablet' ? (
                  <Button size="sm" variant="secondary" onClick={() => setTabletInspectorOpen(true)} disabled={!selectedClip && !selectedAsset}>
                    Inspector
                  </Button>
                ) : null}
              </div>
            </div>
            <div className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
              {state.session.clips.length} clips | {timelineRows.length} layers | {audioAssets.length} audio | {videoAssets.length} video/record | {textAssets.length + imageAssets.length + elementAssets.length} visual overlays
            </div>
            <div className={`mt-1 text-[10px] ${isDarkUi ? 'text-slate-500' : 'text-gray-500'}`}>
              Shortcuts: Space play/pause, S split, Ctrl/Cmd+D duplicate, Delete remove, Arrow move playhead, Alt+Arrow move selected clip.
            </div>

            <div ref={timelineScrollRef} className="mt-2 min-h-0 flex-1 overflow-auto pb-1.5" data-testid="lab-timeline-scroll">
              <div className={`relative ${timelineMinHeightClass}`} style={{ width: `${timelineWidth}px` }}>
                <div className={`sticky top-0 z-20 h-7 border-b ${isDarkUi ? 'border-slate-800/80 bg-slate-950/95' : 'border-gray-200 bg-white/95'}`}>
                  {timelineRulerMarks.map((markMs) => {
                    const left = (markMs / timelineDurationMs) * timelineWidth;
                    const showLabel = markMs === 0 || markMs === timelineDurationMs || (markMs % timelineRulerLabelStepMs === 0);
                    return (
                      <div key={`tick_${markMs}`} className="absolute bottom-0" style={{ left: `${left}px` }}>
                        <span className={`block w-px ${showLabel ? 'h-3.5' : 'h-2'} ${isDarkUi ? 'bg-slate-500/70' : 'bg-gray-400/80'}`} />
                        {showLabel ? (
                          <span className={`absolute -left-1 top-0 translate-y-[-1px] text-[10px] tabular-nums ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                            {formatMs(markMs)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div
                  className={`absolute inset-y-0 w-px ${isDarkUi ? 'bg-cyan-400/70' : 'bg-cyan-500'}`}
                  style={{ left: `${(state.session.transport.playheadMs / timelineDurationMs) * timelineWidth}px` }}
                />
                <div className="pt-8">
                {timelineRows.map((row) => {
                  const rowBoundaries = timelineTransitionBoundaryByRow.get(row.rowId) || [];
                  const rowVisibleClips = row.clips.filter((clip) => {
                    const clipEndMs = clip.startMs + getClipDurationMs(clip);
                    return clipEndMs >= timelineRenderWindow.startMs && clip.startMs <= timelineRenderWindow.endMs;
                  });
                  const visibleBoundaries = rowBoundaries.filter((boundary) => (
                    boundary.anchorMs >= timelineRenderWindow.startMs && boundary.anchorMs <= timelineRenderWindow.endMs
                  ));
                  const waveformBars = cpuOptimizedTimelineEnabled
                    ? 14
                    : (activeCapabilities.waveformDetail === 'full' && !isPhone ? 40 : 24);
                  return (
                  <div
                    key={row.rowId}
                    onDragOver={(event) => {
                      if (!draggedTimelineRowId && !draggedClipId) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      if (!draggedTimelineRowId || draggedClipId) return;
                      event.preventDefault();
                      handleMoveTimelineRow(draggedTimelineRowId, row.rowId);
                      setDraggedTimelineRowId('');
                    }}
                    className={`mb-2.5 rounded-2xl border ${isDarkUi ? 'border-slate-800 bg-slate-900/70' : 'border-gray-200 bg-gray-50'}`}
                  >
                    <div className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          setDraggedClipId('');
                          setDraggedTimelineRowId(row.rowId);
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', row.rowId);
                          }
                        }}
                        onDragEnd={() => setDraggedTimelineRowId('')}
                        className={`rounded-md p-1 ${isDarkUi ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}
                        title="Drag to reorder layer"
                        aria-label={`Reorder layer ${row.layerOrder + 1}`}
                      >
                        <GripVertical size={14} />
                      </button>
                      <span>Layer {row.layerOrder + 1}</span>
                    </div>
                    <div
                      className={`relative cursor-pointer ${timelineLaneHeightClass}`}
                      onDragOver={(event) => {
                        if (!draggedClipId) return;
                        event.preventDefault();
                        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        if (!draggedClipId) return;
                        event.preventDefault();
                        const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const offset = Math.max(0, event.clientX - rect.left);
                        const ratio = rect.width <= 0 ? 0 : offset / rect.width;
                        const nextStartMs = Math.round(ratio * timelineDurationMs);
                        handleMoveClipToRowAtTime(draggedClipId, row.rowId, nextStartMs);
                        setDraggedClipId('');
                      }}
                      onClick={(event) => {
                        const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const offset = Math.max(0, event.clientX - rect.left);
                        const ratio = rect.width <= 0 ? 0 : offset / rect.width;
                        handleSeek(quantizeTimelineMs(Math.round(ratio * timelineDurationMs)));
                      }}
                    >
                      {rowVisibleClips.map((clip) => {
                        const asset = assetById.get(clip.assetId);
                        const durationMs = getClipDurationMs(clip);
                        const left = (clip.startMs / timelineDurationMs) * timelineWidth;
                        const width = Math.max(76, (durationMs / timelineDurationMs) * timelineWidth);
                        const peaks = activeCapabilities.waveformDetail === 'full' && !isPhone
                          ? asset?.waveform?.detail || asset?.waveform?.coarse || []
                          : asset?.waveform?.coarse || [];
                        const isAudioLike = asset?.kind === 'audio' || asset?.kind === 'tts' || asset?.kind === 'recording';
                        const thumbnailStyle = asset?.posterUrl
                          ? { backgroundImage: `url(${asset.posterUrl})` }
                          : asset?.objectUrl && asset.kind === 'image'
                            ? { backgroundImage: `url(${asset.objectUrl})` }
                            : undefined;
                        return (
                          <button
                            key={clip.id}
                            type="button"
                            draggable
                            ref={(element) => {
                              clipButtonRefs.current[clip.id] = element;
                            }}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              setDraggedTimelineRowId('');
                              setDraggedClipId(clip.id);
                              dispatch({ type: 'set-selected-clip', clipId: clip.id });
                              dispatch({ type: 'set-selected-asset', assetId: clip.assetId });
                              if (event.dataTransfer) {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', clip.id);
                              }
                            }}
                            onDragEnd={() => setDraggedClipId('')}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectTimelineClip(clip);
                            }}
                            className={`${timelineClipClass} ${
                              cpuOptimizedTimelineEnabled ? 'shadow-none transition-colors' : ''
                            } ${
                              state.selectedClipId === clip.id
                                ? isDarkUi
                                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-50'
                                  : 'border-cyan-300 bg-cyan-50 text-cyan-700'
                                : isDarkUi
                                  ? 'border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                            }`}
                            style={{ left: `${left}px`, width: `${width}px` }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-bold">{clip.label}</span>
                              <span className="text-[10px] opacity-70">{formatMs(durationMs)}</span>
                            </div>
                            {isAudioLike ? (
                              <div className={`mt-1.5 flex items-end gap-[2px] ${timelineWaveHeightClass}`}>
                                {(peaks.slice(0, waveformBars).length ? peaks.slice(0, waveformBars) : [0.35, 0.5, 0.25, 0.62, 0.44]).map((peak, index) => (
                                  <span
                                    key={`${clip.id}_${index}`}
                                    className={`w-1 rounded-full ${state.selectedClipId === clip.id ? (isDarkUi ? 'bg-cyan-300/70' : 'bg-cyan-500/70') : (isDarkUi ? 'bg-slate-400/60' : 'bg-gray-400/60')}`}
                                    style={{ height: `${Math.max(18, peak * 100)}%` }}
                                  />
                                ))}
                              </div>
                            ) : asset?.kind === 'text' ? (
                              <div className="mt-3 truncate text-sm font-semibold">{asset.textStyle?.text || clip.label}</div>
                            ) : (
                              <div className={`mt-2 h-8 rounded-xl bg-cover bg-center ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`} style={thumbnailStyle} />
                            )}
                          </button>
                        );
                      })}
                      {visibleBoundaries.map((boundary) => {
                        const left = (boundary.anchorMs / timelineDurationMs) * timelineWidth;
                        const label = boundary.transition
                          ? LAB_TRANSITION_KINDS.find((item) => item.kind === boundary.transition?.kind)?.label || 'Transition'
                          : 'Add';
                        const isActive = Boolean(activeTransition && boundary.transition?.id === activeTransition.id);
                        return (
                          <button
                            key={`${boundary.rowId}_${boundary.fromClip.id}_${boundary.toClip.id}`}
                            type="button"
                            title={`${boundary.fromClip.label} to ${boundary.toClip.label}`}
                            aria-label={`Transition ${boundary.fromClip.label} to ${boundary.toClip.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectTransitionBoundary(boundary);
                            }}
                            className={`absolute -top-2 z-30 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              isActive
                                ? (isDarkUi ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100' : 'border-cyan-300 bg-cyan-50 text-cyan-700')
                                : boundary.transition
                                  ? (isDarkUi ? 'border-slate-600 bg-slate-900 text-slate-200 hover:border-cyan-400' : 'border-gray-300 bg-white text-gray-700 hover:border-cyan-300')
                                  : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-400 hover:border-cyan-400' : 'border-gray-300 bg-white text-gray-500 hover:border-cyan-300')
                            }`}
                            style={{ left: `${Math.max(8, left - 20)}px` }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {mode === 'desktop' ? (
          <SectionCard
            className={`min-h-0 max-h-[calc(100dvh-7rem)] overflow-auto rounded-3xl ${shellCardPadding} ${isDarkUi ? 'border-slate-800 bg-slate-950/80' : 'border-gray-200 bg-white'}`}
            data-testid="lab-inspector"
          >
            {inspectorContent}
          </SectionCard>
        ) : null}

      </div>

      {mode === 'tablet' && tabletInspectorOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[58] bg-black/45"
            onClick={() => setTabletInspectorOpen(false)}
            aria-label="Close inspector"
          />
          <SectionCard
            className={`fixed inset-y-3 right-3 z-[59] w-[min(24rem,calc(100vw-1.5rem))] overflow-auto rounded-3xl border px-4 py-4 ${isDarkUi ? 'border-slate-800 bg-slate-950' : 'border-gray-200 bg-white'}`}
            data-testid="lab-tablet-inspector"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className={`text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>Inspector</div>
              <Button size="sm" variant="ghost" onClick={() => setTabletInspectorOpen(false)}>
                Close
              </Button>
            </div>
            {inspectorContent}
          </SectionCard>
        </>
      ) : null}

      {isPhone ? (
        <SectionCard
          className={`sticky bottom-3 z-30 rounded-[28px] border px-3 py-3 backdrop-blur ${isDarkUi ? 'border-slate-800 bg-slate-950/95' : 'border-gray-200 bg-white/95'}`}
          data-testid="lab-mobile-inspector"
        >
          {mobileInspectorOpen ? (
            <div className={`mb-3 space-y-4 border-b pb-3 ${isDarkUi ? 'border-slate-800' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={`text-[11px] font-bold uppercase tracking-[0.14em] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Mobile tools</div>
                  <div className={`mt-1 text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{activePanelMeta.label}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setMobileInspectorOpen(false)}>
                  Close
                </Button>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {LAB_PANELS.map((panel) => (
                  <button
                    key={`mobile_${panel.id}`}
                    type="button"
                    onClick={() => setActivePanel(panel.id)}
                    className={`flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold ${
                      activePanel === panel.id
                        ? isDarkUi
                          ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-100'
                          : 'border-cyan-200 bg-cyan-50 text-cyan-700'
                        : isDarkUi
                          ? 'border-slate-800 bg-slate-950 text-slate-300'
                          : 'border-gray-200 bg-white text-gray-700'
                    }`}
                  >
                    {getRailPanelIcon(panel.id, 14)}
                    {panel.label}
                  </button>
                ))}
              </div>

              <div className="max-h-[46vh] space-y-4 overflow-auto pr-1">
                {(selectedClip || selectedAsset) ? (
                  <details className="space-y-3" open>
                    <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>
                      Inspector
                    </summary>
                    {inspectorContent}
                  </details>
                ) : null}

                <details className="space-y-3" open>
                  <summary className={`list-none text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>
                    Tools
                  </summary>
                  {panelContent}
                </details>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {mobileActionButtons.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold ${
                  action.disabled
                    ? isDarkUi
                      ? 'text-slate-600'
                      : 'text-gray-400'
                    : isDarkUi
                      ? 'text-slate-200 hover:bg-slate-900'
                      : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-2xl ${isDarkUi ? 'bg-slate-900' : 'bg-gray-100'}`}>
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
            <button
              type="button"
              aria-label={mobileInspectorOpen ? 'Collapse mobile tools' : 'Open mobile tools'}
              onClick={() => setMobileInspectorOpen((open) => !open)}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold ${isDarkUi ? 'text-slate-200 hover:bg-slate-900' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${isDarkUi ? 'bg-slate-800' : 'bg-gray-100'}`}>
                <ChevronDown size={18} className={mobileInspectorOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </span>
              More
            </button>
          </div>
        </SectionCard>
      ) : null}

      {state.job && (
        <SectionCard className={`rounded-2xl px-4 py-3 ${isDarkUi ? 'border-slate-800 bg-slate-950/80' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{state.job.message}</div>
              <div className={`text-xs ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                {state.job.runtime ? `${state.job.runtime} | ` : ''}{state.job.status.toUpperCase()}
                {state.job.error ? ` | ${state.job.error}` : ''}
              </div>
            </div>
            <div className={`min-w-[160px] rounded-full border p-1 ${isDarkUi ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-gray-50'}`}>
              <div
                className={`h-2 rounded-full transition-all ${state.job.status === 'error' ? 'bg-rose-500' : 'bg-cyan-500'}`}
                style={{ width: `${Math.max(4, Math.min(100, state.job.progressPct || 0))}%` }}
              />
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
};

export default LabTabContent;
