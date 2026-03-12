import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Download, Loader2, Mic2, Square, Wand2 } from 'lucide-react';
import { AudioPlayer } from '../../../../components/AudioPlayer';
import { Button } from '../../../../components/Button';
import { SectionCard } from '../../../../components/SectionCard';
import type { GenerationSettings, VoiceOption } from '../../../../types';
import { autoFormatScript, generateTextContent, parseMultiSpeakerScript } from '../../../../services/geminiService';
import { resolveApiUrl } from '../../../shared/api/config';
import type { RuntimeVoiceItem, TtsJobStatusResponse } from '../../../shared/api/contracts';
import { fetchTtsEngineVoices } from '../../../shared/api/gatewayClient';
import { useManagedTabs } from '../../../shared/ui/tabs';
import { autoAssignSpeakerVoices } from '../../../shared/voices/castAssignment';
import {
  cancelLivePodcastJob,
  createLivePodcastJob,
  fetchLivePodcastAudio,
  fetchLivePodcastChunkAudio,
  getLivePodcastJob,
} from '../api/livePodcastApi';
import {
  cancelStandardPodcastJob,
  createStandardPodcastJob,
  fetchStandardPodcastAudio,
  fetchStandardPodcastChunkAudio,
  getStandardPodcastJob,
} from '../api/standardPodcastApi';
import {
  clampPodcastDurationSec,
  clampPodcastSpeakerCount,
  estimatePodcastChars,
  estimatePodcastVf,
  normalizePodcastCastRow,
  PODCAST_BILLING_RATE,
  PODCAST_DEFAULT_CAST,
  PODCAST_DEFAULT_LIVE_PACING,
  PODCAST_DEFAULT_STANDARD_PACING,
  PODCAST_DEFAULT_TOPIC,
  PODCAST_LIVE_DURATION_OPTIONS,
  PODCAST_STANDARD_DURATION_OPTIONS,
  PODCAST_STANDARD_SCRIPT_WINDOW_CHARS,
  PODCAST_TAB_ITEMS,
  type LivePodcastJobRequest,
  type PodcastArtifacts,
  type PodcastCastMember,
  type PodcastChunk,
  type PodcastMode,
  type PodcastOrchestrationState,
  type StandardPodcastJobRequest,
} from '../model/podcast';
import {
  pollTtsGatewayJobForAudio,
  TTS_GATEWAY_AUDIO_CHUNK_EVENT,
  TTS_GATEWAY_JOB_PROGRESS_EVENT,
} from '../../../../services/ttsGatewayJobService';
import './podcastWireframe.css';

