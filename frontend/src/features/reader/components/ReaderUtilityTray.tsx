import React from 'react';
import type { VoiceOption } from '../../../../types';
import { MUSIC_TRACKS } from '../../../../constants';
import { useManagedTabs } from '../../../shared/ui/tabs';
import type { ReaderMode, ReaderTab } from '../model/tabs';
import { getReaderTabLabel } from '../model/tabs';
import type { ReaderTabBadgeMap } from './readerTypes';

interface ReaderUtilityTrayProps {
  mode: ReaderMode;
  tabs: ReaderTab[];
  activeTab: ReaderTab;
  tabBadges: ReaderTabBadgeMap;
  sourceLanguage: string;
  targetLanguage: string;
  playbackLanguage: string;
  translationPreview: string;
  translationSupported: boolean;
  multiSpeakerEnabled: boolean;
  narratorVoiceId: string;
  speed: number;
  ambiencePreset: string;
  stylePreset: string;
  voiceSettingsDirty: boolean;
  castSettingsDirty: boolean;
  isSavingVoiceSettings: boolean;
  isSavingCastAssignments: boolean;
  voiceOptions: VoiceOption[];
  detectedSpeakers: string[];
  castDraft: Record<string, string>;
  textDraft: string;
  activeText: string;
  textDirty: boolean;
  onChangeTab: (tab: ReaderTab) => void;
  onToggleMultiSpeaker: () => void;
  onNarratorVoiceChange: (voiceId: string) => void;
  onSpeedChange: (value: number) => void;
  onAmbiencePresetChange: (value: string) => void;
  onStylePresetChange: (value: string) => void;
  onCastDraftChange: (next: Record<string, string>) => void;
  onSaveVoiceSettings: () => void;
  onSaveCastAssignments: () => void;
  onTextDraftChange: (value: string) => void;
  onApplyTextEdit: () => void;
  onResetTextEdit: () => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onPlaybackLanguageChange: (value: string) => void;
}

const AMBIENCE_TRACKS = MUSIC_TRACKS.map((track) => ({
  id: String(track.id || '').trim(),
  label: String(track.name || '').trim(),
})).filter((track) => Boolean(track.id) && Boolean(track.label));
const STYLE_PRESET_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'dramatic', label: 'Dramatic' },
];
const COMMON_LANGUAGE_OPTIONS = ['en', 'hi', 'ja', 'es', 'fr', 'de'];
const toFieldId = (prefix: string, value: string): string =>
  `${prefix}-${String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'default'}`;

const renderReadPanel = (mode: ReaderMode, tab: ReaderTab) => (
  <>
    <h3>{tab === 'read' ? 'Read View' : 'Panels View'}</h3>
    <p>{tab === 'read' ? 'Primary novel reading surface with chapter text and sentence focus.' : 'Primary comic panel surface with OCR bubble focus and panel navigation.'}</p>
    <div className="vf-reader-v2-panel__meta">
      <span>Mode: {mode}</span>
      <span>{tab === 'read' ? 'Text-first' : 'Panel-first'}</span>
    </div>
  </>
);

