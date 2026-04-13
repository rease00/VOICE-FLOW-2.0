'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Languages, Volume2, Cloud, Play, Loader2, Square } from 'lucide-react';
import type { TtsSettings } from '../../model/types';
import { API_ROUTES } from '../../../../shared/api/routes';

interface TTSOptionsProps {
  isCompact?: boolean;
  ttsSettings?: TtsSettings;
  onSettingsChange?: (settings: TtsSettings) => void;
}

const CLOUD_TTS_VOICES = [
  { id: 'Kore', name: 'Kore', gender: 'Female' },
  { id: 'Charon', name: 'Charon', gender: 'Male' },
  { id: 'Zephyr', name: 'Zephyr', gender: 'Female' },
  { id: 'Puck', name: 'Puck', gender: 'Male' },
  { id: 'Leda', name: 'Leda', gender: 'Female' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Male' },
  { id: 'Orus', name: 'Orus', gender: 'Male' },
  { id: 'Aoede', name: 'Aoede', gender: 'Female' },
  { id: 'Gacrux', name: 'Gacrux', gender: 'Female' },
  { id: 'Achernar', name: 'Achernar', gender: 'Female' },
  { id: 'Enceladus', name: 'Enceladus', gender: 'Male' },
  { id: 'Iapetus', name: 'Iapetus', gender: 'Male' },
  { id: 'Umbriel', name: 'Umbriel', gender: 'Male' },
  { id: 'Despina', name: 'Despina', gender: 'Female' },
  { id: 'Erinome', name: 'Erinome', gender: 'Female' },
  { id: 'Callirrhoe', name: 'Callirrhoe', gender: 'Female' },
  { id: 'Pulcherrima', name: 'Pulcherrima', gender: 'Female' },
];

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
];

const DEFAULT_SETTINGS: TtsSettings = {
  engine: 'cloud',
  voice: 'Kore',
  speed: 1,
  pitch: 0,
  language: 'en-US',
  speakerMode: 'single',
  speakerConfigs: [],
};

export function TTSOptions({ isCompact = false, ttsSettings, onSettingsChange }: TTSOptionsProps) {
  const settings = ttsSettings || DEFAULT_SETTINGS;
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const updateSetting = <K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) => {
    if (!onSettingsChange) return;
    onSettingsChange({ ...settings, [key]: value });
  };

  const stopPreview = useCallback(() => {
    if (!previewAudioRef.current) return;
    previewAudioRef.current.pause();
    previewAudioRef.current.src = '';
    previewAudioRef.current = null;
  }, []);

  const handlePreview = useCallback(async () => {
    if (previewLoading) return;
    stopPreview();
    setPreviewLoading(true);
    try {
      const response = await fetch(API_ROUTES.studio.synthesize, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'studio',
          text: 'Hello, this is a Cloud TTS preview.',
          engine: 'VECTOR',
          voice: settings.voice,
          language: settings.language,
          speed: settings.speed,
          speakerConfigs: settings.speakerMode === 'multi' ? settings.speakerConfigs : [],
        }),
      });
      if (!response.ok) {
        throw new Error('Preview failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
      };
      await audio.play();
    } catch {
      // Keep preview failures non-blocking in the reader UI.
    } finally {
      setPreviewLoading(false);
    }
  }, [previewLoading, settings.language, settings.speed, settings.speakerConfigs, settings.speakerMode, settings.voice, stopPreview]);

  if (isCompact) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Cloud size={14} className="text-[var(--vf-reader-accent-text)]" />
        <span className="truncate font-medium text-[var(--vf-reader-shell-text)]">{settings.voice}</span>
        <span className="ml-auto text-[var(--vf-reader-muted)]">{settings.speed.toFixed(1)}x</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[24px] border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-sm font-semibold text-[var(--vf-reader-shell-text)]">Cloud TTS</h3>

      <div className="rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--vf-reader-muted)]">
          <Cloud size={14} className="text-[var(--vf-reader-accent-text)]" />
          <span>Google Cloud Text-to-Speech</span>
        </div>
        <p className="mt-2 text-xs text-[var(--vf-reader-muted)]">
          Reader playback uses one low-latency Cloud TTS path backed by <span className="font-semibold text-[var(--vf-reader-panel-text)]">gemini-2.5-flash-tts</span>.
        </p>
      </div>

      <div className="space-y-1">
        <label className="inline-flex items-center gap-1 text-xs font-medium text-[var(--vf-reader-muted)]">
          <Languages size={14} />
          Language
        </label>
        <select
          value={settings.language}
          onChange={(event) => updateSetting('language', event.target.value)}
          className="w-full rounded-xl border border-[var(--vf-reader-input-border)] bg-[var(--vf-reader-input-bg)] px-3 py-2 text-sm text-[var(--vf-reader-input-text)] outline-none transition focus:border-[var(--vf-reader-accent-text)]"
        >
          {LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="inline-flex items-center gap-1 text-xs font-medium text-[var(--vf-reader-muted)]">
          <Volume2 size={14} />
          Voice
        </label>
        <div className="flex gap-2">
          <select
            value={settings.voice}
            onChange={(event) => updateSetting('voice', event.target.value)}
            className="flex-1 rounded-xl border border-[var(--vf-reader-input-border)] bg-[var(--vf-reader-input-bg)] px-3 py-2 text-sm text-[var(--vf-reader-input-text)] outline-none transition focus:border-[var(--vf-reader-accent-text)]"
          >
            {CLOUD_TTS_VOICES.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.gender})
              </option>
            ))}
          </select>
          <button
            onClick={previewAudioRef.current ? stopPreview : handlePreview}
            disabled={previewLoading}
            className="flex items-center gap-1 rounded-xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-choice-active-bg)]/30 px-3 py-2 text-xs font-medium text-[var(--vf-reader-accent-text)] transition hover:bg-[var(--vf-reader-choice-active-bg)]/50 disabled:opacity-50"
          >
            {previewLoading ? <Loader2 size={14} className="animate-spin" /> : previewAudioRef.current ? <Square size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--vf-reader-muted)]">Speed</label>
          <span className="text-xs font-semibold text-[var(--vf-reader-accent-text)]">{settings.speed.toFixed(2)}x</span>
        </div>
        <input
          type="range"
          min={0.7}
          max={1.3}
          step={0.05}
          value={settings.speed}
          onChange={(event) => updateSetting('speed', Number(event.target.value))}
          className="vf-reader-slider"
        />
      </div>
    </div>
  );
}