interface PodcastTabContentProps {
  mediaBackendUrl: string;
  resolvedTheme: 'light' | 'dark';
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface GatewayJobProgressEventDetail {
  jobId?: string;
  stage?: string;
  progressPct?: number;
}

interface GatewayAudioChunkEventDetail {
  jobId?: string;
  index?: number;
  engine?: string;
  contentType?: string;
  durationMs?: number;
  textChars?: number;
  traceId?: string;
  speakerId?: string;
  turnIndex?: number;
  sessionEpoch?: number;
  resumeAttempt?: number;
  fallbackUsed?: boolean;
  audioBase64?: string;
}

const GEM_ENGINE = 'GEM' as const;
const APP_BRAND = 'VoiceFlow';
const APP_STUDIO_TITLE = `${APP_BRAND} Studio`;
const DIRECTOR_TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3-flash-lite', 'gemini-2.5-flash-lite'] as const;
const PODCAST_STANDARD_EMOTION_DIRECTIVE = 'Use nuanced real emotions and natural non-linguistic cues (for example: [laughs], [sighs], [pause], [hmm], [chuckles]) sparingly and naturally.';
const PODCAST_LIVE_STRICT_PRODUCER_DIRECTIVE = [
  'Multi-WebSocket producer architecture: one distinct Gemini Native Live speaker instance per cast member.',
  'Shared-context bridge: after each turn, inject that speaker text into the other speakers as fresh context.',
  'Token turn-taking: only the active token speaker can output audio; no cross-talk and no overlap.',
  'Each speaker must stay in role and never speak on behalf of another speaker.',
].join(' ');
const LIVE_NATIVE_STRICT_CAST_PRESET: ReadonlyArray<Pick<PodcastCastMember, 'name' | 'role' | 'voice' | 'persona'>> = [
  {
    name: 'HOST',
    role: 'witty host',
    voice: 'Puck',
    persona: 'Witty host who moves fast, keeps rhythm, and frames audience-first takeaways.',
  },
  {
    name: 'EXPERT',
    role: 'skeptical expert',
    voice: 'Charon',
    persona: 'Skeptical expert who challenges assumptions and demands concrete evidence.',
  },
  {
    name: 'GUEST',
    role: 'energetic guest',
    voice: 'Kore',
    persona: 'Energetic guest who adds vivid examples, curiosity, and momentum.',
  },
  {
    name: 'FACT CHECKER',
    role: 'fact checker',
    voice: 'Fenrir',
    persona: 'Grounded fact checker who keeps claims precise and concise.',
  },
];
const formatElapsedSeconds = (elapsedMs?: number): string => `${Math.max(0, Math.round(Number(elapsedMs || 0) / 1000))}s`;
const formatNumber = (value: unknown): string => Number(value || 0).toLocaleString();
const formatVf = (value: unknown): string => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} VF`;
const getModeLabel = (mode: PodcastMode): string => (mode === 'live' ? 'Podcast Live' : 'Podcast Standard');
const getModeModelLabel = (mode: PodcastMode): string => (mode === 'live' ? 'Gemini Native Live Engine' : 'Podcast Standard Engine');
const getModeHelperText = (mode: PodcastMode): string => (
  mode === 'live'
    ? 'Experimental: strict producer orchestration with token turn-taking.'
    : 'Auto-script from topic with emotion-rich, realistic dialogue.'
);
const buildLiveNativeStrictPacingStyle = (base: string): string => {
  const safeBase = String(base || '').trim() || PODCAST_DEFAULT_LIVE_PACING;
  return `${safeBase} | STRICT PRODUCER INSTRUCTIONS: ${PODCAST_LIVE_STRICT_PRODUCER_DIRECTIVE}`;
};
const normalizeVoiceAliasToken = (raw: unknown): string => (
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
);
const resolvePrimeVoiceToken = (voice: Partial<RuntimeVoiceItem>): string => (
  String(voice.voice || voice.voice_id || voice.name || '').trim()
);
const resolvePrimeVoiceByAlias = (candidate: string, catalog: RuntimeVoiceItem[], fallback = 'Puck'): string => {
  const token = String(candidate || '').trim();
  const fallbackToken = String(fallback || '').trim() || 'Puck';
  if (!token) return fallbackToken;
  const normalizedTarget = normalizeVoiceAliasToken(token);
  for (const voice of catalog) {
    const canonical = resolvePrimeVoiceToken(voice);
    if (!canonical) continue;
    const aliases = [canonical, voice.voice_id, voice.voice, voice.name, voice.mapped_name]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (aliases.some((alias) => normalizeVoiceAliasToken(alias) === normalizedTarget)) {
      return canonical;
    }
  }
  return token;
};
const applyLiveNativeStrictCast = (castRows: PodcastCastMember[]): PodcastCastMember[] => (
  castRows.map((row, index) => {
    const preset = LIVE_NATIVE_STRICT_CAST_PRESET[Math.min(index, LIVE_NATIVE_STRICT_CAST_PRESET.length - 1)] || LIVE_NATIVE_STRICT_CAST_PRESET[0]!;
    return {
      ...row,
      name: String(row.name || preset.name).trim() || preset.name,
      role: String(preset.role || row.role || 'panelist').trim() || 'panelist',
      voice: String(row.voice || preset.voice || 'Puck').trim() || 'Puck',
      persona: String(preset.persona || row.persona || '').trim(),
    };
  })
);
const buildVoiceLabel = (voice: RuntimeVoiceItem): string => {
  const primeName = resolvePrimeVoiceToken(voice);
  const friendlyName = String(voice.name || voice.mapped_name || '').trim();
  const safeName = friendlyName && normalizeVoiceAliasToken(friendlyName) !== normalizeVoiceAliasToken(primeName)
    ? `${primeName} (${friendlyName})`
    : (primeName || friendlyName || 'Puck');
  const meta = [voice.style_tag, voice.accent || voice.language, voice.source]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 2);
  return meta.length ? `${safeName} - ${meta.join(' - ')}` : safeName;
};

const normalizeVoiceGender = (raw: unknown): VoiceOption['gender'] => {
  const token = String(raw || '').trim().toLowerCase();
  if (token.includes('female')) return 'Female';
  if (token.includes('male')) return 'Male';
  return 'Unknown';
};
const runtimeVoiceToVoiceOption = (voice: RuntimeVoiceItem): VoiceOption => {
  const safeId = resolvePrimeVoiceToken(voice) || 'Puck';
  const friendlyName = String(voice.name || voice.mapped_name || '').trim();
  const safeName = friendlyName && normalizeVoiceAliasToken(friendlyName) !== normalizeVoiceAliasToken(safeId)
    ? `${safeId} (${friendlyName})`
    : (safeId || friendlyName || 'Puck');
  const output: VoiceOption = {
    id: safeId,
    name: safeName,
    gender: normalizeVoiceGender(voice.gender),
    accent: String(voice.accent || voice.language || 'Unknown').trim() || 'Unknown',
    geminiVoiceName: safeId,
    country: String(voice.country || 'Unknown').trim() || 'Unknown',
    ageGroup: String(voice.age_group || 'Unknown').trim() || 'Unknown',
    engine: 'GEM',
    accessTier: voice.access_tier || 'free',
    isPlanRestricted: Boolean(voice.is_plan_restricted),
  };
  const safeSource = String(voice.source || '').trim();
  if (safeSource) output.source = safeSource;
  return output;
};
const buildStatusClient = (mode: PodcastMode) => (
  mode === 'live'
    ? {
        getJob: (jobId: string, options?: Parameters<typeof getLivePodcastJob>[1]) => getLivePodcastJob(jobId, options),
        cancelJob: (jobId: string, options?: { baseUrl?: string }) => cancelLivePodcastJob(jobId, options),
        fetchChunkAudio: (jobId: string, chunkIndex: number, baseUrl?: string) => fetchLivePodcastChunkAudio(jobId, chunkIndex, baseUrl),
        fetchResult: (jobId: string, options?: { baseUrl?: string }) => fetchLivePodcastAudio(jobId, options),
      }
    : {
        getJob: (jobId: string, options?: Parameters<typeof getStandardPodcastJob>[1]) => getStandardPodcastJob(jobId, options),
        cancelJob: (jobId: string, options?: { baseUrl?: string }) => cancelStandardPodcastJob(jobId, options),
        fetchChunkAudio: (jobId: string, chunkIndex: number, baseUrl?: string) => fetchStandardPodcastChunkAudio(jobId, chunkIndex, baseUrl),
        fetchResult: (jobId: string, options?: { baseUrl?: string }) => fetchStandardPodcastAudio(jobId, options),
      }
);

export const PodcastTabContent: React.FC<PodcastTabContentProps> = ({ mediaBackendUrl, resolvedTheme, onToast }) => {
  const isDarkUi = resolvedTheme === 'dark';
  const showInternalDiagnostics = String(import.meta.env.VITE_SHOW_PODCAST_INTERNALS || '').trim() === '1';
  const [mode, setMode] = useState<PodcastMode>('live');
  const [topic, setTopic] = useState(PODCAST_DEFAULT_TOPIC);
  const [script, setScript] = useState('');
  const [liveDurationSec, setLiveDurationSec] = useState(180);
  const [standardDurationSec, setStandardDurationSec] = useState(1800);
  const [liveSpeakerCount, setLiveSpeakerCount] = useState<2 | 3 | 4>(4);
  const [standardSpeakerCount, setStandardSpeakerCount] = useState<2 | 3 | 4 | 5 | 6>(4);
  const [livePacingStyle, setLivePacingStyle] = useState(PODCAST_DEFAULT_LIVE_PACING);
  const [standardPacingStyle, setStandardPacingStyle] = useState(PODCAST_DEFAULT_STANDARD_PACING);
  const [cast, setCast] = useState<PodcastCastMember[]>(() => PODCAST_DEFAULT_CAST.map((item) => ({ ...item })));
  const [jobId, setJobId] = useState('');
  const [activeMode, setActiveMode] = useState<PodcastMode>('live');
  const [progressPct, setProgressPct] = useState(0);
  const [stageLabel, setStageLabel] = useState('Ready to launch a VoiceFlow run.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDirectorWorking, setIsDirectorWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [liveChunks, setLiveChunks] = useState<PodcastChunk[]>([]);
  const [orchestration, setOrchestration] = useState<PodcastOrchestrationState | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [artifacts, setArtifacts] = useState<PodcastArtifacts | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<RuntimeVoiceItem[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef('');
  const activeModeRef = useRef<PodcastMode>('live');
  const statusPollRef = useRef<number | null>(null);
  const seenChunkKeysRef = useRef<Set<string>>(new Set());

  const selectedDurationSec = mode === 'live' ? liveDurationSec : standardDurationSec;
  const selectedSpeakerCount = mode === 'live' ? liveSpeakerCount : standardSpeakerCount;
  const selectedPacingStyle = mode === 'live' ? livePacingStyle : standardPacingStyle;
  const visibleCast = useMemo(() => cast.slice(0, clampPodcastSpeakerCount(mode, selectedSpeakerCount)), [cast, mode, selectedSpeakerCount]);
  const estimatedChars = useMemo(() => estimatePodcastChars(mode, selectedDurationSec), [mode, selectedDurationSec]);
  const estimatedVf = useMemo(() => estimatePodcastVf(mode, selectedDurationSec), [mode, selectedDurationSec]);
  const managedTabs = useManagedTabs({ items: PODCAST_TAB_ITEMS.map((item) => ({ id: item.id })), activeId: mode, onChange: setMode, label: 'Podcast modes' });

  const clearStatusPoll = useCallback(() => {
    if (statusPollRef.current) {
      window.clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, []);

  const revokeAudioUrl = useCallback(() => {
    setAudioUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  const resetOutput = useCallback(() => {
    revokeAudioUrl();
    setLiveChunks([]);
    setSummary(null);
    setArtifacts(null);
    setOrchestration(null);
    seenChunkKeysRef.current.clear();
  }, [revokeAudioUrl]);

  const resolveArtifactUrl = useCallback((downloadUrl: string): string => resolveApiUrl(String(downloadUrl || '').trim(), mediaBackendUrl), [mediaBackendUrl]);

  const refreshStatus = useCallback(async (nextJobId: string, nextMode: PodcastMode) => {
    const client = nextMode === 'live' ? getLivePodcastJob : getStandardPodcastJob;
    const payload = await client(nextJobId, { includeChunks: true, includeChunkAudio: false, chunkCursor: 0, chunkLimit: 1, baseUrl: mediaBackendUrl });
    setOrchestration((payload.liveOrchestration || null) as PodcastOrchestrationState | null);
    setSummary((payload.liveSummary || null) as Record<string, unknown> | null);
    setArtifacts((payload.artifacts || null) as PodcastArtifacts | null);
  }, [mediaBackendUrl]);

  const startStatusPolling = useCallback((nextJobId: string, nextMode: PodcastMode) => {
    clearStatusPoll();
    statusPollRef.current = window.setInterval(() => {
      void refreshStatus(nextJobId, nextMode).catch(() => undefined);
    }, 1000);
  }, [clearStatusPoll, refreshStatus]);

  useEffect(() => () => {
    clearStatusPoll();
    abortControllerRef.current?.abort();
    revokeAudioUrl();
  }, [clearStatusPoll, revokeAudioUrl]);

  useEffect(() => {
    let cancelled = false;
    const loadVoices = async () => {
      try {
        const payload = await fetchTtsEngineVoices(GEM_ENGINE, mediaBackendUrl);
        if (cancelled) return;
        const deduped = new Map<string, RuntimeVoiceItem>();
        (payload.voices || []).forEach((voice) => {
          const safeId = resolvePrimeVoiceToken(voice);
          if (!safeId || deduped.has(safeId)) return;
          deduped.set(safeId, {
            ...voice,
            voice_id: safeId,
            voice: safeId,
          });
        });
        const defaults = PODCAST_DEFAULT_CAST.map((member) => member.voice);
        defaults.forEach((voiceId) => {
          const safeId = String(voiceId || '').trim();
          if (!safeId || deduped.has(safeId)) return;
          deduped.set(safeId, { voice_id: safeId, voice: safeId, name: safeId });
        });
        const sortedVoices = Array.from(deduped.values()).sort((left, right) => buildVoiceLabel(left).localeCompare(buildVoiceLabel(right)));
        setVoiceOptions(sortedVoices);
        setCast((current) => current.map((member, index) => ({
          ...normalizePodcastCastRow(member, index),
          voice: resolvePrimeVoiceByAlias(
            String(member.voice || '').trim(),
            sortedVoices,
            String(PODCAST_DEFAULT_CAST[index]?.voice || 'Puck').trim() || 'Puck'
          ),
        })));
      } catch {
        if (cancelled) return;
        setVoiceOptions(PODCAST_DEFAULT_CAST.map((member) => ({ voice_id: member.voice, voice: member.voice, name: member.voice })));
      }
    };
    void loadVoices();
    return () => {
      cancelled = true;
    };
  }, [mediaBackendUrl]);

  useEffect(() => {
    const handleGatewayProgress = (event: Event) => {
      const detail = ((event as CustomEvent<GatewayJobProgressEventDetail>).detail || {}) as GatewayJobProgressEventDetail;
      if (String(detail.jobId || '').trim() !== String(activeJobIdRef.current || '').trim()) return;
      setProgressPct((current) => Math.max(current, Math.max(8, Math.min(98, Math.round(Number(detail.progressPct || 0))))));
      if (String(detail.stage || '').trim()) setStageLabel(String(detail.stage || '').trim());
    };
    window.addEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, handleGatewayProgress as EventListener);
    return () => window.removeEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, handleGatewayProgress as EventListener);
  }, []);

  useEffect(() => {
    const handleGatewayAudioChunk = (event: Event) => {
      const detail = ((event as CustomEvent<GatewayAudioChunkEventDetail>).detail || {}) as GatewayAudioChunkEventDetail;
      const safeJobId = String(activeJobIdRef.current || '').trim();
      const detailJobId = String(detail.jobId || '').trim();
      const audioBase64 = String(detail.audioBase64 || '').trim();
      const index = Number(detail.index);
      if (!safeJobId || detailJobId !== safeJobId || !audioBase64 || !Number.isFinite(index) || index < 0) return;
      const chunkKey = `${detailJobId}:${Math.round(index)}`;
      if (seenChunkKeysRef.current.has(chunkKey)) return;
      seenChunkKeysRef.current.add(chunkKey);
      const nextChunk: PodcastChunk = {
        jobId: detailJobId,
        index: Math.round(index),
        engine: String(detail.engine || GEM_ENGINE),
        contentType: String(detail.contentType || 'audio/wav'),
        durationMs: Number(detail.durationMs || 0),
        textChars: Number(detail.textChars || 0),
        traceId: String(detail.traceId || ''),
        speakerId: String(detail.speakerId || ''),
        turnIndex: Number(detail.turnIndex || Math.round(index)),
        sessionEpoch: Number(detail.sessionEpoch || 0),
        resumeAttempt: Number(detail.resumeAttempt || 0),
        fallbackUsed: Boolean(detail.fallbackUsed),
        audioBase64,
      };
      startTransition(() => {
        setLiveChunks((current) => [...current, nextChunk]);
      });
    };
    window.addEventListener(TTS_GATEWAY_AUDIO_CHUNK_EVENT, handleGatewayAudioChunk as EventListener);
    return () => window.removeEventListener(TTS_GATEWAY_AUDIO_CHUNK_EVENT, handleGatewayAudioChunk as EventListener);
  }, []);

  const updateCastMember = useCallback((index: number, key: keyof PodcastCastMember, value: string) => {
    const safeIndex = Math.max(0, Math.min(PODCAST_DEFAULT_CAST.length - 1, Math.floor(index)));
    setCast((current) => {
      const next = current.map((item) => ({ ...item }));
      const baseRow = normalizePodcastCastRow(
        (next[safeIndex] || PODCAST_DEFAULT_CAST[safeIndex]) as PodcastCastMember,
        safeIndex
      );
      next[safeIndex] = { ...baseRow, [key]: String(value || '') };
      return next;
    });
  }, []);

  const handleCancel = useCallback(async () => {
    const safeJobId = String(activeJobIdRef.current || jobId).trim();
    const safeMode = activeModeRef.current;
    if (!safeJobId) return;
    setStageLabel(`Cancelling ${getModeLabel(safeMode).toLowerCase()}...`);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    try {
      if (safeMode === 'live') await cancelLivePodcastJob(safeJobId, { baseUrl: mediaBackendUrl });
      else await cancelStandardPodcastJob(safeJobId, { baseUrl: mediaBackendUrl });
    } catch {
      // Best effort.
    }
    clearStatusPoll();
    setIsGenerating(false);
    activeJobIdRef.current = '';
    onToast(`${getModeLabel(safeMode)} cancelled.`, 'info');
  }, [clearStatusPoll, jobId, mediaBackendUrl, onToast]);

  const handleStart = useCallback(async () => {
    if (isGenerating || isDirectorWorking) {
      onToast('Please wait for the current action to finish.', 'info');
      return;
    }
    const safeTopic = String(topic || '').trim();
    if (!safeTopic) {
      setErrorMessage('Topic is required for VoiceFlow generation.');
      onToast('Topic is required.', 'error');
      return;
    }

    const safeMode = mode;
    const normalizedSpeakerCount = clampPodcastSpeakerCount(safeMode, selectedSpeakerCount);
    const normalizedCast = cast.slice(0, normalizedSpeakerCount).map((item, index) => normalizePodcastCastRow(item, index));
    const normalizedDurationSec = clampPodcastDurationSec(safeMode, selectedDurationSec);
    clearStatusPoll();
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    activeJobIdRef.current = '';
    activeModeRef.current = safeMode;
    setActiveMode(safeMode);
    setErrorMessage('');
    setJobId('');
    setProgressPct(8);
    setStageLabel(safeMode === 'live' ? 'Submitting VoiceFlow live session...' : 'Submitting VoiceFlow scripted session...');
    setIsGenerating(true);
    resetOutput();

    try {
      let created;
      if (safeMode === 'live') {
        const strictCast = applyLiveNativeStrictCast(normalizedCast);
        const payload: LivePodcastJobRequest = {
          topic: safeTopic,
          durationSec: normalizedDurationSec,
          speakerCount: normalizedSpeakerCount as 2 | 3 | 4,
          cast: strictCast,
          pacingStyle: buildLiveNativeStrictPacingStyle(String(livePacingStyle || '').trim() || PODCAST_DEFAULT_LIVE_PACING),
          limits: { sessionMaxSec: 840, connectionMaxSec: 570, perTurnTimeoutSec: 20 },
          recovery: { strategy: 'resume_then_fallback', maxResumeAttempts: 1, fallbackMode: 'runtime_nonlive_same_cast' },
          output: { autoSave: true, audioFormat: 'wav', includeTranscript: true },
        };
        created = await createLivePodcastJob(payload, { baseUrl: mediaBackendUrl });
      } else {
        const payload: StandardPodcastJobRequest = {
          topic: safeTopic,
          durationSec: normalizedDurationSec,
          speakerCount: normalizedSpeakerCount as 2 | 3 | 4 | 5 | 6,
          cast: normalizedCast,
          pacingStyle: `${String(standardPacingStyle || '').trim() || PODCAST_DEFAULT_STANDARD_PACING} | ${PODCAST_STANDARD_EMOTION_DIRECTIVE}`,
          ...(String(script || '').trim() ? { seedScript: String(script || '').trim() } : {}),
          language: 'en',
          autoSave: true,
          includeTranscript: true,
          audioFormat: 'wav',
          scriptWindowChars: PODCAST_STANDARD_SCRIPT_WINDOW_CHARS,
        };
        created = await createStandardPodcastJob(payload, { baseUrl: mediaBackendUrl });
      }

      const nextJobId = String((created as TtsJobStatusResponse).jobId || (created as TtsJobStatusResponse).requestId || '').trim();
      if (!nextJobId) throw new Error(`${getModeLabel(safeMode)} job id is missing.`);
      activeJobIdRef.current = nextJobId;
      setJobId(nextJobId);
      setProgressPct(14);
      setStageLabel(safeMode === 'live' ? 'VoiceFlow live room is running...' : 'Generating script windows and streaming VoiceFlow chunks...');
      startStatusPolling(nextJobId, safeMode);
      void refreshStatus(nextJobId, safeMode).catch(() => undefined);

      const queuedResult = await pollTtsGatewayJobForAudio({
        jobId: nextJobId,
        runtimeLabel: getModeLabel(safeMode),
        engine: GEM_ENGINE,
        baseUrl: mediaBackendUrl,
        signal: abortControllerRef.current.signal,
        timeoutMs: Math.max(180000, Math.round(normalizedDurationSec * 1000 * 1.8)),
        client: buildStatusClient(safeMode),
      });
      const nextUrl = URL.createObjectURL(new Blob([queuedResult.audioBytes], { type: 'audio/wav' }));
      revokeAudioUrl();
      setAudioUrl(nextUrl);
      setProgressPct(100);
      setStageLabel(`${getModeLabel(safeMode)} complete.`);
      void refreshStatus(nextJobId, safeMode).catch(() => undefined);
      onToast(`${getModeLabel(safeMode)} ready.`, 'success');
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        const message = String(error?.message || `${getModeLabel(safeMode)} generation failed.`).trim() || `${getModeLabel(safeMode)} generation failed.`;
        setErrorMessage(message);
        setStageLabel(message);
        onToast(message, 'error');
      }
    } finally {
      abortControllerRef.current = null;
      clearStatusPoll();
      setIsGenerating(false);
      activeJobIdRef.current = '';
    }
  }, [cast, clearStatusPoll, isDirectorWorking, isGenerating, livePacingStyle, mediaBackendUrl, mode, onToast, refreshStatus, resetOutput, revokeAudioUrl, script, selectedDurationSec, selectedSpeakerCount, standardPacingStyle, startStatusPolling, topic]);

  const voiceSelectOptions = useMemo(() => {
    const deduped = new Map<string, RuntimeVoiceItem>();
    voiceOptions.forEach((voice) => {
      const safeId = resolvePrimeVoiceToken(voice);
      if (!safeId || deduped.has(safeId)) return;
      deduped.set(safeId, voice);
    });
    visibleCast.forEach((member) => {
      const safeId = String(member.voice || '').trim();
      if (!safeId || deduped.has(safeId)) return;
      deduped.set(safeId, { voice_id: safeId, voice: safeId, name: safeId });
    });
    return Array.from(deduped.values()).sort((left, right) => buildVoiceLabel(left).localeCompare(buildVoiceLabel(right)));
  }, [visibleCast, voiceOptions]);

  const assignableVoices = useMemo<VoiceOption[]>(
    () => voiceSelectOptions.map((voice) => runtimeVoiceToVoiceOption(voice)),
    [voiceSelectOptions]
  );

  const directorSettings = useMemo<GenerationSettings>(() => {
    const fallbackVoice = String(visibleCast[0]?.voice || PODCAST_DEFAULT_CAST[0]?.voice || 'Zephyr').trim() || 'Zephyr';
    return {
      voiceId: fallbackVoice,
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'GEM',
      helperProvider: 'GEMINI',
      mediaBackendUrl,
      multiSpeakerEnabled: true,
    };
  }, [mediaBackendUrl, visibleCast]);

  const handleDirectorAutoScript = useCallback(async () => {
    const safeTopic = String(topic || '').trim();
    const safeScript = String(script || '').trim();
    if (!safeTopic && !safeScript) {
      onToast('Add a topic or script first.', 'info');
      return;
    }
    if (isGenerating || isDirectorWorking) return;

    setIsDirectorWorking(true);
    setErrorMessage('');
    try {
      let draftScript = safeScript;
      if (!draftScript) {
        const speakerNames = cast
          .slice(0, clampPodcastSpeakerCount(mode, selectedSpeakerCount))
          .map((item, index) => String(item.name || `SPEAKER ${index + 1}`).trim())
          .filter(Boolean);
        const uniqueSpeakerNames = Array.from(new Set(speakerNames));
        const generationPrompt = [
          `Write a compact multi-speaker VoiceFlow script on "${safeTopic}".`,
          `Use exactly ${uniqueSpeakerNames.length || clampPodcastSpeakerCount(mode, selectedSpeakerCount)} voices.`,
          `Allowed voices: ${uniqueSpeakerNames.join(', ') || 'LEAD, STRATEGIST, ANALYST, CHALLENGER'}.`,
          'Format each dialogue line as: Speaker (Emotion): Dialogue',
          mode === 'standard' ? PODCAST_STANDARD_EMOTION_DIRECTIVE : 'Keep each turn concise and ready for live token hand-off.',
          `Style: ${selectedPacingStyle}`,
        ].join('\n');
        draftScript = String(await generateTextContent(generationPrompt, undefined, directorSettings, {
          model: DIRECTOR_TEXT_MODELS[0],
          preferredModels: [...DIRECTOR_TEXT_MODELS],
          temperature: 0.3,
        })).trim();
      }

      const directed = await autoFormatScript(
        draftScript,
        directorSettings,
        'audio_drama',
        {
          style: 'natural',
          tone: 'neutral',
          model: DIRECTOR_TEXT_MODELS[0],
          preferredModels: [...DIRECTOR_TEXT_MODELS],
        },
        []
      );
      const formattedScript = String(directed.formattedText || draftScript).trim();
      if (!formattedScript) throw new Error('AI Director returned an empty script.');
      setScript(formattedScript);

      const parsed = parseMultiSpeakerScript(formattedScript);
      const parsedSpeakers = parsed.speakersList
        .map((speaker) => String(speaker || '').trim())
        .filter((speaker) => speaker && speaker.toUpperCase() !== 'SFX');
      const maxAllowed = mode === 'live' ? 4 : 6;
      const targetSpeakerCount = Math.max(2, Math.min(maxAllowed, parsedSpeakers.length || selectedSpeakerCount));
      const trimmedSpeakers = parsedSpeakers.slice(0, targetSpeakerCount);

      if (mode === 'live') setLiveSpeakerCount(targetSpeakerCount as 2 | 3 | 4);
      else setStandardSpeakerCount(targetSpeakerCount as 2 | 3 | 4 | 5 | 6);

      const { mapping } = autoAssignSpeakerVoices({
        speakers: trimmedSpeakers.length > 0 ? trimmedSpeakers : visibleCast.map((item) => item.name),
        script: formattedScript,
        voices: assignableVoices,
      });

      setCast((current) => {
        const next = current.map((item) => ({ ...item }));
        for (let index = 0; index < targetSpeakerCount; index += 1) {
          const fallback = normalizePodcastCastRow(
            (next[index] || PODCAST_DEFAULT_CAST[index]) as PodcastCastMember,
            index
          );
          const speakerName = String(trimmedSpeakers[index] || fallback.name).trim() || fallback.name;
          next[index] = {
            ...fallback,
            name: speakerName,
            voice: String(mapping[speakerName] || fallback.voice).trim() || fallback.voice,
          };
        }
        return next;
      });

      setStageLabel('AI Director prepared script and cast.');
      onToast('AI Director updated script.', 'success');
    } catch (error: any) {
      const message = String(error?.message || 'AI Director failed.').trim() || 'AI Director failed.';
      setErrorMessage(message);
      onToast(message, 'error');
    } finally {
      setIsDirectorWorking(false);
    }
  }, [assignableVoices, cast, directorSettings, isDirectorWorking, isGenerating, mode, onToast, script, selectedPacingStyle, selectedSpeakerCount, topic, visibleCast]);

  const hasPlayerOutput = Boolean(audioUrl || isGenerating || liveChunks.length > 0);

  return (
    <div className={`vf-podcast-wireframe animate-in fade-in duration-300 ${isDarkUi ? 'vf-podcast-wireframe--dark' : ''}`} data-testid="podcast-tab-content">
      <SectionCard className="vf-podcast-wireframe__utility">
        <div className="vf-podcast-wireframe__utility-head">
          <h2 className="vf-podcast-wireframe__title">{APP_STUDIO_TITLE}</h2>
          <span className="vf-podcast-wireframe__billing">Billing: 1 char = {PODCAST_BILLING_RATE} VF</span>
        </div>

        <div className="vf-podcast-wireframe__utility-controls">
          <div {...managedTabs.listProps} className="vf-podcast-mode-tabs">
            {PODCAST_TAB_ITEMS.map((item) => {
              const isActive = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  {...managedTabs.getTabProps(item.id)}
                  className={`vf-podcast-mode-tab ${isActive ? 'vf-podcast-mode-tab--active' : ''}`}
                >
                  <span className="vf-podcast-mode-tab__label">{item.label}</span>
                  {'badge' in item && item.badge ? <span className="vf-podcast-mode-tab__badge">{item.badge}</span> : null}
                </button>
              );
            })}
          </div>

          <label className="vf-podcast-compact-field">
            <span>Duration</span>
            <select
              value={String(selectedDurationSec)}
              onChange={(event) => {
                const nextValue = clampPodcastDurationSec(mode, Number(event.target.value || selectedDurationSec));
                if (mode === 'live') setLiveDurationSec(nextValue);
                else setStandardDurationSec(nextValue);
              }}
              className="vf-podcast-compact-select"
            >
              {(mode === 'live' ? PODCAST_LIVE_DURATION_OPTIONS : PODCAST_STANDARD_DURATION_OPTIONS).map((option) => (
                <option key={`${mode}-${option.value}`} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="vf-podcast-compact-field">
            <span>Voices</span>
            <select
              value={String(selectedSpeakerCount)}
              onChange={(event) => {
                const nextValue = clampPodcastSpeakerCount(mode, Number(event.target.value || selectedSpeakerCount));
                if (mode === 'live') setLiveSpeakerCount(nextValue as 2 | 3 | 4);
                else setStandardSpeakerCount(nextValue as 2 | 3 | 4 | 5 | 6);
              }}
              className="vf-podcast-compact-select"
            >
              {(mode === 'live' ? [2, 3, 4] : [2, 3, 4, 5, 6]).map((value) => (
                <option key={`${mode}-speaker-${value}`} value={value}>{value} voices</option>
              ))}
            </select>
          </label>

          <div className="vf-podcast-compact-model">
            <div className="vf-podcast-compact-model__title">{getModeModelLabel(mode)}</div>
            <div className="vf-podcast-compact-model__hint">{getModeHelperText(mode)}</div>
          </div>
        </div>

        <div className="vf-podcast-wireframe__utility-foot">
          <span>{formatNumber(estimatedChars)} chars · {formatVf(estimatedVf)}</span>
          <span>{getModeLabel(mode)}</span>
        </div>

        {showInternalDiagnostics && (
          <div className="vf-podcast-wireframe__diagnostics" data-testid="podcast-internal-diagnostics">
            <span>job: {jobId || 'none'}</span>
            <span>active: {getModeLabel(activeMode)}</span>
            <span>runtime: {formatElapsedSeconds(orchestration?.elapsedMs)}</span>
            <span>chunks: {formatNumber(orchestration?.chunkCount)}</span>
            <span>summary: {summary ? 'ready' : 'pending'}</span>
          </div>
        )}
      </SectionCard>

      <div className="vf-podcast-wireframe__layout">
        <SectionCard className="vf-podcast-wireframe__left-column">
          <section className="vf-podcast-box" data-testid="podcast-topic-box">
            <div className="vf-podcast-box__label">TOPIC</div>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={2}
              className="vf-podcast-field vf-podcast-field--topic"
              placeholder="VoiceFlow topic"
            />
          </section>

          <section className="vf-podcast-box vf-podcast-box--script" data-testid="podcast-script-box">
            <div className="vf-podcast-box__label">SCRIPT</div>
            <textarea
              value={script}
              onChange={(event) => setScript(event.target.value)}
              rows={8}
              className="vf-podcast-field vf-podcast-field--script"
              placeholder="AI Director will draft and format your VoiceFlow script here."
            />
            <button
              type="button"
              onClick={() => { void handleDirectorAutoScript(); }}
              disabled={isGenerating || isDirectorWorking}
              className="vf-podcast-director-button"
              aria-label="Run AI Director for script"
              title="AI Director"
            >
              {isDirectorWorking ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            </button>
          </section>

        </SectionCard>

        <SectionCard className="vf-podcast-wireframe__cast-column">
          <section className="vf-podcast-box vf-podcast-box--player" data-testid="podcast-player-box">
            <div className="vf-podcast-box__header">
              <div className="vf-podcast-box__label">PLAYER</div>
              <div className="vf-podcast-progress-pill">{progressPct}%</div>
            </div>

            <div className="vf-podcast-stage">{stageLabel}</div>
            <div className="vf-podcast-progress-track" aria-hidden="true">
              <div className="vf-podcast-progress-fill" style={{ width: `${Math.max(4, Math.min(100, progressPct))}%` }} />
            </div>

            {errorMessage && (
              <div className="vf-podcast-error">
                <AlertTriangle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="vf-podcast-player-frame" data-testid="podcast-player-frame">
              {hasPlayerOutput ? (
                <AudioPlayer
                  audioUrl={audioUrl}
                  isGenerating={isGenerating}
                  isLiveStreaming={isGenerating}
                  liveChunks={liveChunks}
                  onReset={resetOutput}
                />
              ) : (
                <div className="vf-podcast-player-placeholder">Player output appears here after generation.</div>
              )}
            </div>

            <div className="vf-podcast-player-actions">
              <Button
                onClick={() => { void handleStart(); }}
                isLoading={isGenerating}
                icon={mode === 'live' ? <Activity size={15} /> : <Mic2 size={15} />}
                className="vf-podcast-action-button vf-podcast-action-button--start"
                disabled={isDirectorWorking}
              >
                {isGenerating ? 'Running...' : `Start ${getModeLabel(mode)}`}
              </Button>
              <Button
                onClick={() => { void handleCancel(); }}
                variant="danger"
                icon={<Square size={14} />}
                disabled={!isGenerating}
                className="vf-podcast-action-button vf-podcast-action-button--cancel"
              >
                Cancel
              </Button>
            </div>

            <div className="vf-podcast-player-footer">
              <span className="vf-podcast-player-footer__metric">{formatNumber(estimatedChars)} chars · {formatVf(estimatedVf)}</span>
              {artifacts?.audio?.downloadUrl ? (
                <a
                  className="vf-podcast-download-link"
                  href={resolveArtifactUrl(String(artifacts.audio.downloadUrl || ''))}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={14} />
                  Download
                </a>
              ) : null}
            </div>
          </section>

          <section className="vf-podcast-box vf-podcast-box--cast" data-testid="podcast-cast-box">
            <div className="vf-podcast-box__header">
              <div className="vf-podcast-box__label">CAST</div>
              <div className="vf-podcast-cast-count">{visibleCast.length} voices</div>
            </div>

            <div className="vf-podcast-cast-header" data-testid="podcast-cast-header">
              <div>CHARACTER</div>
              <div>NAME</div>
              <div>VOICES</div>
            </div>

            <div className="vf-podcast-cast-rows" data-testid="podcast-cast-rows">
              {visibleCast.map((member, index) => (
                <div key={`${member.id || 'cast'}-${index}`} className="vf-podcast-cast-row" data-testid={`podcast-cast-row-${index}`}>
                  <input
                    value={member.role}
                    onChange={(event) => updateCastMember(index, 'role', event.target.value)}
                    className="vf-podcast-cast-input vf-podcast-cast-input--character"
                    placeholder="Character"
                  />
                  <input
                    value={member.name}
                    onChange={(event) => updateCastMember(index, 'name', event.target.value)}
                    className="vf-podcast-cast-input vf-podcast-cast-input--name"
                    placeholder="Name"
                  />
                  <select
                    value={member.voice}
                    onChange={(event) => updateCastMember(index, 'voice', event.target.value)}
                    className="vf-podcast-cast-input vf-podcast-cast-input--speaker"
                  >
                    {voiceSelectOptions.map((voice) => {
                      const safeId = resolvePrimeVoiceToken(voice);
                      return <option key={`${member.id || 'voice'}-${safeId}`} value={safeId}>{buildVoiceLabel(voice)}</option>;
                    })}
                  </select>
                </div>
              ))}
            </div>
          </section>
        </SectionCard>
      </div>
    </div>
  );
};
