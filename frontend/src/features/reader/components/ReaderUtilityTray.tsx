import React from 'react';
import type { VoiceOption } from '../../../../types';
import { MUSIC_TRACKS } from '../../../../constants';
import { useManagedTabs } from '../../../shared/ui/tabs';
import type { ReaderMode, ReaderTab } from '../model/tabs';
import { getReaderTabLabel } from '../model/tabs';
import type { ReaderScriptSegment } from '../model/session';
import type { ReaderOfflineAudioEntry } from '../model/offlineLibrary';
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
  isCastModeEnabled: boolean;
  ambienceSoundEnabled: boolean;
  narratorVoiceId: string;
  speed: number;
  ambiencePreset: string;
  stylePreset: string;
  voiceSettingsDirty: boolean;
  castSettingsDirty: boolean;
  isSavingVoiceSettings: boolean;
  isSavingCastAssignments: boolean;
  backgroundPrepLimitValue: number;
  backgroundPrepLimitUnit: 'chars' | 'words';
  voiceOptions: VoiceOption[];
  detectedSpeakers: string[];
  castDraft: Record<string, string>;
  textDraft: string;
  activeText: string;
  scriptSegments: ReaderScriptSegment[];
  currentUnitTitle: string;
  savepointDownloadUrl: string;
  textDirty: boolean;
  canInstallReaderApp: boolean;
  isReaderAppInstalled: boolean;
  readerAppInstallHint: string;
  savedAudioEntries: ReaderOfflineAudioEntry[];
  isSavingOfflineAudio: boolean;
  viewportMode?: 'mobile' | 'tablet' | 'desktop';
  surface?: 'workspace' | 'home-modal';
  onChangeTab: (tab: ReaderTab) => void;
  onToggleMultiSpeaker: () => void;
  onToggleCastMode: () => void;
  onToggleAmbienceSound: () => void;
  onNarratorVoiceChange: (voiceId: string) => void;
  onSpeedChange: (value: number) => void;
  onAmbiencePresetChange: (value: string) => void;
  onStylePresetChange: (value: string) => void;
  onCastDraftChange: (next: Record<string, string>) => void;
  onBackgroundPrepLimitValueChange: (value: number) => void;
  onBackgroundPrepLimitUnitChange: (value: 'chars' | 'words') => void;
  onSaveVoiceSettings: () => void;
  onSaveCastAssignments: () => void;
  onTextDraftChange: (value: string) => void;
  onApplyTextEdit: () => void;
  onResetTextEdit: () => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onPlaybackLanguageChange: (value: string) => void;
  onInstallReaderApp: () => void;
  onSaveCurrentToLibrary: () => void;
  onPlaySavedAudio: (id: string) => void;
  onDownloadSavedAudio: (id: string) => void;
  onDeleteSavedAudio: (id: string) => void;
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
const PREP_WORD_CHAR_FACTOR = 5;
const toFieldId = (prefix: string, value: string): string =>
  `${prefix}-${String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'default'}`;

const renderReadPanel = (mode: ReaderMode, tab: ReaderTab) => (
  <>
    <h3>{tab === 'read' ? 'Read View' : 'Panels View'}</h3>
    <p>{tab === 'read' ? 'Primary reading surface with chapter text and sentence focus.' : 'Primary comic surface with OCR bubble focus and panel navigation.'}</p>
    <div className="vf-reader-v2-panel__meta">
      <span>Mode: {mode}</span>
      <span>{tab === 'read' ? 'Text-first' : 'Panel-first'}</span>
    </div>
  </>
);

const mutedCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  border: '1px solid var(--reader-v2-border)',
  borderRadius: 14,
  background: 'var(--reader-v2-surface)',
};

const formatSavedAudioDate = (createdAtMs: number): string => {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return 'Saved recently';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(createdAtMs));
  } catch {
    return 'Saved recently';
  }
};