const renderVoicesPanel = (
  multiSpeakerEnabled: boolean,
  narratorVoiceId: string,
  speed: number,
  ambiencePreset: string,
  stylePreset: string,
  voiceSettingsDirty: boolean,
  isSavingVoiceSettings: boolean,
  voiceOptions: VoiceOption[],
  onToggleMultiSpeaker: () => void,
  onNarratorVoiceChange: (voiceId: string) => void,
  onSpeedChange: (value: number) => void,
  onAmbiencePresetChange: (value: string) => void,
  onStylePresetChange: (value: string) => void,
  onSaveVoiceSettings: () => void
) => (
  <>
    <h3>Voices</h3>
    <div className="vf-reader-v2-field">
      <span id="reader-voice-mode-label">Voice Mode</span>
      <button
        id="reader-voice-mode-toggle"
        type="button"
        className={`vf-reader-v2-toggle ${multiSpeakerEnabled ? 'vf-reader-v2-toggle--active' : ''}`}
        onClick={onToggleMultiSpeaker}
        aria-pressed={multiSpeakerEnabled}
      >
        {multiSpeakerEnabled ? 'Multi-speaker' : 'Single-speaker'}
      </button>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-narrator-voice">Narrator Voice</label>
      <select id="reader-narrator-voice" value={narratorVoiceId} onChange={(event) => onNarratorVoiceChange(event.target.value)}>
        {voiceOptions.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-speed-range">Speed</label>
      <input id="reader-speed-range" type="range" min={0.7} max={1.6} step={0.05} value={speed} aria-describedby="reader-speed-readout" onChange={(event) => onSpeedChange(Number(event.target.value))} />
      <small id="reader-speed-readout">{speed.toFixed(2)}x</small>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-ambience-track">Ambience</label>
      <select id="reader-ambience-track" value={ambiencePreset} onChange={(event) => onAmbiencePresetChange(event.target.value)}>
        {AMBIENCE_TRACKS.map((track) => (
          <option key={track.id} value={track.id}>
            {track.label}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-style-preset">Style</label>
      <select id="reader-style-preset" value={stylePreset} onChange={(event) => onStylePresetChange(event.target.value)}>
        {STYLE_PRESET_OPTIONS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
    </div>
    <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
      {voiceSettingsDirty ? 'Voice settings have unsaved changes.' : 'Voice settings are saved to this session.'}
    </p>
    <div className="vf-reader-v2-panel__actions">
      <button type="button" className="vf-reader-v2-primary" disabled={!voiceSettingsDirty || isSavingVoiceSettings} onClick={onSaveVoiceSettings}>
        {isSavingVoiceSettings ? 'Saving Voice Settings...' : 'Save Voice Settings'}
      </button>
    </div>
  </>
);

const renderCastPanel = (
  multiSpeakerEnabled: boolean,
  detectedSpeakers: string[],
  castDraft: Record<string, string>,
  castSettingsDirty: boolean,
  isSavingCastAssignments: boolean,
  voiceOptions: VoiceOption[],
  onCastDraftChange: (next: Record<string, string>) => void,
  onSaveCastAssignments: () => void
) => (
  <>
    <h3>Cast</h3>
    {!multiSpeakerEnabled ? (
      <p>Save voice settings with multi-speaker enabled to manage cast assignments.</p>
    ) : (
      <>
        <p>{detectedSpeakers.length} detected speakers.</p>
        {detectedSpeakers.length === 0 ? <p role="status" aria-live="polite">No speakers detected in the current unit yet.</p> : null}
        {detectedSpeakers.map((speaker) => (
          <div key={speaker} className="vf-reader-v2-field">
            <label htmlFor={toFieldId('reader-cast', speaker)}>{speaker}</label>
            <select
              id={toFieldId('reader-cast', speaker)}
              value={String(castDraft[speaker] || '')}
              onChange={(event) => onCastDraftChange({ ...castDraft, [speaker]: event.target.value })}
            >
              <option value="">Unassigned</option>
              {voiceOptions.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </>
    )}
    <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
      {castSettingsDirty ? 'Cast assignments have unsaved changes.' : 'Cast assignments are saved to this session.'}
    </p>
    <div className="vf-reader-v2-panel__actions">
      <button type="button" className="vf-reader-v2-primary" disabled={!castSettingsDirty || isSavingCastAssignments || !multiSpeakerEnabled} onClick={onSaveCastAssignments}>
        {isSavingCastAssignments ? 'Saving Cast...' : 'Save Cast Assignments'}
      </button>
    </div>
  </>
);

const renderTextPanel = (
  textDraft: string,
  activeText: string,
  textDirty: boolean,
  onTextDraftChange: (value: string) => void,
  onApplyTextEdit: () => void,
  onResetTextEdit: () => void
) => (
  <>
    <h3>Text</h3>
    <p>Review detected text, fix OCR edges, and apply speaker labels.</p>
    <label htmlFor="reader-text-draft" className="vf-reader-v2-sr-only">Text draft editor</label>
    <textarea
      id="reader-text-draft"
      value={textDraft}
      onChange={(event) => onTextDraftChange(event.target.value)}
      placeholder="Detected text appears here..."
    />
    <div className="vf-reader-v2-panel__actions">
      <button type="button" className="vf-reader-v2-primary" disabled={!textDirty} onClick={onApplyTextEdit}>
        Apply Text Edit
      </button>
      <button type="button" className="vf-reader-v2-secondary" onClick={onResetTextEdit}>
        Reset
      </button>
    </div>
    <small>{textDraft.trim().length.toLocaleString()} characters in editor</small>
    <small>Raw: {activeText || 'No active text block selected yet.'}</small>
  </>
);

const renderTranslatePanel = (
  sourceLanguage: string,
  targetLanguage: string,
  playbackLanguage: string,
  translationPreview: string,
  translationSupported: boolean,
  onSourceLanguageChange: (value: string) => void,
  onTargetLanguageChange: (value: string) => void,
  onPlaybackLanguageChange: (value: string) => void
) => (
  <>
    <h3>Translate</h3>
    {!translationSupported ? <p>Choose a different playback language to enable translation preview.</p> : null}
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-source-language">Source Language</label>
      <select id="reader-source-language" value={sourceLanguage} onChange={(event) => onSourceLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`source-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-target-language">Target Language</label>
      <select id="reader-target-language" value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`target-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label htmlFor="reader-playback-language">Playback Language</label>
      <select id="reader-playback-language" value={playbackLanguage} onChange={(event) => onPlaybackLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`playback-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-translate-preview" role="status" aria-live="polite">
      <span>Preview</span>
      <p>{translationPreview || 'Translation preview is a mock placeholder until a real translation is available.'}</p>
    </div>
  </>
);

export const ReaderUtilityTray: React.FC<ReaderUtilityTrayProps> = ({
  mode,
  tabs,
  activeTab,
  tabBadges,
  sourceLanguage,
  targetLanguage,
  playbackLanguage,
  translationPreview,
  translationSupported,
  multiSpeakerEnabled,
  narratorVoiceId,
  speed,
  ambiencePreset,
  stylePreset,
  voiceSettingsDirty,
  castSettingsDirty,
  isSavingVoiceSettings,
  isSavingCastAssignments,
  voiceOptions,
  detectedSpeakers,
  castDraft,
  textDraft,
  activeText,
  textDirty,
  onChangeTab,
  onToggleMultiSpeaker,
  onNarratorVoiceChange,
  onSpeedChange,
  onAmbiencePresetChange,
  onStylePresetChange,
  onCastDraftChange,
  onSaveVoiceSettings,
  onSaveCastAssignments,
  onTextDraftChange,
  onApplyTextEdit,
  onResetTextEdit,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onPlaybackLanguageChange,
}) => {
  const managedTabs = useManagedTabs({
    items: tabs.map((tab) => ({ id: tab })),
    activeId: activeTab,
    onChange: onChangeTab,
    label: 'Reader utility tabs',
    idBase: 'reader-utility',
  });

  return (
    <aside className="vf-reader-v2-tray" data-testid="reader-utility-tray">
      <header className="vf-reader-v2-tray__header">
        <div>
          <div className="vf-reader-v2-eyebrow">Reader Tools</div>
          <strong>Voice, text, and translation controls</strong>
        </div>
        <p>Keep narration state, review edits, and switch translations without leaving the player.</p>
      </header>
      <div className="vf-reader-v2-tray__tabs" {...managedTabs.listProps}>
        {tabs.map((tab) => {
          const badge = tabBadges[tab as keyof ReaderTabBadgeMap];
          return (
            <button
              key={tab}
              type="button"
              {...managedTabs.getTabProps(tab)}
              className={`vf-reader-v2-tab ${activeTab === tab ? 'vf-reader-v2-tab--active' : ''}`}
              title={`Open ${getReaderTabLabel(tab)} tab`}
            >
              <span>{getReaderTabLabel(tab)}</span>
              {badge ? <em>{badge}</em> : null}
            </button>
          );
        })}
      </div>

      <div className="vf-reader-v2-tray__body">
        {tabs.map((tab) => (
          <section key={tab} className="vf-reader-v2-panel" {...managedTabs.getPanelProps(tab)}>
            {tab === 'read' || tab === 'panels' ? renderReadPanel(mode, tab) : null}
            {tab === 'voices'
              ? renderVoicesPanel(
                multiSpeakerEnabled,
                narratorVoiceId,
                speed,
                ambiencePreset,
                stylePreset,
                voiceSettingsDirty,
                isSavingVoiceSettings,
                voiceOptions,
                onToggleMultiSpeaker,
                onNarratorVoiceChange,
                onSpeedChange,
                onAmbiencePresetChange,
                onStylePresetChange,
                onSaveVoiceSettings
              )
              : null}
            {tab === 'cast'
              ? renderCastPanel(
                multiSpeakerEnabled,
                detectedSpeakers,
                castDraft,
                castSettingsDirty,
                isSavingCastAssignments,
                voiceOptions,
                onCastDraftChange,
                onSaveCastAssignments
              )
              : null}
            {tab === 'text'
              ? renderTextPanel(
                textDraft,
                activeText,
                textDirty,
                onTextDraftChange,
                onApplyTextEdit,
                onResetTextEdit
              )
              : null}
            {tab === 'translate'
              ? renderTranslatePanel(
                sourceLanguage,
                targetLanguage,
                playbackLanguage,
                translationPreview,
                translationSupported,
                onSourceLanguageChange,
                onTargetLanguageChange,
                onPlaybackLanguageChange
              )
              : null}
          </section>
        ))}
      </div>
    </aside>
  );
};
