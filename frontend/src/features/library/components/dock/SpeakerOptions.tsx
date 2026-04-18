'use client';

import React from 'react';
import { Users, User } from 'lucide-react';
import type { TtsSettings, SpeakerConfig, SpeakerMode } from '../../model/types';

const GEMINI_VOICES = [
  { id: 'Kore', gender: 'female' },
  { id: 'Charon', gender: 'male' },
  { id: 'Zephyr', gender: 'female' },
  { id: 'Puck', gender: 'male' },
  { id: 'Leda', gender: 'female' },
  { id: 'Fenrir', gender: 'male' },
  { id: 'Orus', gender: 'male' },
  { id: 'Aoede', gender: 'female' },
  { id: 'Gacrux', gender: 'female' },
  { id: 'Achernar', gender: 'female' },
  { id: 'Enceladus', gender: 'male' },
  { id: 'Iapetus', gender: 'male' },
  { id: 'Umbriel', gender: 'male' },
  { id: 'Despina', gender: 'female' },
  { id: 'Erinome', gender: 'female' },
];

interface CastMember {
  name: string;
  inferredGender?: string;
  inferredAge?: string;
}

interface SpeakerOptionsProps {
  isCompact?: boolean;
  ttsSettings?: TtsSettings;
  onSettingsChange?: (settings: TtsSettings) => void;
  cast?: CastMember[];
}

const DEFAULT_SETTINGS: TtsSettings = {
  engine: 'cloud',
  voice: 'Kore',
  speed: 1.0,
  pitch: 0,
  language: 'en-US',
  speakerMode: 'single',
  speakerConfigs: [],
};

function pickVoiceForGender(gender?: string, usedVoices: Set<string> = new Set()): string {
  const pool = gender === 'male'
    ? GEMINI_VOICES.filter((v) => v.gender === 'male')
    : GEMINI_VOICES.filter((v) => v.gender === 'female');
  const available = pool.find((v) => !usedVoices.has(v.id));
  return available ? available.id : pool[0]?.id || 'Kore';
}

function buildCastConfigs(cast: CastMember[]): SpeakerConfig[] {
  const used = new Set<string>();
  return cast.map((member) => {
    const voice = pickVoiceForGender(member.inferredGender, used);
    used.add(voice);
    return {
      name: member.name,
      voice,
      inferredGender: (member.inferredGender as SpeakerConfig['inferredGender']) || undefined,
      inferredAge: (member.inferredAge as SpeakerConfig['inferredAge']) || undefined,
    };
  });
}

export function SpeakerOptions({
  isCompact = false,
  ttsSettings,
  onSettingsChange,
  cast,
}: SpeakerOptionsProps) {
  const settings = ttsSettings || DEFAULT_SETTINGS;

  const updateSetting = <K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) => {
    if (!onSettingsChange) return;
    onSettingsChange({ ...settings, [key]: value });
  };

  const switchMode = (mode: SpeakerMode) => {
    if (!onSettingsChange) return;
    if (mode === 'multi' && cast && cast.length > 0 && settings.speakerConfigs.length === 0) {
      onSettingsChange({ ...settings, speakerMode: mode, speakerConfigs: buildCastConfigs(cast) });
    } else {
      onSettingsChange({ ...settings, speakerMode: mode });
    }
  };

  const updateSpeakerVoice = (index: number, voice: string) => {
    const configs = [...settings.speakerConfigs];
    configs[index] = { ...configs[index]!, voice };
    updateSetting('speakerConfigs', configs);
  };

  if (isCompact) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] px-3 py-2 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {settings.speakerMode === 'multi' ? (
          <Users size={14} className="text-[var(--vf-reader-accent-text)]" />
        ) : (
          <User size={14} className="text-[var(--vf-reader-accent-text)]" />
        )}
        <span className="capitalize font-medium text-[var(--vf-reader-shell-text)]">{settings.speakerMode}</span>
        {settings.speakerMode === 'multi' && settings.speakerConfigs.length > 0 && (
          <span className="ml-auto text-[var(--vf-reader-muted)]">{settings.speakerConfigs.length} voices</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-[24px] border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-sm font-semibold text-[var(--vf-reader-shell-text)]">Speaker mode</h3>

      <div className="flex gap-1 rounded-xl bg-[var(--vf-reader-choice-idle-bg)] p-0.5">
        <button
          onClick={() => switchMode('single')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
            settings.speakerMode === 'single'
              ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)] shadow-sm'
              : 'text-[var(--vf-reader-muted)] hover:text-[var(--vf-reader-panel-text)]'
          }`}
        >
          <User size={12} /> Single
        </button>
        <button
          onClick={() => switchMode('multi')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
            settings.speakerMode === 'multi'
              ? 'bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)] shadow-sm'
              : 'text-[var(--vf-reader-muted)] hover:text-[var(--vf-reader-panel-text)]'
          }`}
        >
          <Users size={12} /> Multi-speaker
        </button>
      </div>

      {settings.speakerMode === 'single' && (
        <p className="text-xs text-[var(--vf-reader-muted)]">
          All text is read using the voice selected in TTS Options.
        </p>
      )}

      {settings.speakerMode === 'multi' && (
        <div className="space-y-3">
          {settings.speakerConfigs.length === 0 && (!cast || cast.length === 0) && (
            <div className="rounded-xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-3">
              <p className="text-xs text-[var(--vf-reader-muted)]">
                No cast detected yet. Use the AI Script tab to analyze the chapter first &mdash; cast members will appear here automatically.
              </p>
            </div>
          )}

          {settings.speakerConfigs.length === 0 && cast && cast.length > 0 && (
            <button
              onClick={() => updateSetting('speakerConfigs', buildCastConfigs(cast))}
              className="w-full rounded-xl border border-[var(--vf-reader-choice-active-border)] bg-[var(--vf-reader-choice-active-bg)]/20 px-3 py-2 text-xs font-medium text-[var(--vf-reader-accent-text)] transition hover:bg-[var(--vf-reader-choice-active-bg)]/30"
            >
              Auto-assign voices for {cast.length} cast member{cast.length > 1 ? 's' : ''}
            </button>
          )}

          {settings.speakerConfigs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--vf-reader-muted)]">Voice assignments</p>
              {settings.speakerConfigs.map((config: SpeakerConfig, i: number) => (
                <div
                  key={config.name}
                  className="flex items-center gap-2 rounded-xl border border-[var(--vf-reader-card-border)] bg-[var(--vf-reader-card-bg)] p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--vf-reader-shell-text)]">{config.name}</p>
                    {config.inferredGender && (
                      <p className="capitalize text-[10px] text-[var(--vf-reader-muted)]">{config.inferredGender}</p>
                    )}
                  </div>
                  <select
                    value={config.voice}
                    onChange={(e) => updateSpeakerVoice(i, e.target.value)}
                    className="rounded-lg border border-[var(--vf-reader-input-border)] bg-[var(--vf-reader-input-bg)] px-2 py-1 text-xs text-[var(--vf-reader-input-text)] outline-none"
                  >
                    {GEMINI_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id} ({v.gender})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
