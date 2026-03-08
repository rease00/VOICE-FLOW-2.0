import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  CheckCircle2,
  Clapperboard,
  Download,
  Globe2,
  Loader2,
  Mic2,
  PencilLine,
  Sparkles,
  UploadCloud,
  Users,
  Wand2,
} from 'lucide-react';
import { Button } from '../../../../components/Button';
import { SectionCard } from '../../../../components/SectionCard';
import { LANGUAGES, VOICES } from '../../../../constants';
import {
  createDubbingJobV2,
  downloadDubbingReport,
  downloadDubbingResult,
  getDubbingJob,
  transcribeVideoWithBackend,
  type VideoTranscriptionResult,
} from '../../../../services/mediaBackendService';
import type { LanguageOption, VoiceOption } from '../../../../types';
import {
  resolveDubbingProcessingProfile,
  resolveDubbingSourceLanguageMode,
} from '../model/pipelineDefaults';

type ToastTone = 'success' | 'error' | 'info';

interface SimplifiedDubbingTabProps {
  isDarkUi: boolean;
  mediaBackendUrl: string;
  voiceOptions: VoiceOption[];
  initialTargetLanguage?: string;
  onToast: (message: string, tone?: ToastTone) => void;
}

interface TranscriptSegmentDraft {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
  emotion: string;
  affectiveTags: string[];
}

interface SpeakerSummary {
  id: string;
  label: string;
  segmentCount: number;
}

interface JobViewState {
  jobId: string;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  error: string;
}

const SUPPORTED_TARGET_LANGUAGE_CODES = new Set(['en', 'hi', 'bn', 'es', 'fr', 'de', 'pt', 'ar', 'ko', 'ja', 'zh', 'ru']);
const POLL_INTERVAL_MS = 2200;

