import React from 'react';
import type { VoiceOption } from '../../../../types';
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
  onTextDraftChange: (value: string) => void;
  onApplyTextEdit: () => void;
  onResetTextEdit: () => void;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onPlaybackLanguageChange: (value: string) => void;
}

const AMBIENCE_PRESETS = ['none', 'studio', 'forest', 'rain', 'cafe'];
const STYLE_PRESETS = ['default', 'dramatic', 'calm', 'cinematic'];
const COMMON_LANGUAGE_OPTIONS = ['en', 'hi', 'ja', 'es', 'fr', 'de'];

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
  voiceOptions: VoiceOption[],
  onToggleMultiSpeaker: () => void,
  onNarratorVoiceChange: (voiceId: string) => void,
  onSpeedChange: (value: number) => void,
  onAmbiencePresetChange: (value: string) => void,
  onStylePresetChange: (value: string) => void
) => (
  <>
    <h3>Voices</h3>
    <div className="vf-reader-v2-field">
      <label>Voice Mode</label>
      <button type="button" className={`vf-reader-v2-toggle ${multiSpeakerEnabled ? 'vf-reader-v2-toggle--active' : ''}`} onClick={onToggleMultiSpeaker}>
        {multiSpeakerEnabled ? 'Multi-speaker' : 'Single-speaker'}
      </button>
    </div>
    <div className="vf-reader-v2-field">
      <label>Narrator Voice</label>
      <select value={narratorVoiceId} onChange={(event) => onNarratorVoiceChange(event.target.value)}>
        {voiceOptions.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label>Speed</label>
      <input type="range" min={0.7} max={1.6} step={0.05} value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))} />
      <small>{speed.toFixed(2)}x</small>
    </div>
    <div className="vf-reader-v2-field">
      <label>Ambience</label>
      <select value={ambiencePreset} onChange={(event) => onAmbiencePresetChange(event.target.value)}>
        {AMBIENCE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label>Style Preset</label>
      <select value={stylePreset} onChange={(event) => onStylePresetChange(event.target.value)}>
        {STYLE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
      </select>
    </div>
  </>
);

const renderCastPanel = (
  multiSpeakerEnabled: boolean,
  detectedSpeakers: string[],
  castDraft: Record<string, string>,
  narratorVoiceId: string,
  voiceOptions: VoiceOption[],
  onCastDraftChange: (next: Record<string, string>) => void
) => (
  <>
    <h3>Cast</h3>
    {!multiSpeakerEnabled ? (
      <p>Enable multi-speaker mode to manage cast assignments.</p>
    ) : (
      <>
        <p>{detectedSpeakers.length} detected speakers.</p>
        {detectedSpeakers.length === 0 ? <p>No speakers detected in current unit yet.</p> : null}
        {detectedSpeakers.map((speaker) => (
          <div key={speaker} className="vf-reader-v2-field">
            <label>{speaker}</label>
            <select
              value={castDraft[speaker] || narratorVoiceId}
              onChange={(event) => onCastDraftChange({ ...castDraft, [speaker]: event.target.value })}
            >
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
    <textarea
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
      <label>Source Language</label>
      <select value={sourceLanguage} onChange={(event) => onSourceLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`source-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label>Target Language</label>
      <select value={targetLanguage} onChange={(event) => onTargetLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`target-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-field">
      <label>Playback Language</label>
      <select value={playbackLanguage} onChange={(event) => onPlaybackLanguageChange(event.target.value)}>
        {COMMON_LANGUAGE_OPTIONS.map((code) => (
          <option key={`playback-${code}`} value={code}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
    <div className="vf-reader-v2-translate-preview">
      <span>Preview</span>
      <p>{translationPreview || 'No translation preview available yet.'}</p>
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
                voiceOptions,
                onToggleMultiSpeaker,
                onNarratorVoiceChange,
                onSpeedChange,
                onAmbiencePresetChange,
                onStylePresetChange
              )
              : null}
            {tab === 'cast'
              ? renderCastPanel(
                multiSpeakerEnabled,
                detectedSpeakers,
                castDraft,
                narratorVoiceId,
                voiceOptions,
                onCastDraftChange
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