const formatSavedAudioSize = (sizeBytes: number): string => {
  const safeBytes = Math.max(0, Number(sizeBytes || 0));
  if (safeBytes <= 0) return 'Unknown size';
  if (safeBytes < 1024 * 1024) return `${Math.max(1, Math.round(safeBytes / 1024))} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

type ReaderSettingsInnerTab = 'voice' | 'cast' | 'translate' | 'prep' | 'text' | 'offline';

interface ReaderSettingsPanelProps {
  isCompactViewport: boolean;
  multiSpeakerEnabled: boolean;
  isCastModeEnabled: boolean;
  ambienceSoundEnabled: boolean;
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
  backgroundPrepLimitValue: number;
  backgroundPrepLimitUnit: 'chars' | 'words';
  sourceLanguage: string;
  targetLanguage: string;
  playbackLanguage: string;
  translationPreview: string;
  translationSupported: boolean;
  textDraft: string;
  activeText: string;
  textDirty: boolean;
  canInstallReaderApp: boolean;
  isReaderAppInstalled: boolean;
  readerAppInstallHint: string;
  onToggleMultiSpeaker: () => void;
  onToggleCastMode: () => void;
  onToggleAmbienceSound: () => void;
  onNarratorVoiceChange: (voiceId: string) => void;
  onSpeedChange: (value: number) => void;
  onAmbiencePresetChange: (value: string) => void;
  onStylePresetChange: (value: string) => void;
  onCastDraftChange: (next: Record<string, string>) => void;
  onBackgroundPrepLimitValueChange: (value: number) => void;
  onBackgroundPrepLimitUnitChange: (value: 'chars' | 'words') => void;
  onSaveVoiceSettings: () => void;
  onSaveCastAssignments: () => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onPlaybackLanguageChange: (value: string) => void;
  onTextDraftChange: (value: string) => void;
  onApplyTextEdit: () => void;
  onResetTextEdit: () => void;
  onInstallReaderApp: () => void;
}

const READER_SETTINGS_INNER_TABS: ReadonlyArray<{ id: ReaderSettingsInnerTab; label: string; detail: string }> = [
  { id: 'voice', label: 'Voice', detail: 'Mode and ambience' },
  { id: 'cast', label: 'Cast', detail: 'Speaker map' },
  { id: 'translate', label: 'Language', detail: 'Translation' },
  { id: 'prep', label: 'Buffer', detail: 'Prefetch size' },
  { id: 'text', label: 'Text', detail: 'OCR cleanup' },
  { id: 'offline', label: 'Offline', detail: 'Device setup' },
] as const;

const ReaderSettingsPanel: React.FC<ReaderSettingsPanelProps> = (input) => {
  const [activeInnerTab, setActiveInnerTab] = React.useState<ReaderSettingsInnerTab>('voice');
  const managedInnerTabs = useManagedTabs<ReaderSettingsInnerTab>({
    items: READER_SETTINGS_INNER_TABS.map((tab) => ({ id: tab.id })),
    activeId: activeInnerTab,
    onChange: setActiveInnerTab,
    label: 'Reader settings sections',
  });

  const resolvedTextDraft = String(input.textDraft || '');
  const effectivePrepLimitChars = input.backgroundPrepLimitUnit === 'words'
    ? input.backgroundPrepLimitValue * PREP_WORD_CHAR_FACTOR
    : input.backgroundPrepLimitValue;
  const effectivePrepLimitWords = Math.max(0, Math.round(effectivePrepLimitChars / PREP_WORD_CHAR_FACTOR));
  const castLockedByMultiSpeaker = input.multiSpeakerEnabled;

  const statusSummary = [
    { label: 'Voice', value: input.multiSpeakerEnabled ? 'Multi-speaker' : 'Single-speaker' },
    { label: 'Cast', value: castLockedByMultiSpeaker ? 'Locked on' : input.isCastModeEnabled ? 'Enabled' : 'Off' },
    { label: 'Language', value: `${input.sourceLanguage.toUpperCase()} to ${input.targetLanguage.toUpperCase()}` },
    { label: 'Buffer', value: `${effectivePrepLimitWords.toLocaleString()} words` },
  ];

  return (
    <div className="vf-reader-v2-settings-shell" data-reader-settings-viewport={input.isCompactViewport ? 'compact' : 'expanded'}>
      <div className="vf-reader-v2-settings-head">
        <div>
          <h3>Settings</h3>
          <p>Compact front-view controls with dedicated tabs for voice, cast, translation, buffer, text, and offline setup.</p>
        </div>
        <div className="vf-reader-v2-settings-overview" role="status" aria-live="polite">
          {statusSummary.map((item) => (
            <article key={item.label} className="vf-reader-v2-settings-overview-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      </div>

      <div className="vf-reader-v2-settings-tabs vf-scrollbar-invisible" {...managedInnerTabs.listProps}>
        {READER_SETTINGS_INNER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`vf-reader-v2-settings-tab ${activeInnerTab === tab.id ? 'vf-reader-v2-settings-tab--active' : ''}`}
            data-reader-settings-tab={tab.id}
            {...managedInnerTabs.getTabProps(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.detail}</small>
          </button>
        ))}
      </div>

      <div className="vf-reader-v2-settings-content vf-scrollbar-invisible">
        {READER_SETTINGS_INNER_TABS.map((tab) => (
          <section
            key={tab.id}
            className="vf-reader-v2-settings-panel"
            data-reader-settings-panel={tab.id}
            {...managedInnerTabs.getPanelProps(tab.id)}
          >
            {tab.id === 'voice' ? (
              <div className="vf-reader-v2-settings-grid">
                <article className="vf-reader-v2-settings-card">
                  <header className="vf-reader-v2-settings-card__head">
                    <h4>Voice Core</h4>
                    <p>Narration mode, cast mode, narrator voice, and speed in one place.</p>
                  </header>
                  <div className="vf-reader-v2-field">
                    <span id="reader-voice-mode-label">Voice Mode</span>
                    <button
                      id="reader-voice-mode-toggle"
                      type="button"
                      className={`vf-reader-v2-toggle ${input.multiSpeakerEnabled ? 'vf-reader-v2-toggle--active' : ''}`}
                      onClick={input.onToggleMultiSpeaker}
                      aria-pressed={input.multiSpeakerEnabled}
                    >
                      {input.multiSpeakerEnabled ? 'Multi-speaker' : 'Single-speaker'}
                    </button>
                    <small>
                      {input.multiSpeakerEnabled
                        ? 'Multi-speaker keeps cast mode on and auto-assigns narrator fallback.'
                        : 'Single-speaker keeps narration compact.'}
                    </small>
                  </div>
                  <div className="vf-reader-v2-field">
                    <span id="reader-cast-mode-label">Cast Mode</span>
                    <button
                      id="reader-cast-mode-toggle"
                      type="button"
                      className={`vf-reader-v2-toggle ${input.isCastModeEnabled ? 'vf-reader-v2-toggle--active' : ''}`}
                      onClick={input.onToggleCastMode}
                      aria-pressed={input.isCastModeEnabled}
                      disabled={castLockedByMultiSpeaker}
                    >
                      {input.isCastModeEnabled ? 'Cast on' : 'Cast off'}
                    </button>
                    <small>{castLockedByMultiSpeaker ? 'Locked on while multi-speaker is enabled.' : 'Enable cast to assign speaker voices manually.'}</small>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-narrator-voice">Narrator Voice</label>
                    <select id="reader-narrator-voice" value={input.narratorVoiceId} onChange={(event) => input.onNarratorVoiceChange(event.target.value)}>
                      {input.voiceOptions.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-speed-range">Speed</label>
                    <input
                      id="reader-speed-range"
                      type="range"
                      min={0.7}
                      max={1.6}
                      step={0.05}
                      value={input.speed}
                      aria-describedby="reader-speed-readout"
                      onChange={(event) => input.onSpeedChange(Number(event.target.value))}
                    />
                    <small id="reader-speed-readout">{input.speed.toFixed(2)}x</small>
                  </div>
                  <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
                    {input.voiceSettingsDirty
                      ? 'Voice settings have unsaved changes.'
                      : input.isCompactViewport
                        ? 'Voice settings saved.'
                        : 'Voice settings are saved to this session.'}
                  </p>
                  <div className="vf-reader-v2-panel__actions">
                    <button type="button" className="vf-reader-v2-primary" disabled={!input.voiceSettingsDirty || input.isSavingVoiceSettings} onClick={input.onSaveVoiceSettings}>
                      {input.isSavingVoiceSettings ? 'Saving Voice Settings...' : 'Save Voice Settings'}
                    </button>
                  </div>
                </article>

                <article className="vf-reader-v2-settings-card">
                  <header className="vf-reader-v2-settings-card__head">
                    <h4>Ambience + Style</h4>
                    <p>Background sound and output profile controls.</p>
                  </header>
                  <div className="vf-reader-v2-field">
                    <span id="reader-ambience-toggle-label">Ambience Sound</span>
                    <button
                      id="reader-ambience-toggle"
                      type="button"
                      className={`vf-reader-v2-toggle ${input.ambienceSoundEnabled ? 'vf-reader-v2-toggle--active' : ''}`}
                      onClick={input.onToggleAmbienceSound}
                      aria-pressed={input.ambienceSoundEnabled}
                    >
                      {input.ambienceSoundEnabled ? 'Ambience on' : 'Ambience off'}
                    </button>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-ambience-track">Ambience Track</label>
                    <select
                      id="reader-ambience-track"
                      value={input.ambiencePreset}
                      onChange={(event) => input.onAmbiencePresetChange(event.target.value)}
                      disabled={!input.ambienceSoundEnabled}
                    >
                      {AMBIENCE_TRACKS.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-style-preset">Style</label>
                    <select id="reader-style-preset" value={input.stylePreset} onChange={(event) => input.onStylePresetChange(event.target.value)}>
                      {STYLE_PRESET_OPTIONS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={mutedCardStyle}>
                    <strong>{input.ambienceSoundEnabled ? 'Ambient mix enabled' : 'Ambient mix disabled'}</strong>
                    <small>{input.ambienceSoundEnabled ? 'Track and style are active for this profile.' : 'Enable ambience to activate track controls.'}</small>
                  </div>
                </article>
              </div>
            ) : null}

            {tab.id === 'cast' ? (
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Cast Allocation</h4>
                  <p>Assign voices per detected speaker with narrator fallback support.</p>
                </header>
                {!input.multiSpeakerEnabled ? (
                  <div className="vf-reader-v2-settings-empty">
                    <p>Turn on multi-speaker mode from the Voice tab to unlock cast assignments.</p>
                    <div className="vf-reader-v2-panel__actions">
                      <button type="button" className="vf-reader-v2-secondary" onClick={input.onToggleMultiSpeaker}>
                        Enable Multi-speaker
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p>{input.detectedSpeakers.length} detected speakers. Missing voices auto-fill with narrator fallback.</p>
                    {input.detectedSpeakers.length === 0 ? <p role="status" aria-live="polite">No speakers detected in the current unit yet.</p> : null}
                    <div className="vf-reader-v2-settings-form-grid">
                      {input.detectedSpeakers.map((speaker) => {
                        const speakerId = toFieldId('reader-cast', speaker);
                        return (
                          <div key={speaker} className="vf-reader-v2-field">
                            <label htmlFor={speakerId}>{speaker}</label>
                            <select
                              id={speakerId}
                              value={String(input.castDraft[speaker] || '')}
                              onChange={(event) => input.onCastDraftChange({ ...input.castDraft, [speaker]: event.target.value })}
                            >
                              <option value="">Narrator fallback</option>
                              {input.voiceOptions.map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                  {voice.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
                  {input.castSettingsDirty ? 'Cast assignments have unsaved changes.' : 'Cast assignments are saved to this session.'}
                </p>
                <div className="vf-reader-v2-panel__actions">
                  <button type="button" className="vf-reader-v2-primary" disabled={!input.castSettingsDirty || input.isSavingCastAssignments || !input.multiSpeakerEnabled} onClick={input.onSaveCastAssignments}>
                    {input.isSavingCastAssignments ? 'Saving Cast...' : 'Save Cast Assignments'}
                  </button>
                </div>
              </article>
            ) : null}

            {tab.id === 'translate' ? (
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Language Controls</h4>
                  <p>Source, target, playback language, and preview in one tab.</p>
                </header>
                {!input.translationSupported ? <p>{input.isCompactViewport ? 'Switch playback language to enable translation preview.' : 'Choose a different playback language to enable translation preview.'}</p> : null}
                <div className="vf-reader-v2-settings-form-grid">
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-source-language">Source Language</label>
                    <select id="reader-source-language" value={input.sourceLanguage} onChange={(event) => input.onSourceLanguageChange(event.target.value)}>
                      {COMMON_LANGUAGE_OPTIONS.map((code) => (
                        <option key={`source-${code}`} value={code}>
                          {code.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-target-language">Target Language</label>
                    <select id="reader-target-language" value={input.targetLanguage} onChange={(event) => input.onTargetLanguageChange(event.target.value)}>
                      {COMMON_LANGUAGE_OPTIONS.map((code) => (
                        <option key={`target-${code}`} value={code}>
                          {code.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="vf-reader-v2-field vf-reader-v2-field--full">
                    <label htmlFor="reader-playback-language">Playback Language</label>
                    <select id="reader-playback-language" value={input.playbackLanguage} onChange={(event) => input.onPlaybackLanguageChange(event.target.value)}>
                      {COMMON_LANGUAGE_OPTIONS.map((code) => (
                        <option key={`playback-${code}`} value={code}>
                          {code.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="vf-reader-v2-translate-preview" role="status" aria-live="polite">
                  <span>Preview</span>
                  <p>{input.translationPreview || 'Translation preview is a mock placeholder until a real translation is available.'}</p>
                </div>
              </article>
            ) : null}

            {tab.id === 'prep' ? (
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Buffer Tuning</h4>
                  <p>Adjust how much text is prepared ahead of playback.</p>
                </header>
                <div className="vf-reader-v2-settings-form-grid">
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-prep-unit">Limit mode</label>
                    <select
                      id="reader-prep-unit"
                      value={input.backgroundPrepLimitUnit}
                      onChange={(event) => input.onBackgroundPrepLimitUnitChange(event.target.value === 'words' ? 'words' : 'chars')}
                    >
                      <option value="chars">Chars</option>
                      <option value="words">Words</option>
                    </select>
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="reader-prep-limit">{input.backgroundPrepLimitUnit === 'words' ? 'Prefetch words' : 'Prefetch chars'}</label>
                    <input
                      id="reader-prep-limit"
                      type="number"
                      min={25}
                      step={25}
                      value={input.backgroundPrepLimitValue}
                      onChange={(event) => input.onBackgroundPrepLimitValueChange(Math.max(0, Number(event.target.value || 0)))}
                    />
                  </div>
                </div>
                <div style={mutedCardStyle} role="status" aria-live="polite">
                  <strong>{effectivePrepLimitChars.toLocaleString()} chars</strong>
                  <small>Approx. {effectivePrepLimitWords.toLocaleString()} words at this buffer size.</small>
                </div>
              </article>
            ) : null}

            {tab.id === 'text' ? (
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Text Cleanup</h4>
                  <p>Review detected text, fix OCR edges, and apply speaker labels.</p>
                </header>
                <label htmlFor="reader-text-draft" className="vf-reader-v2-sr-only">Text draft editor</label>
                <textarea
                  id="reader-text-draft"
                  value={resolvedTextDraft}
                  onChange={(event) => input.onTextDraftChange(event.target.value)}
                  placeholder="Detected text appears here..."
                />
                <div className="vf-reader-v2-panel__actions">
                  <button type="button" className="vf-reader-v2-primary" disabled={!input.textDirty} onClick={input.onApplyTextEdit}>
                    Apply Text Edit
                  </button>
                  <button type="button" className="vf-reader-v2-secondary" onClick={input.onResetTextEdit}>
                    Reset
                  </button>
                </div>
                <small>{resolvedTextDraft.trim().length.toLocaleString()} characters in editor</small>
                <small>Raw: {input.activeText || 'No active text block selected yet.'}</small>
              </article>
            ) : null}

            {tab.id === 'offline' ? (
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Offline Access</h4>
                  <p>Install Reader shortcut and keep local playback ready on this device.</p>
                </header>
                <p>{input.readerAppInstallHint}</p>
                <div className="vf-reader-v2-panel__actions">
                  <button
                    type="button"
                    className="vf-reader-v2-secondary"
                    onClick={input.onInstallReaderApp}
                    disabled={!input.canInstallReaderApp || input.isReaderAppInstalled}
                  >
                    {input.isReaderAppInstalled ? 'Reader installed' : 'Install Reader shortcut'}
                  </button>
                </div>
              </article>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
};
const renderScriptsPanel = (scriptSegments: ReaderScriptSegment[]) => {
  const summary = scriptSegments.reduce<Record<'pending' | 'processing' | 'ready', number>>((accumulator, segment) => {
    accumulator[segment.status] += 1;
    return accumulator;
  }, { pending: 0, processing: 0, ready: 0 });

  return (
    <>
      <h3>Scripts</h3>
      <p>Detected script segments from the current session with live processing status.</p>
      <div className="vf-reader-v2-panel__meta">
        <span>{summary.ready} ready</span>
        <span>{summary.processing} processing</span>
        <span>{summary.pending} pending</span>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {scriptSegments.length === 0 ? (
          <p role="status" aria-live="polite">No script segments are available yet.</p>
        ) : scriptSegments.map((segment) => (
          <article
            key={segment.id}
            className="vf-reader-v2-panel"
            data-reader-script-segment={segment.id}
            style={{ margin: 0, padding: 10 }}
          >
            <div className="vf-reader-v2-panel__meta">
              <strong>{segment.title}</strong>
              <span className="vf-reader-v2-badge">{segment.status}</span>
            </div>
            <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={segment.body}>
              {segment.body || 'No text available for this segment yet.'}
            </p>
            <small>{segment.charCount.toLocaleString()} chars</small>
            {segment.speaker ? <small>Speaker: {segment.speaker}</small> : null}
          </article>
        ))}
      </div>
    </>
  );
};

const renderSavedPanel = (input: {
  currentUnitTitle: string;
  savepointDownloadUrl: string;
  isSavingOfflineAudio: boolean;
  savedAudioEntries: ReaderOfflineAudioEntry[];
  onSaveCurrentToLibrary: () => void;
  onPlaySavedAudio: (id: string) => void;
  onDownloadSavedAudio: (id: string) => void;
  onDeleteSavedAudio: (id: string) => void;
}) => (
  <>
    <h3>Saved Audio</h3>
    <p>Save local Reader audio for offline playback. Clearing browser site data removes saved items.</p>
    <div style={mutedCardStyle}>
      <strong>{input.currentUnitTitle || 'Current session'}</strong>
      <small>{input.savepointDownloadUrl ? 'Audio export is ready for local save.' : 'Export is still preparing for this session.'}</small>
    </div>
    <div className="vf-reader-v2-panel__actions">
      <button
        type="button"
        className="vf-reader-v2-primary"
        onClick={input.onSaveCurrentToLibrary}
        disabled={!input.savepointDownloadUrl || input.isSavingOfflineAudio}
      >
        {input.isSavingOfflineAudio ? 'Saving...' : 'Save to Library'}
      </button>
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      {input.savedAudioEntries.length === 0 ? (
        <p role="status" aria-live="polite">No local saved audio yet.</p>
      ) : input.savedAudioEntries.map((entry) => (
        <article key={entry.id} style={mutedCardStyle}>
          <div className="vf-reader-v2-panel__meta">
            <strong>{entry.title}</strong>
            <span className="vf-reader-v2-badge">{entry.speakerMode}</span>
            <span>{formatSavedAudioSize(entry.sizeBytes)}</span>
          </div>
          <small>{entry.unitLabel}</small>
          <small>{formatSavedAudioDate(entry.createdAtMs)}</small>
          <div className="vf-reader-v2-panel__actions">
            <button type="button" className="vf-reader-v2-secondary" onClick={() => input.onPlaySavedAudio(entry.id)}>
              Play
            </button>
            <button type="button" className="vf-reader-v2-secondary" onClick={() => input.onDownloadSavedAudio(entry.id)}>
              Download
            </button>
            <button type="button" className="vf-reader-v2-secondary" onClick={() => input.onDeleteSavedAudio(entry.id)}>
              Remove
            </button>
          </div>
        </article>
      ))}
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
  isCastModeEnabled,
  ambienceSoundEnabled,
  narratorVoiceId,
  speed,
  ambiencePreset,
  stylePreset,
  voiceSettingsDirty,
  castSettingsDirty,
  isSavingVoiceSettings,
  isSavingCastAssignments,
  backgroundPrepLimitValue,
  backgroundPrepLimitUnit,
  voiceOptions,
  detectedSpeakers,
  castDraft,
  textDraft,
  activeText,
  scriptSegments,
  currentUnitTitle,
  savepointDownloadUrl,
  textDirty,
  canInstallReaderApp,
  isReaderAppInstalled,
  readerAppInstallHint,
  savedAudioEntries,
  isSavingOfflineAudio,
  onChangeTab,
  onToggleMultiSpeaker,
  onToggleCastMode,
  onToggleAmbienceSound,
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
  onBackgroundPrepLimitValueChange,
  onBackgroundPrepLimitUnitChange,
  onSourceLanguageChange,
  onTargetLanguageChange,
  onPlaybackLanguageChange,
  onInstallReaderApp,
  onSaveCurrentToLibrary,
  onPlaySavedAudio,
  onDownloadSavedAudio,
  onDeleteSavedAudio,
  viewportMode = 'desktop',
  surface = 'workspace',
}) => {
  const isCompactViewport = viewportMode !== 'desktop';
  const isSettingsOnlySurface = tabs.length === 1 && tabs[0] === 'settings';
  const managedTabs = useManagedTabs({
    items: tabs.map((tab) => ({ id: tab })),
    activeId: activeTab,
    onChange: onChangeTab,
    label: 'Reader utility tabs',
    idBase: 'reader-utility',
  });
  const visibleTabs = tabs.includes(activeTab) ? [activeTab] : tabs.slice(0, 1);

  return (
    <aside
      className="vf-reader-v2-tray"
      data-testid="reader-utility-tray"
      data-reader-zone="tray"
      data-reader-surface={surface}
      data-reader-viewport={viewportMode}
      data-reader-utility-density={isCompactViewport ? 'compact' : 'expanded'}
    >
      <header className="vf-reader-v2-tray__header">
        <div>
          <div className="vf-reader-v2-eyebrow">Reader Tools</div>
          <strong>{isSettingsOnlySurface ? 'Settings' : 'Settings, scripts, and saved audio'}</strong>
        </div>
        {isCompactViewport ? null : <p>{isSettingsOnlySurface ? 'Tune Reader voice defaults before you open a session.' : 'Keep narration state, review edits, tune the buffer, and save audio without leaving the player.'}</p>}
      </header>
      <div className="vf-reader-v2-tray__tabs vf-scrollbar-invisible" {...managedTabs.listProps}>
        {tabs.map((tab) => {
          const badge = tabBadges[tab as keyof ReaderTabBadgeMap];
          return (
            <button
              key={tab}
              type="button"
              data-reader-tab={tab}
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
        {visibleTabs.map((tab) => (
          <section
            key={tab}
            className={`vf-reader-v2-panel ${tab === 'settings' ? 'vf-reader-v2-panel--settings' : ''}`}
            data-reader-tab-panel={tab}
            {...managedTabs.getPanelProps(tab)}
          >
            {tab === 'read' || tab === 'panels' ? renderReadPanel(mode, tab) : null}
            {tab === 'settings'
              ? (
                <ReaderSettingsPanel
                  isCompactViewport={isCompactViewport}
                  multiSpeakerEnabled={multiSpeakerEnabled}
                  isCastModeEnabled={isCastModeEnabled}
                  ambienceSoundEnabled={ambienceSoundEnabled}
                  narratorVoiceId={narratorVoiceId}
                  speed={speed}
                  ambiencePreset={ambiencePreset}
                  stylePreset={stylePreset}
                  voiceSettingsDirty={voiceSettingsDirty}
                  castSettingsDirty={castSettingsDirty}
                  isSavingVoiceSettings={isSavingVoiceSettings}
                  isSavingCastAssignments={isSavingCastAssignments}
                  voiceOptions={voiceOptions}
                  detectedSpeakers={detectedSpeakers}
                  castDraft={castDraft}
                  backgroundPrepLimitValue={backgroundPrepLimitValue}
                  backgroundPrepLimitUnit={backgroundPrepLimitUnit}
                  sourceLanguage={sourceLanguage}
                  targetLanguage={targetLanguage}
                  playbackLanguage={playbackLanguage}
                  translationPreview={translationPreview}
                  translationSupported={translationSupported}
                  textDraft={textDraft}
                  activeText={activeText}
                  textDirty={textDirty}
                  canInstallReaderApp={canInstallReaderApp}
                  isReaderAppInstalled={isReaderAppInstalled}
                  readerAppInstallHint={readerAppInstallHint}
                  onToggleMultiSpeaker={onToggleMultiSpeaker}
                  onToggleCastMode={onToggleCastMode}
                  onToggleAmbienceSound={onToggleAmbienceSound}
                  onNarratorVoiceChange={onNarratorVoiceChange}
                  onSpeedChange={onSpeedChange}
                  onAmbiencePresetChange={onAmbiencePresetChange}
                  onStylePresetChange={onStylePresetChange}
                  onCastDraftChange={onCastDraftChange}
                  onBackgroundPrepLimitValueChange={onBackgroundPrepLimitValueChange}
                  onBackgroundPrepLimitUnitChange={onBackgroundPrepLimitUnitChange}
                  onSaveVoiceSettings={onSaveVoiceSettings}
                  onSaveCastAssignments={onSaveCastAssignments}
                  onSourceLanguageChange={onSourceLanguageChange}
                  onTargetLanguageChange={onTargetLanguageChange}
                  onPlaybackLanguageChange={onPlaybackLanguageChange}
                  onTextDraftChange={onTextDraftChange}
                  onApplyTextEdit={onApplyTextEdit}
                  onResetTextEdit={onResetTextEdit}
                  onInstallReaderApp={onInstallReaderApp}
                />
              )
              : null}
            {tab === 'scripts' ? renderScriptsPanel(scriptSegments) : null}
            {tab === 'saved'
              ? renderSavedPanel({
                currentUnitTitle,
                savepointDownloadUrl,
                savedAudioEntries,
                isSavingOfflineAudio,
                onSaveCurrentToLibrary,
                onPlaySavedAudio,
                onDownloadSavedAudio,
                onDeleteSavedAudio,
              })
              : null}
          </section>
        ))}
      </div>
    </aside>
  );
};

