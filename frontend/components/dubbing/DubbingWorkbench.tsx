import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Loader2, Send, X } from 'lucide-react';
import { Button } from '../Button';
import { DubbingJobStatus, LanguageOption, VoiceOption } from '../../types';
import { UploadDropzone } from '../ui/UploadDropzone';

interface DubbingWorkbenchProps {
  sourceFile: File | null;
  targetLang: string;
  onSourceFile: (file: File | null) => void;
  onTargetLang: (language: string) => void;
  onStart: () => void;
  onCancel: () => void;
  isBusy: boolean;
  activeJobId: string | null;
  job: DubbingJobStatus | null;
  outputVideoUrl: string | null;
  outputAudioUrl: string | null;
  speakers: string[];
  voiceMap: Record<string, string>;
  onVoiceMap: (speaker: string, voiceId: string) => void;
  transcriptOverride: string;
  onTranscriptOverride: (value: string) => void;
  voices: VoiceOption[];
  languages: LanguageOption[];
  onDownloadReport: () => void;
}

export const DubbingWorkbench: React.FC<DubbingWorkbenchProps> = ({
  sourceFile,
  targetLang,
  onSourceFile,
  onTargetLang,
  onStart,
  onCancel,
  isBusy,
  activeJobId,
  job,
  outputVideoUrl,
  outputAudioUrl,
  speakers,
  voiceMap,
  onVoiceMap,
  transcriptOverride,
  onTranscriptOverride,
  voices,
  languages,
  onDownloadReport,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const startDisabled = !sourceFile || isBusy || Boolean(activeJobId);
  const statusLabel = job?.status || (activeJobId ? 'running' : 'idle');
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  const sourceIsVideo = Boolean(sourceFile?.type?.startsWith('video/'));
  const sourceIsAudio = Boolean(sourceFile?.type?.startsWith('audio/'));

  const voiceOptions = useMemo(() => {
    if (voices.length > 0) return voices;
    return [{ id: 'alloy', name: 'Default', gender: 'Unknown', accent: '', geminiVoiceName: 'alloy' } as VoiceOption];
  }, [voices]);

  useEffect(() => {
    if (!sourceFile) {
      setSourcePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const next = URL.createObjectURL(sourceFile);
    setSourcePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [sourceFile]);

  return (
    <div className="animate-in fade-in max-w-6xl mx-auto space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-5">
        <h2 className="text-xl font-bold text-gray-900">Video Dubbing</h2>
        <p className="text-xs text-gray-500 mt-0.5">One-click dubbing with strict backend automation.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <UploadDropzone
                accept="video/*,audio/*"
                file={sourceFile}
                onFilesSelected={(files) => onSourceFile(files[0] || null)}
                label="Upload source file"
                hint="Video or audio file"
                dragLabel="Drop source file"
                className="min-h-[88px] flex items-center justify-center"
              />
              <div>
                <label className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">Target Language</label>
                <select
                  value={targetLang}
                  onChange={(e) => onTargetLang(e.target.value)}
                  className="mt-1 w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Auto">Auto-Detect</option>
                  {languages.map((lang) => (
                    <option key={lang.code} value={lang.name}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onStart} disabled={startDisabled} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {isBusy ? <><Loader2 className="animate-spin mr-1.5" size={14} /> Starting...</> : <><Send size={14} className="mr-1.5" /> Start Dub</>}
              </Button>
              {activeJobId && (
                <Button onClick={onCancel} variant="danger">
                  <X size={14} className="mr-1.5" /> Cancel
                </Button>
              )}
              {job?.pipelineVersion === 'v2' && (
                <Button onClick={onDownloadReport} variant="secondary">
                  <Download size={14} className="mr-1.5" /> Report
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 transition-all duration-200"
            >
              <span>Advanced Overrides</span>
              {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-3 animate-in fade-in zoom-in-95 duration-200 origin-top">
                <textarea
                  value={transcriptOverride}
                  onChange={(e) => onTranscriptOverride(e.target.value)}
                  placeholder="Optional transcript override"
                  className="w-full min-h-[90px] p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="space-y-2">
                  {speakers.map((speaker) => (
                    <div key={speaker} className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-600 min-w-[100px]">{speaker}</span>
                      <select
                        value={voiceMap[speaker] || voiceOptions[0].id}
                        onChange={(e) => onVoiceMap(speaker, e.target.value)}
                        className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                      >
                        {voiceOptions.map((voice) => (
                          <option key={voice.id} value={voice.id}>{voice.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700">Status: {statusLabel}</span>
              <span className="font-mono text-gray-600">{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 border border-gray-200 mt-2 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-[11px] text-gray-500 mt-2">Stage: {job?.stage || 'waiting'}</div>
            {job?.error && <div className="text-[11px] text-red-600 mt-2">{job.error}</div>}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Source Preview</h3>
              <span className="text-[10px] text-gray-500">Input</span>
            </div>
            {sourcePreviewUrl && sourceIsVideo && (
              <video controls src={sourcePreviewUrl} className="w-full rounded-lg border border-gray-200 bg-black max-h-[300px]" />
            )}
            {sourcePreviewUrl && !sourceIsVideo && sourceIsAudio && (
              <audio controls src={sourcePreviewUrl} className="w-full" />
            )}
            {!sourcePreviewUrl && (
              <div className="text-xs text-gray-500 border border-dashed border-gray-200 rounded-lg p-4">
                Upload a source file to preview it here.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-emerald-800">Output Preview</h3>
              <span className="text-[10px] text-emerald-700">Result</span>
            </div>
            {outputVideoUrl && <video controls src={outputVideoUrl} className="w-full rounded-lg border border-emerald-200 bg-black max-h-[300px]" />}
            {outputAudioUrl && <audio controls src={outputAudioUrl} className="w-full" />}
            {!outputVideoUrl && !outputAudioUrl && (
              <div className="text-xs text-emerald-800/80 border border-dashed border-emerald-300 rounded-lg p-4 bg-white/60">
                Start dubbing to generate and preview output here.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-emerald-700">
              {outputVideoUrl && <a href={outputVideoUrl} download="dubbed.mp4"><Download size={13} className="inline mr-1" />Download MP4</a>}
              {outputAudioUrl && <a href={outputAudioUrl} download="dubbed.wav"><Download size={13} className="inline mr-1" />Download WAV</a>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