const LANGUAGE_TOKEN_MAP: Record<string, string> = {
  english: 'en',
  en: 'en',
  hindi: 'hi',
  hinglish: 'hi',
  hi: 'hi',
  bangla: 'bn',
  bengali: 'bn',
  bn: 'bn',
  spanish: 'es',
  es: 'es',
  french: 'fr',
  fr: 'fr',
  german: 'de',
  de: 'de',
  portuguese: 'pt',
  pt: 'pt',
  arabic: 'ar',
  ar: 'ar',
  korean: 'ko',
  ko: 'ko',
  japanese: 'ja',
  ja: 'ja',
  chinese: 'zh',
  mandarin: 'zh',
  zh: 'zh',
  russian: 'ru',
  ru: 'ru',
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const formatMsLabel = (milliseconds: number): string => {
  const safe = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatOverrideTimestamp = (milliseconds: number): string => {
  const safe = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

const normalizeTargetLanguageCode = (value?: string): string => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return 'hi';
  const direct = LANGUAGE_TOKEN_MAP[token];
  if (direct && SUPPORTED_TARGET_LANGUAGE_CODES.has(direct)) return direct;

  const matched = LANGUAGES.find((language) => {
    const code = String(language.code || '').trim().toLowerCase();
    const name = String(language.name || '').trim().toLowerCase();
    const nativeName = String(language.nativeName || '').trim().toLowerCase();
    return token === code || token === name || token === nativeName;
  });
  const normalized = String(matched?.code || token).split('-', 1)[0] || '';
  return SUPPORTED_TARGET_LANGUAGE_CODES.has(normalized) ? normalized : 'hi';
};

const humanizeLanguage = (value?: string): string => {
  const normalized = normalizeTargetLanguageCode(value);
  const match = LANGUAGES.find((language) => (String(language.code || '').split('-', 1)[0] || '').toLowerCase() === normalized);
  return match?.name || normalized.toUpperCase();
};

const humanizeStage = (stage?: string): string => {
  const token = String(stage || '').trim();
  if (!token) return 'Preparing pipeline';
  return token
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const buildTranscriptOverride = (segments: TranscriptSegmentDraft[]): string => {
  return segments
    .map((segment) => {
      const prefix = `[${formatOverrideTimestamp(segment.startMs)} - ${formatOverrideTimestamp(segment.endMs)}]`;
      return `${prefix} ${segment.speaker}: ${segment.text.trim()}`;
    })
    .join('\n');
};

const deriveSpeakerSummaries = (
  analysis: VideoTranscriptionResult | null,
  segments: TranscriptSegmentDraft[],
): SpeakerSummary[] => {
  const existing = Array.isArray((analysis as VideoTranscriptionResult & { speakers?: SpeakerSummary[] })?.speakers)
    ? ((analysis as VideoTranscriptionResult & { speakers?: SpeakerSummary[] }).speakers as SpeakerSummary[])
    : [];
  if (existing.length > 0) {
    return existing.map((speaker, index) => ({
      id: speaker.id || `speaker_${index + 1}`,
      label: speaker.label || `Speaker ${index + 1}`,
      segmentCount: Number(speaker.segmentCount || 0),
    }));
  }

  const counts = new Map<string, number>();
  segments.forEach((segment) => {
    const label = String(segment.speaker || '').trim() || 'Speaker 1';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([label, segmentCount], index) => ({
    id: `speaker_${index + 1}`,
    label,
    segmentCount,
  }));
};

const resolveDraftSegments = (analysis: VideoTranscriptionResult): TranscriptSegmentDraft[] => {
  const directorByIndex = new Map<number, { affective_tags?: string[]; speaker?: string }>();
  (analysis.director?.segments || []).forEach((segment) => {
    directorByIndex.set(Number(segment.index || 0), {
      affective_tags: Array.isArray(segment.affective_tags) ? segment.affective_tags : [],
      speaker: String(segment.speaker || '').trim(),
    });
  });

  return (analysis.segments || []).map((segment, index) => {
    const directorSegment = directorByIndex.get(index);
    const startMs = Math.max(0, Math.round(Number(segment.start || 0) * 1000));
    const endMs = Math.max(startMs + 240, Math.round(Number(segment.end || segment.start || 0) * 1000));
    const tags = Array.isArray(directorSegment?.affective_tags) && directorSegment?.affective_tags.length > 0
      ? directorSegment.affective_tags.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [String(segment.emotion || 'neutral').trim().toLowerCase() || 'neutral'];
    return {
      id: String(segment.id ?? index),
      index,
      startMs,
      endMs,
      speaker: String(segment.speaker || directorSegment?.speaker || 'Speaker 1').trim() || 'Speaker 1',
      text: String(segment.text || ''),
      emotion: String(segment.emotion || tags[0] || 'neutral').trim().toLowerCase() || 'neutral',
      affectiveTags: tags.slice(0, 3),
    };
  });
};

const defaultVoiceMap = (speakers: SpeakerSummary[], options: VoiceOption[]): Record<string, string> => {
  const next: Record<string, string> = {};
  speakers.forEach((speaker, index) => {
    const fallbackVoice = options[index % Math.max(1, options.length)];
    next[speaker.label] = fallbackVoice?.id || '';
  });
  return next;
};

export const SimplifiedDubbingTab: React.FC<SimplifiedDubbingTabProps> = ({
  isDarkUi,
  mediaBackendUrl,
  voiceOptions,
  initialTargetLanguage,
  onToast,
}) => {
  const availableVoices = useMemo(() => (voiceOptions.length > 0 ? voiceOptions : VOICES), [voiceOptions]);
  const supportedTargetLanguages = useMemo<LanguageOption[]>(
    () => LANGUAGES.filter((language) => SUPPORTED_TARGET_LANGUAGE_CODES.has((String(language.code || '').split('-', 1)[0] || '').toLowerCase())),
    [],
  );
  const [targetLanguage, setTargetLanguage] = useState(() => normalizeTargetLanguageCode(initialTargetLanguage));
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [analysis, setAnalysis] = useState<VideoTranscriptionResult | null>(null);
  const [segments, setSegments] = useState<TranscriptSegmentDraft[]>([]);
  const deferredSegments = useDeferredValue(segments);
  const [speakerVoiceMap, setSpeakerVoiceMap] = useState<Record<string, string>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobState, setJobState] = useState<JobViewState>({
    jobId: '',
    status: 'idle',
    progress: 0,
    stage: '',
    error: '',
  });
  const [resultUrl, setResultUrl] = useState('');
  const [reportUrl, setReportUrl] = useState('');
  const [resultKind, setResultKind] = useState<'audio' | 'video'>('video');
  const isMountedRef = useRef(true);

  useEffect(() => {
    setTargetLanguage(normalizeTargetLanguageCode(initialTargetLanguage));
  }, [initialTargetLanguage]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(sourceFile);
    setSourceUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [sourceFile]);

  useEffect(() => {
    if (!resultUrl) return;
    return () => {
      URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  useEffect(() => {
    if (!reportUrl) return;
    return () => {
      URL.revokeObjectURL(reportUrl);
    };
  }, [reportUrl]);

  const speakerSummaries = useMemo(() => deriveSpeakerSummaries(analysis, segments), [analysis, segments]);
  const totalTranscriptChars = useMemo(
    () => deferredSegments.reduce((sum, segment) => sum + String(segment.text || '').trim().length, 0),
    [deferredSegments],
  );
  const processingProfile = useMemo(
    () => resolveDubbingProcessingProfile({
      durationSec: Number(analysis?.durationSec || 0),
      segmentCount: deferredSegments.length,
      totalChars: totalTranscriptChars,
      speakerCount: speakerSummaries.length,
    }),
    [analysis?.durationSec, deferredSegments.length, speakerSummaries.length, totalTranscriptChars],
  );
  const sourceLanguageMode = useMemo(
    () => resolveDubbingSourceLanguageMode({
      detectedLanguage: analysis?.language,
      texts: deferredSegments.map((segment) => segment.text),
    }),
    [analysis?.language, deferredSegments],
  );

  const resetArtifacts = useCallback(() => {
    setResultUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setReportUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return '';
    });
    setResultKind('video');
  }, []);

  const applyAnalysis = useCallback((payload: VideoTranscriptionResult) => {
    const nextSegments = resolveDraftSegments(payload);
    const nextSpeakers = deriveSpeakerSummaries(payload, nextSegments);
    startTransition(() => {
      setAnalysis(payload);
      setSegments(nextSegments);
      setSpeakerVoiceMap((current) => {
        const defaults = defaultVoiceMap(nextSpeakers, availableVoices);
        const next = { ...defaults, ...current };
        nextSpeakers.forEach((speaker, index) => {
          const currentVoiceId = String(next[speaker.label] || '').trim();
          const isValid = availableVoices.some((voice) => voice.id === currentVoiceId);
          if (!isValid) {
            next[speaker.label] = defaults[speaker.label] || availableVoices[index % Math.max(1, availableVoices.length)]?.id || '';
          }
        });
        Object.keys(next).forEach((speakerLabel) => {
          if (!nextSpeakers.some((speaker) => speaker.label === speakerLabel)) delete next[speakerLabel];
        });
        return next;
      });
    });
  }, [availableVoices]);

  const handleSourceChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    resetArtifacts();
    setSourceFile(file);
    setAnalysis(null);
    setSegments([]);
    setSpeakerVoiceMap({});
    setJobState({
      jobId: '',
      status: 'idle',
      progress: 0,
      stage: '',
      error: '',
    });
  }, [resetArtifacts]);

  const handleAnalyze = useCallback(async () => {
    if (!sourceFile) {
      onToast('Upload a source video first.', 'info');
      return;
    }
    setIsAnalyzing(true);
    setJobState((current) => ({
      ...current,
      stage: 'Analyzing source video',
      error: '',
    }));
    try {
      const result = await transcribeVideoWithBackend(mediaBackendUrl, sourceFile, {
        language: 'auto',
        task: 'transcribe',
        captureEmotions: true,
      });
      applyAnalysis(result);
      setJobState({
        jobId: '',
        status: 'idle',
        progress: 0,
        stage: 'Analysis ready',
        error: '',
      });
      onToast('Video analysis is ready.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video analysis failed.';
      setJobState({
        jobId: '',
        status: 'failed',
        progress: 0,
        stage: 'Analysis failed',
        error: message,
      });
      onToast(message, 'error');
    } finally {
      if (isMountedRef.current) setIsAnalyzing(false);
    }
  }, [applyAnalysis, mediaBackendUrl, onToast, sourceFile]);

  const handleSegmentTextChange = useCallback((segmentId: string, text: string) => {
    setSegments((current) => current.map((segment) => (
      segment.id === segmentId ? { ...segment, text } : segment
    )));
  }, []);

  const handleSpeakerVoiceChange = useCallback((speakerLabel: string, voiceId: string) => {
    setSpeakerVoiceMap((current) => ({
      ...current,
      [speakerLabel]: voiceId,
    }));
  }, []);

  const pollJobUntilComplete = useCallback(async (jobId: string) => {
    while (isMountedRef.current) {
      const statusPayload = await getDubbingJob(mediaBackendUrl, jobId);
      const job = statusPayload.job;
      const status = String(job.status || 'running').trim().toLowerCase() as JobViewState['status'];
      setJobState({
        jobId,
        status,
        progress: Number(job.progress || 0),
        stage: humanizeStage(String(job.stage || 'running')),
        error: String(job.error || ''),
      });

      if (status === 'completed') {
        const [resultBlob, reportBlob] = await Promise.all([
          downloadDubbingResult(mediaBackendUrl, jobId),
          downloadDubbingReport(mediaBackendUrl, jobId).catch(() => null),
        ]);
        if (!isMountedRef.current) return;
        resetArtifacts();
        setResultUrl(URL.createObjectURL(resultBlob));
        setReportUrl(reportBlob ? URL.createObjectURL(reportBlob) : '');
        setResultKind(resultBlob.type.startsWith('audio/') ? 'audio' : 'video');
        return;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(String(job.error || 'Dubbing job failed.'));
      }
      await wait(POLL_INTERVAL_MS);
    }
  }, [mediaBackendUrl, resetArtifacts]);

  const handleGenerate = useCallback(async () => {
    if (!sourceFile) {
      onToast('Upload a source video first.', 'info');
      return;
    }
    if (segments.length === 0) {
      onToast('Analyze the video before generating the dub.', 'info');
      return;
    }
    if (availableVoices.length === 0) {
      onToast('No voices are available right now.', 'error');
      return;
    }

    const cleanSegments = segments
      .map((segment) => ({ ...segment, text: String(segment.text || '').trim() }))
      .filter((segment) => segment.text.length > 0);
    if (cleanSegments.length === 0) {
      onToast('Transcript is empty after edits.', 'info');
      return;
    }

    const voiceMap = Object.fromEntries(
      speakerSummaries
        .map((speaker, index) => {
          const preferred = String(speakerVoiceMap[speaker.label] || '').trim();
          const fallback = availableVoices[index % Math.max(1, availableVoices.length)]?.id || '';
          return [speaker.label, preferred || fallback];
        })
        .filter((entry) => String(entry[1] || '').trim().length > 0),
    );

    setIsGenerating(true);
    resetArtifacts();
    setJobState({
      jobId: '',
      status: 'queued',
      progress: 4,
      stage: 'Submitting dubbing job',
      error: '',
    });

    try {
      const created = await createDubbingJobV2(mediaBackendUrl, sourceFile, {
        targetLanguage,
        mode: 'strict_full',
        output: 'audio+video',
        advanced: {
          tts_route: 'auto',
          processing_profile: processingProfile,
          multispeaker_policy: 'hybrid_auto',
          source_language_mode: sourceLanguageMode,
          language_coverage_profile: 'core12',
          live_play_mode: 'off',
          max_speaker_count: Math.max(1, speakerSummaries.length),
          transcript_override: buildTranscriptOverride(cleanSegments),
          voice_map: voiceMap,
        },
      });
      setJobState({
        jobId: created.job_id,
        status: 'queued',
        progress: 8,
        stage: 'Job queued',
        error: '',
      });
      await pollJobUntilComplete(created.job_id);
      if (!isMountedRef.current) return;
      setJobState((current) => ({
        ...current,
        status: 'completed',
        progress: 100,
        stage: 'Dub ready',
        error: '',
      }));
      onToast('Dub generated successfully.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dubbing failed.';
      if (!isMountedRef.current) return;
      setJobState((current) => ({
        ...current,
        status: 'failed',
        error: message,
      }));
      onToast(message, 'error');
    } finally {
      if (isMountedRef.current) setIsGenerating(false);
    }
  }, [
    availableVoices,
    mediaBackendUrl,
    onToast,
    pollJobUntilComplete,
    resetArtifacts,
    segments,
    sourceFile,
    sourceLanguageMode,
    speakerSummaries,
    speakerVoiceMap,
    targetLanguage,
    processingProfile,
  ]);

  const statusTone = useMemo(() => {
    if (jobState.status === 'failed') {
      return isDarkUi
        ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
        : 'border-rose-200 bg-rose-50 text-rose-800';
    }
    if (jobState.status === 'completed') {
      return isDarkUi
        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';
    }
    return isDarkUi
      ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
      : 'border-cyan-200 bg-cyan-50 text-cyan-800';
  }, [isDarkUi, jobState.status]);

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          className={`overflow-hidden border p-0 ${
            isDarkUi
              ? 'border-slate-700 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_42%),linear-gradient(135deg,_rgba(2,6,23,0.96),_rgba(15,23,42,0.92))]'
              : 'border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(238,242,255,0.95))]'
          }`}
        >
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-6 sm:p-7">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] opacity-75">
                <Clapperboard size={14} />
                <span>Dubbing Studio</span>
              </div>
              <h2 className={`mt-3 text-3xl font-black tracking-tight ${isDarkUi ? 'text-white' : 'text-slate-900'}`}>
                Single-video dubbing, stripped down to the essentials.
              </h2>
              <p className={`mt-3 max-w-xl text-sm leading-6 ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>
                Upload one source video, let the backend detect language and speakers, edit the transcript, choose voices, then generate the final dub.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <label
                  className={`group relative inline-flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                    isDarkUi
                      ? 'border-white/15 bg-white/5 text-white hover:border-cyan-300/40 hover:bg-cyan-400/10'
                      : 'border-slate-200 bg-white/90 text-slate-800 hover:border-cyan-300 hover:bg-cyan-50'
                  }`}
                >
                  <UploadCloud size={16} />
                  <span>{sourceFile ? 'Replace video' : 'Upload video'}</span>
                  <input className="absolute inset-0 cursor-pointer opacity-0" type="file" accept="video/*" onChange={handleSourceChange} />
                </label>
                <Button
                  onClick={handleAnalyze}
                  isLoading={isAnalyzing}
                  disabled={!sourceFile || isGenerating}
                  icon={<Sparkles size={15} />}
                  className={isDarkUi ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400' : ''}
                >
                  Analyze video
                </Button>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className={`rounded-2xl border p-3 ${isDarkUi ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/90'}`}>
                  <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">Source</div>
                  <div className="mt-2 text-sm font-semibold">{humanizeLanguage(analysis?.language || 'auto')}</div>
                </div>
                <div className={`rounded-2xl border p-3 ${isDarkUi ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/90'}`}>
                  <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">Duration</div>
                  <div className="mt-2 text-sm font-semibold">{formatSeconds(Number(analysis?.durationSec || 0))}</div>
                </div>
                <div className={`rounded-2xl border p-3 ${isDarkUi ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/90'}`}>
                  <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">Speakers</div>
                  <div className="mt-2 text-sm font-semibold">{speakerSummaries.length || Number((analysis as VideoTranscriptionResult & { speakerCount?: number })?.speakerCount || 0)}</div>
                </div>
                <div className={`rounded-2xl border p-3 ${isDarkUi ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/90'}`}>
                  <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">Director</div>
                  <div className="mt-2 text-sm font-semibold capitalize">{String(analysis?.director?.sceneComplexity || 'idle')}</div>
                </div>
              </div>
            </div>

            <div className={`border-t p-4 lg:border-l lg:border-t-0 ${isDarkUi ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-slate-50/70'}`}>
              <div className={`overflow-hidden rounded-[24px] border ${isDarkUi ? 'border-white/10 bg-slate-950' : 'border-slate-200 bg-white'}`}>
                {sourceUrl ? (
                  <video src={sourceUrl} controls className="h-full max-h-[360px] w-full bg-black object-contain" />
                ) : (
                  <div className={`flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                    <UploadCloud size={36} />
                    <div>
                      <div className={`text-sm font-bold ${isDarkUi ? 'text-slate-100' : 'text-slate-800'}`}>Source preview</div>
                      <div className="mt-1 text-xs">The uploaded video appears here before analysis and generation.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard className={`border p-5 ${isDarkUi ? 'border-slate-700 bg-slate-950/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] opacity-70">Generate</div>
                <h3 className="mt-2 text-lg font-black">Target language and output</h3>
                <p className={`mt-2 text-sm ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>
                  The backend handles source language detection and transcription. You only set the target language and speaker voices here.
                </p>
              </div>
              <Globe2 className={isDarkUi ? 'text-cyan-300' : 'text-cyan-600'} size={22} />
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide opacity-70">Target language</span>
                <select
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none ${
                    isDarkUi
                      ? 'border-slate-700 bg-slate-900 text-slate-100'
                      : 'border-slate-200 bg-slate-50 text-slate-800'
                  }`}
                >
                  {supportedTargetLanguages.map((language) => (
                    <option key={language.code} value={(String(language.code).split('-', 1)[0] || '').toLowerCase()}>
                      {language.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${isDarkUi ? 'border-slate-700 bg-slate-900/60 text-slate-300' : 'border-slate-200 bg-slate-50/70 text-slate-600'}`}>
                Route: Auto voice engine. Profile: {processingProfile.replace('cpu_', 'CPU ')}. Source mode: {sourceLanguageMode === 'detected_global' ? 'Global detect' : 'Per-segment detect'}.
              </div>

              <div className={`rounded-2xl border p-4 ${statusTone}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {jobState.status === 'completed'
                    ? <CheckCircle2 size={16} />
                    : jobState.status === 'failed'
                      ? <Activity size={16} />
                      : <Loader2 size={16} className={(isAnalyzing || isGenerating) ? 'animate-spin' : ''} />}
                  <span>{jobState.stage || (isAnalyzing ? 'Analyzing source video' : 'Ready')}</span>
                </div>
                <div className={`mt-3 h-2 overflow-hidden rounded-full ${isDarkUi ? 'bg-white/10' : 'bg-slate-200'}`}>
                  <div
                    className={`h-full rounded-full ${jobState.status === 'failed' ? 'bg-rose-500' : jobState.status === 'completed' ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                    style={{ width: `${Math.max(6, Math.min(100, jobState.progress || (isAnalyzing ? 18 : 6)))}%` }}
                  />
                </div>
                {jobState.error ? <p className="mt-3 text-xs font-semibold">{jobState.error}</p> : null}
              </div>

              <Button
                fullWidth
                onClick={handleGenerate}
                isLoading={isGenerating}
                disabled={!sourceFile || segments.length === 0 || isAnalyzing}
                icon={<Wand2 size={16} />}
                className={isDarkUi ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300' : ''}
              >
                Generate dub
              </Button>
            </div>
          </SectionCard>
          {(resultUrl || reportUrl) && (
            <SectionCard className={`border p-5 ${isDarkUi ? 'border-slate-700 bg-slate-950/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] opacity-70">Output</div>
                  <h3 className="mt-2 text-lg font-black">Preview and downloads</h3>
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-black/10 bg-black/80">
                {resultKind === 'audio'
                  ? <audio controls src={resultUrl} className="w-full" />
                  : <video controls src={resultUrl} className="max-h-[320px] w-full bg-black object-contain" />}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {resultUrl ? (
                  <a
                    href={resultUrl}
                    download={resultKind === 'audio' ? 'dubbed-output.wav' : 'dubbed-output.mp4'}
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${
                      isDarkUi
                        ? 'border-slate-600 bg-slate-900 text-slate-100 hover:border-cyan-300'
                        : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-cyan-300'
                    }`}
                  >
                    <Download size={15} />
                    Download output
                  </a>
                ) : null}
                {reportUrl ? (
                  <a
                    href={reportUrl}
                    download="dubbing-report.json"
                    className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${
                      isDarkUi
                        ? 'border-slate-600 bg-slate-900 text-slate-100 hover:border-cyan-300'
                        : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-cyan-300'
                    }`}
                  >
                    <Download size={15} />
                    Download report
                  </a>
                ) : null}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-6">
          <SectionCard className={`border p-5 ${isDarkUi ? 'border-slate-700 bg-slate-950/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] opacity-70">Cast</div>
                <h3 className="mt-2 text-lg font-black">Detected speakers and voices</h3>
              </div>
              <Users size={18} className={isDarkUi ? 'text-cyan-300' : 'text-cyan-600'} />
            </div>

            <div className="mt-4 space-y-3">
              {speakerSummaries.length === 0 ? (
                <div className={`rounded-2xl border border-dashed p-5 text-sm ${isDarkUi ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                  Analyze the video to populate speakers and assign their voices.
                </div>
              ) : speakerSummaries.map((speaker, index) => {
                const selectedVoiceId = String(speakerVoiceMap[speaker.label] || availableVoices[index % Math.max(1, availableVoices.length)]?.id || '').trim();
                const selectedVoice = availableVoices.find((voice) => voice.id === selectedVoiceId) || availableVoices[0];
                return (
                  <div
                    key={speaker.id}
                    className={`rounded-2xl border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">{speaker.label}</div>
                        <div className={`mt-1 text-xs ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                          {speaker.segmentCount} segment{speaker.segmentCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <Mic2 size={16} className={isDarkUi ? 'text-slate-400' : 'text-slate-500'} />
                    </div>
                    <select
                      value={selectedVoiceId}
                      onChange={(event) => handleSpeakerVoiceChange(speaker.label, event.target.value)}
                      className={`mt-3 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none ${
                        isDarkUi
                          ? 'border-slate-700 bg-slate-950 text-slate-100'
                          : 'border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      {availableVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                    {selectedVoice?.previewUrl ? (
                      <audio controls src={selectedVoice.previewUrl} className="mt-3 w-full" />
                    ) : (
                      <div className="mt-3 text-xs text-slate-500">
                        {selectedVoice ? `${selectedVoice.name} will be used for ${speaker.label}.` : 'No preview available for this voice.'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard className={`border p-5 ${isDarkUi ? 'border-slate-700 bg-slate-950/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.24em] opacity-70">AI Director</div>
                <h3 className="mt-2 text-lg font-black">Emotion and scene guidance</h3>
              </div>
              <Sparkles size={18} className={isDarkUi ? 'text-cyan-300' : 'text-cyan-600'} />
            </div>

            <div className="mt-4 space-y-3">
              <div className={`rounded-2xl border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}>
                <div className="text-xs font-bold uppercase tracking-wide opacity-70">Scene complexity</div>
                <div className="mt-2 text-sm font-semibold capitalize">{String(analysis?.director?.sceneComplexity || 'idle')}</div>
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                {(analysis?.director?.segments || []).length === 0 ? (
                  <div className={`rounded-2xl border border-dashed p-5 text-sm ${isDarkUi ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                    Director cues appear here after analysis.
                  </div>
                ) : (analysis?.director?.segments || []).map((segment) => (
                  <div
                    key={`${segment.index}-${segment.start_ms}`}
                    className={`rounded-2xl border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-bold">{segment.speaker}</div>
                      <div className={`text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                        {formatMsLabel(Number(segment.start_ms || 0))} - {formatMsLabel(Number(segment.end_ms || 0))}
                      </div>
                    </div>
                    <p className={`mt-2 text-sm leading-6 ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>{segment.text}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(segment.affective_tags || ['neutral']).map((tag) => (
                        <span
                          key={`${segment.index}-${tag}`}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                            isDarkUi ? 'bg-cyan-500/15 text-cyan-100' : 'bg-cyan-100 text-cyan-800'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard className={`border p-5 ${isDarkUi ? 'border-slate-700 bg-slate-950/70 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] opacity-70">Transcript</div>
              <h3 className="mt-2 text-lg font-black">Edit before generation</h3>
            </div>
            <PencilLine size={18} className={isDarkUi ? 'text-cyan-300' : 'text-cyan-600'} />
          </div>

          <div className={`mt-4 flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${isDarkUi ? 'border-slate-700 bg-slate-900/60 text-slate-300' : 'border-slate-200 bg-slate-50/70 text-slate-600'}`}>
            <span>{deferredSegments.length} segment{deferredSegments.length === 1 ? '' : 's'}</span>
            <span>{totalTranscriptChars} editable characters</span>
          </div>

          <div className="mt-4 max-h-[980px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            {deferredSegments.length === 0 ? (
              <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDarkUi ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                Analyze the video to load transcript segments. Each line stays editable before you generate the dub.
              </div>
            ) : deferredSegments.map((segment) => (
              <div
                key={segment.id}
                className={`rounded-[22px] border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-slate-50/70'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${isDarkUi ? 'bg-white/10 text-slate-100' : 'bg-white text-slate-700'}`}>
                    {segment.speaker}
                  </span>
                  <span className={`text-xs font-semibold ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                    {formatMsLabel(segment.startMs)} - {formatMsLabel(segment.endMs)}
                  </span>
                  {(segment.affectiveTags || []).map((tag) => (
                    <span
                      key={`${segment.id}-${tag}`}
                      className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        isDarkUi ? 'bg-cyan-500/15 text-cyan-100' : 'bg-cyan-100 text-cyan-800'
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <textarea
                  value={segment.text}
                  onChange={(event) => handleSegmentTextChange(segment.id, event.target.value)}
                  className={`mt-3 min-h-[108px] w-full resize-y rounded-2xl border px-4 py-3 text-sm leading-6 outline-none ${
                    isDarkUi
                      ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500'
                      : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400'
                  }`}
                  placeholder="Edit transcript text for this segment..."
                />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
