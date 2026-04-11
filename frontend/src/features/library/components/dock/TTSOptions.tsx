'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Languages, Volume2, Zap, Cpu, Play, Loader2, Square } from 'lucide-react';
import type { TtsSettings, TtsEngine } from '../../model/types';

interface TTSOptionsProps {
  isCompact?: boolean;
  ttsSettings?: TtsSettings;
  onSettingsChange?: (settings: TtsSettings) => void;
}

const GEMINI_VOICES = [
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
  { id: 'Autonoe', name: 'Autonoe', gender: 'Female' },
  { id: 'Pulcherrima', name: 'Pulcherrima', gender: 'Female' },
  { id: 'Achird', name: 'Achird', gender: 'Male' },
  { id: 'Rasalgethi', name: 'Rasalgethi', gender: 'Male' },
  { id: 'Schedar', name: 'Schedar', gender: 'Male' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', gender: 'Female' },
  { id: 'Sulafat', name: 'Sulafat', gender: 'Female' },
  { id: 'Sadachbia', name: 'Sadachbia', gender: 'Male' },
  { id: 'Sadaltager', name: 'Sadaltager', gender: 'Male' },
  { id: 'Algieba', name: 'Algieba', gender: 'Male' },
  { id: 'Algenib', name: 'Algenib', gender: 'Male' },
  { id: 'Alnilam', name: 'Alnilam', gender: 'Male' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', gender: 'Male' },
  { id: 'Laomedeia', name: 'Laomedeia', gender: 'Female' },
];

const NEURAL2_VOICES = [
  { id: 'en-US-Neural2-A', name: 'US Male A' },
  { id: 'en-US-Neural2-C', name: 'US Female C' },
  { id: 'en-US-Neural2-D', name: 'US Male D' },
  { id: 'en-US-Neural2-E', name: 'US Female E' },
  { id: 'en-GB-Neural2-A', name: 'UK Male A' },
  { id: 'en-GB-Neural2-B', name: 'UK Female B' },
];

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
];

const DEFAULT_SETTINGS: TtsSettings = {
  engine: 'gemini-native',
  voice: 'Kore',
  speed: 1.0,
  pitch: 0,
  language: 'en-US',
  speakerMode: 'single',
  speakerConfigs: [],
};

export function TTSOptions({ isCompact = false, ttsSettings, onSettingsChange }: TTSOptionsProps) {
  const settings = ttsSettings || DEFAULT_SETTINGS;

  const updateSetting = <K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) => {
    if (!onSettingsChange) return;
    onSettingsChange({ ...settings, [key]: value });
  };

  const switchEngine = (engine: TtsEngine) => {
    if (!onSettingsChange) return;
    const defaultVoice = engine === 'gemini-native' ? 'Kore' : 'en-US-Neural2-C';
    onSettingsChange({ ...settings, engine, voice: defaultVoice });
  };

  const voices = settings.engine === 'gemini-native' ? GEMINI_VOICES : NEURAL2_VOICES;

  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      URL.revokeObjectURL(previewAudioRef.current.src);
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
  }, []);

  const handlePreview = useCallback(async () => {
    if (previewLoading) return;
    stopPreview();
    setPreviewLoading(true);
    try {
      const endpoint = settings.engine === 'neural2' ? '/api/tts' : '/api/gemini-tts';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, this is a voice preview.',
          voice: settings.voice,
          language: settings.language,
          speed: settings.speed,
          pitch: settings.pitch,
        }),
      });
      if (!res.ok) throw new Error('Preview failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audio.src = '';
        previewAudioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audio.src = '';
        previewAudioRef.current = null;
      };
      await audio.play();
    } catch {
      // silent fail
    } finally {
      setPreviewLoading(false);
    }
  }, [settings, previewLoading, stopPreview]);

  if (isCompact) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <Volume2 size={14} className="text-[var(--vf-reader-accent-text)]" />
        <span className="truncate font-medium text-[var(--vf-reader-shell-text)]">{settings.voice}</span>
        <span className="ml-auto text-[var(--vf-reader-muted)]">{settings.speed.toFixed(1)}x</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[24px] border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-sm font-semibold text-[var(--vf-reader-shell-text)]">Text to speech</h3>

      <div className="space-y-1">
        <label className="inline-flex items-center gap-1 text-xs font-medium text-[var(--vf-reader-muted)]">
          <Cpu size={14} />
          Engine
        </label>
        <div className="flex gap-1 rounded-xl bg-[var(--vf-reader-choice-idle-bg)] p-0.5">
          <button
            onClick={() => switchEngine('gemini-native')}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              settings.engine === 'gemini-native'
                ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)] shadow-sm'
                : 'text-[var(--vf-reader-muted)] hover:text-[var(--vf-reader-panel-text)]'
            }`}
          >
            Gemini TTS
          </button>
          <button
            onClick={() => switchEngine('neural2')}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              settings.engine === 'neural2'
                ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)] shadow-sm'
                : 'text-[var(--vf-reader-muted)] hover:text-[var(--vf-reader-panel-text)]'
            }`}
          >
            Neural2
          </button>
        </div>
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
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
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
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}{('gender' in voice) ? ` (${voice.gender})` : ''}
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
          <label className="inline-flex items-center gap-1 text-xs font-medium text-[var(--vf-reader-muted)]">
            <Zap size={14} className="text-[var(--vf-reader-accent-text)]" />
            Speed
          </label>
          <span className="text-xs font-semibold text-[var(--vf-reader-accent-text)]">{settings.speed.toFixed(2)}x</span>
        </div>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          value={settings.speed}
          onChange={(event) => updateSetting('speed', Number(event.target.value))}
          className="vf-reader-slider"
        />
      </div>

      {settings.engine === 'neural2' && (
        <div className="space-y-2 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--vf-reader-muted)]">Pitch</label>
            <span className="text-xs font-semibold text-[var(--vf-reader-accent-text)]">{settings.pitch.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={-6}
            max={6}
            step={0.5}
            value={settings.pitch}
            onChange={(event) => updateSetting('pitch', Number(event.target.value))}
            className="vf-reader-slider"
          />
        </div>
      )}
    </div>
  );
}
