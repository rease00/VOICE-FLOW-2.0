import React from 'react';
import { Languages, Settings2, UploadCloud, Wand2, Users, X } from 'lucide-react';
import { LANGUAGES, VOICES } from '../../../../constants';
import type {
  ReaderCatalogRegion,
  ReaderCommercialPolicy,
  ReaderOwnershipBasis,
  ReaderSession,
  WorkspaceLayoutMode,
} from '../../../../types';
import { useManagedTabs } from '../../../shared/ui/tabs';
import { getReaderAvailableUtilityPanels } from './readerTypes';
import type {
  ReaderAutoAdvanceProfile,
  ReaderAudioEngine,
  ReaderUtilityPanel,
  ReaderUtilityPanelScope,
  UploadContentType,
} from './readerTypes';

interface ReaderUtilityTrayProps {
  layoutMode: WorkspaceLayoutMode;
  panel: ReaderUtilityPanel | null;
  panelScope: ReaderUtilityPanelScope;
  session: ReaderSession | null;
  isOpen: boolean;
  legalAckAccepted: boolean;
  commercialPolicy: ReaderCommercialPolicy | null;
  regions: ReaderCatalogRegion[];
  regionId: string;
  uploadTitle: string;
  uploadContentType: UploadContentType;
  uploadOwnershipBasis: ReaderOwnershipBasis;
  selectedFiles: File[];
  targetLanguageDraft: string;
  pageViewModeDraft: 'original' | 'translated';
  ttsLanguageModeDraft: 'auto' | 'source' | 'target';
  audioEngineDraft: ReaderAudioEngine;
  audioEngineStatusLabel: string;
  readingModeDraft: string;
  autoAdvanceDraft: ReaderAutoAdvanceProfile;
  narratorVoiceId: string;
  multiSpeakerEnabled: boolean;
  castDraft: Record<string, string>;
  castSpeakers: string[];
  activeDetectedUnitId: string;
  editedDetectedText: string;
  activeDetectedText: string;
  hasEditedTextDirty: boolean;
  isSaving: boolean;
  isUploading: boolean;
  isAutoAssigningCast: boolean;
  onClose: () => void;
  onSelectPanel: (panel: ReaderUtilityPanel) => void;
  onSavepoint: () => void;
  onSavePreferences: () => void;
  onCloseSession: () => void;
  onSetRegionId: (value: string) => void;
  onSetUploadTitle: (value: string) => void;
  onSetUploadContentType: (value: UploadContentType) => void;
  onSetUploadOwnershipBasis: (value: ReaderOwnershipBasis) => void;
  onFileSelection: (files: File[]) => void;
  onUpload: () => void;
  onSetTargetLanguageDraft: (value: string) => void;
  onSetPageViewModeDraft: (value: 'original' | 'translated') => void;
  onSetTtsLanguageModeDraft: (value: 'auto' | 'source' | 'target') => void;
  onSetAudioEngineDraft: (value: ReaderAudioEngine) => void;
  onSetReadingModeDraft: (value: string) => void;
  onSetAutoAdvanceDraft: (value: ReaderAutoAdvanceProfile) => void;
  onSetNarratorVoiceId: (value: string) => void;
  onSetMultiSpeakerEnabled: (value: boolean) => void;
  onCastDraftChange: (next: Record<string, string>) => void;
  onAutoAssignCast: () => void;
  onEditedDetectedTextChange: (value: string) => void;
  onApplyDetectedTextOverride: () => void;
  onResetDetectedTextOverride: () => void;
}

const AUTO_ADVANCE_OPTIONS: Array<{ value: ReaderAutoAdvanceProfile; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'audio_sync', label: 'Audio Sync' },
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'fast', label: 'Fast' },
];

const DEFAULT_OWNERSHIP_BASIS_OPTIONS = [
  {
    value: 'own_work',
    label: 'Own work',
    description: 'You created the work and control its narration rights.',
  },
  {
    value: 'licensed',
    label: 'Licensed',
    description: 'You have a direct license or publisher permission for commercial narration.',
  },
  {
    value: 'open_license',
    label: 'Open license',
    description: 'The source is under a license that allows this use with attribution or other required terms.',
  },
  {
    value: 'public_domain',
    label: 'Public domain',
    description: 'The work is in the public domain for your target market.',
  },
  {
    value: 'user_responsible',
    label: 'User responsible',
    description: 'You will verify rights manually before commercial release.',
  },
] satisfies ReaderCommercialPolicy['ownershipBasisOptions'];

const PANEL_LABELS: Record<ReaderUtilityPanel, string> = {
  import: 'Import',
  settings: 'Settings',
  translator: 'Translator',
  detected: 'AI Text',
  cast: 'Cast',
};

const renderHeader = (panel: ReaderUtilityPanel | null): { title: string; description: string; icon: React.ReactNode } => {
  if (panel === 'import') {
    return {
      title: 'Import To Reader',
      description: 'Bring novels, books, manga, or comics into your Reader queue.',
      icon: <UploadCloud size={16} />,
    };
  }
  if (panel === 'translator') {
    return {
      title: 'Translator',
      description: 'Control source/target language, page view, and speech language routing.',
      icon: <Languages size={16} />,
    };
  }
  if (panel === 'detected') {
    return {
      title: 'AI Detected Text',
      description: 'Edit the current detected text without modifying the original upload.',
      icon: <Wand2 size={16} />,
    };
  }
  if (panel === 'cast') {
    return {
      title: 'Cast & Crew',
      description: 'Assign narrator and dialogue voices for multi-speaker playback.',
      icon: <Users size={16} />,
    };
  }
  return {
    title: 'Reader Settings',
    description: 'Tune playback, engine choice, region, and pacing for the current session or your Reader defaults.',
    icon: <Settings2 size={16} />,
  };
};

export const ReaderUtilityTray: React.FC<ReaderUtilityTrayProps> = ({
  layoutMode,
  panel,
  panelScope,
  session,
  isOpen,
  legalAckAccepted,
  commercialPolicy,
  regions,
  regionId,
  uploadTitle,
  uploadContentType,
  uploadOwnershipBasis,
  selectedFiles,
  targetLanguageDraft,
  pageViewModeDraft,
  ttsLanguageModeDraft,
  audioEngineDraft,
  audioEngineStatusLabel,
  readingModeDraft,
  autoAdvanceDraft,
  narratorVoiceId,
  multiSpeakerEnabled,
  castDraft,
  castSpeakers,
  activeDetectedUnitId,
  editedDetectedText,
  activeDetectedText,
  hasEditedTextDirty,
  isSaving,
  isUploading,
  isAutoAssigningCast,
  onClose,
  onSelectPanel,
  onSavepoint,
  onSavePreferences,
  onCloseSession,
  onSetRegionId,
  onSetUploadTitle,
  onSetUploadContentType,
  onSetUploadOwnershipBasis,
  onFileSelection,
  onUpload,
  onSetTargetLanguageDraft,
  onSetPageViewModeDraft,
  onSetTtsLanguageModeDraft,
  onSetAudioEngineDraft,
  onSetReadingModeDraft,
  onSetAutoAdvanceDraft,
  onSetNarratorVoiceId,
  onSetMultiSpeakerEnabled,
  onCastDraftChange,
  onAutoAssignCast,
  onEditedDetectedTextChange,
  onApplyDetectedTextOverride,
  onResetDetectedTextOverride,
}) => {
  const availablePanels: ReaderUtilityPanel[] = panelScope === 'translator_only'
    ? ['translator']
    : getReaderAvailableUtilityPanels(Boolean(session));
  const activePanel = panel && availablePanels.includes(panel) ? panel : (availablePanels[0] || null);
  const isCompactImport = layoutMode === 'desktop' && activePanel === 'import';
  const ownershipBasisOptions = commercialPolicy?.ownershipBasisOptions?.length
    ? commercialPolicy.ownershipBasisOptions
    : DEFAULT_OWNERSHIP_BASIS_OPTIONS;
  const selectedOwnershipBasis = ownershipBasisOptions.find((option) => option.value === uploadOwnershipBasis);
  const header = renderHeader(activePanel);
  const showSessionOnlyMessage = Boolean(activePanel && (activePanel === 'detected' || activePanel === 'cast') && !session);
  const comicReadingModeValue = readingModeDraft === 'rtl_paged' || readingModeDraft === 'ltr_paged'
    ? readingModeDraft
    : 'vertical_strip';
  const managedTabs = useManagedTabs({
    items: availablePanels.map((id) => ({ id })),
    activeId: activePanel || availablePanels[0] || 'translator',
    onChange: onSelectPanel,
    label: 'Reader tools',
    idBase: 'reader-utility',
  });

  const renderPanelContent = (): React.ReactNode => {
    if (showSessionOnlyMessage) {
      return <div className="vf-reader-tray__empty">Open or resume a Reader session to use this panel.</div>;
    }

    if (activePanel === 'import') {
      return (
        <div className="vf-reader-tray__body">
          <div className="vf-reader-tray__grid">
            <label className="vf-reader-tray__field vf-reader-tray__field--wide">
              <span>Display Title</span>
              <input
                value={uploadTitle}
                onChange={(event) => onSetUploadTitle(event.target.value)}
                placeholder="Optional title"
              />
            </label>

            <label className="vf-reader-tray__field">
              <span>Content Type</span>
              <select value={uploadContentType} onChange={(event) => onSetUploadContentType(event.target.value as UploadContentType)}>
                <option value="auto">Auto detect</option>
                <option value="book">Book / novel</option>
                <option value="comic">Comic / manga</option>
              </select>
            </label>

            <label className="vf-reader-tray__field">
              <span>Rights Basis</span>
              <select
                value={uploadOwnershipBasis}
                onChange={(event) => onSetUploadOwnershipBasis(event.target.value as ReaderOwnershipBasis)}
              >
                {ownershipBasisOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>
                {selectedOwnershipBasis?.description || 'Choose the basis you are relying on for this upload.'}
              </small>
            </label>
          </div>

          <label className="vf-reader-tray__dropzone">
            <input
              type="file"
              multiple
              accept=".txt,.md,.docx,.pdf,.epub,.cbz,.zip,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(event) => onFileSelection(Array.from(event.target.files || []))}
            />
            <UploadCloud size={18} />
            <div>
              <strong>{selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected` : 'Choose files to import'}</strong>
              <p>TXT, MD, DOCX, PDF, EPUB, CBZ, ZIP, PNG, JPG, JPEG, WEBP.</p>
            </div>
          </label>

          <div className="vf-reader-tray__actions">
            <button
              type="button"
              className="vf-reader-tray__button vf-reader-tray__button--primary"
              onClick={onUpload}
              disabled={!legalAckAccepted || isUploading || selectedFiles.length === 0}
            >
              {isUploading ? 'Importing...' : 'Import & Open'}
            </button>
            {!legalAckAccepted ? <span className="vf-reader-tray__hint">Accept the Reader rights notice once before importing.</span> : null}
            {commercialPolicy?.enabled ? (
              <span className="vf-reader-tray__hint">
                Commercial mode is active. Upload owned or licensed files, or use catalog items marked commercial-ready.
              </span>
            ) : null}
            {commercialPolicy?.enabled && commercialPolicy.blockedProviders.length ? (
              <span className="vf-reader-tray__hint">
                Restricted catalog families: {commercialPolicy.blockedProviders.slice(0, 3).join(', ')}
                {commercialPolicy.blockedProviders.length > 3 ? ` +${commercialPolicy.blockedProviders.length - 3} more` : ''}.
              </span>
            ) : null}
          </div>
        </div>
      );
    }

    if (activePanel === 'settings') {
      return (
        <div className="vf-reader-tray__body">
          <div className="vf-reader-tray__grid">
            <label className="vf-reader-tray__field">
              <span>Region</span>
              <select value={regionId} onChange={(event) => onSetRegionId(event.target.value)}>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="vf-reader-tray__field">
              <span>Audio Engine</span>
              <select value={audioEngineDraft} onChange={(event) => onSetAudioEngineDraft(event.target.value as ReaderAudioEngine)}>
                <option value="native_audio_dialog">Native Audio Dialog (Default)</option>
                <option value="tts_hd">TTS HD (Fallback)</option>
              </select>
              <small>Status: {audioEngineStatusLabel}</small>
            </label>

            <label className="vf-reader-tray__field">
              <span>Narrator Voice</span>
              <select value={narratorVoiceId} onChange={(event) => onSetNarratorVoiceId(event.target.value)}>
                {VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="vf-reader-tray__field">
              <span>Multi-Speaker</span>
              <select value={multiSpeakerEnabled ? 'multi' : 'single'} onChange={(event) => onSetMultiSpeakerEnabled(event.target.value === 'multi')}>
                <option value="single">Single Speaker</option>
                <option value="multi">Multi Speaker</option>
              </select>
            </label>

            {session?.contentKind === 'comic' || !session ? (
              <>
                <label className="vf-reader-tray__field">
                  <span>{session ? 'Reading Mode' : 'Comic Reading Mode'}</span>
                  <select value={comicReadingModeValue} onChange={(event) => onSetReadingModeDraft(event.target.value)}>
                    <option value="vertical_strip">Vertical Strip</option>
                    <option value="rtl_paged">Right To Left</option>
                    <option value="ltr_paged">Left To Right</option>
                  </select>
                </label>

                <label className="vf-reader-tray__field">
                  <span>Auto Advance</span>
                  <select value={autoAdvanceDraft} onChange={(event) => onSetAutoAdvanceDraft(event.target.value as ReaderAutoAdvanceProfile)}>
                    {AUTO_ADVANCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>

          <div className="vf-reader-tray__actions">
            <button
              type="button"
              className="vf-reader-tray__button vf-reader-tray__button--primary"
              onClick={session ? onSavepoint : onSavePreferences}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : session ? 'Save Reader Settings' : 'Save Reader Defaults'}
            </button>
            {session ? (
              <button type="button" className="vf-reader-tray__button vf-reader-tray__button--danger" onClick={onCloseSession}>
                Close Session
              </button>
            ) : (
              <span className="vf-reader-tray__hint">These defaults apply when you open the next Reader session.</span>
            )}
          </div>
        </div>
      );
    }

    if (activePanel === 'translator') {
      return (
        <div className="vf-reader-tray__body">
          <div className="vf-reader-tray__grid">
            <label className="vf-reader-tray__field">
              <span>Target Language</span>
              <select value={targetLanguageDraft} onChange={(event) => onSetTargetLanguageDraft(event.target.value)}>
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="vf-reader-tray__field">
              <span>Page View</span>
              <select value={pageViewModeDraft} onChange={(event) => onSetPageViewModeDraft(event.target.value as 'original' | 'translated')}>
                <option value="original">Original</option>
                <option value="translated">Translated</option>
              </select>
            </label>

            <label className="vf-reader-tray__field">
              <span>Speech Language</span>
              <select value={ttsLanguageModeDraft} onChange={(event) => onSetTtsLanguageModeDraft(event.target.value as 'auto' | 'source' | 'target')}>
                <option value="auto">Auto</option>
                <option value="source">Source</option>
                <option value="target">Target</option>
              </select>
            </label>
          </div>

          <div className="vf-reader-tray__actions">
            <button
              type="button"
              className="vf-reader-tray__button vf-reader-tray__button--primary"
              onClick={session ? onSavepoint : onSavePreferences}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : session ? 'Apply Translation State' : 'Save Translation Defaults'}
            </button>
            {!session ? <span className="vf-reader-tray__hint">Save language defaults before opening a new Reader session.</span> : null}
          </div>
        </div>
      );
    }

    if (activePanel === 'detected' && session) {
      return (
        <div className="vf-reader-tray__body">
          <div className="vf-reader-tray__detected-meta">
            <strong>{activeDetectedUnitId || 'No active unit yet'}</strong>
            <span>{activeDetectedUnitId ? 'Session-only override' : 'Play a window or panel to edit detected text'}</span>
          </div>
          <textarea
            rows={8}
            value={editedDetectedText}
            onChange={(event) => onEditedDetectedTextChange(event.target.value)}
            placeholder={activeDetectedText || 'Detected text will appear here during playback.'}
            disabled={!activeDetectedUnitId}
          />
          <div className="vf-reader-tray__actions">
            <button
              type="button"
              className="vf-reader-tray__button vf-reader-tray__button--primary"
              onClick={onApplyDetectedTextOverride}
              disabled={!activeDetectedUnitId || !hasEditedTextDirty || isSaving}
            >
              Apply Session Edit
            </button>
            <button
              type="button"
              className="vf-reader-tray__button"
              onClick={onResetDetectedTextOverride}
              disabled={!activeDetectedUnitId || isSaving}
            >
              Reset Text
            </button>
          </div>
        </div>
      );
    }

    if (activePanel === 'cast' && session) {
      return (
        <div className="vf-reader-tray__body">
          {!multiSpeakerEnabled ? (
            <div className="vf-reader-tray__empty">Enable Multi-Speaker mode to show cast mapping.</div>
          ) : (
            <>
              <div className="vf-reader-tray__actions vf-reader-tray__actions--between">
                <span className="vf-reader-tray__hint">Detected {castSpeakers.length} speaker{castSpeakers.length === 1 ? '' : 's'}.</span>
                <button
                  type="button"
                  className="vf-reader-tray__button"
                  onClick={onAutoAssignCast}
                  disabled={castSpeakers.length === 0 || isAutoAssigningCast}
                >
                  {isAutoAssigningCast ? 'Assigning...' : 'AI Auto Assign'}
                </button>
              </div>
              <div className="vf-reader-tray__grid">
                {castSpeakers.map((speaker) => (
                  <label key={speaker} className="vf-reader-tray__field">
                    <span>{speaker}</span>
                    <select
                      value={castDraft[speaker] || narratorVoiceId}
                      onChange={(event) => onCastDraftChange({ ...castDraft, [speaker]: event.target.value })}
                    >
                      {VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="vf-reader-tray__actions">
                <button type="button" className="vf-reader-tray__button vf-reader-tray__button--primary" onClick={onSavepoint} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Cast Mapping'}
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    return null;
  };

  const panelContent = renderPanelContent();

  if (!activePanel || !isOpen) return null;

  const shellClassName = `vf-reader-tray-shell vf-reader-tray-shell--${layoutMode}${isCompactImport ? ' vf-reader-tray-shell--compact-import' : ''}`;
  const trayClassName = `vf-reader-tray vf-reader-tray--${layoutMode}${isCompactImport ? ' vf-reader-tray--compact-import' : ''}`;

  return (
    <div className={shellClassName} data-testid="reader-utility-shell">
      {layoutMode !== 'desktop' || isCompactImport ? <button type="button" className={`vf-reader-tray__scrim${isCompactImport ? ' vf-reader-tray__scrim--desktop' : ''}`} onClick={onClose} aria-label="Close reader tools overlay" /> : null}
      <section className={trayClassName} data-testid="reader-utility-tray">
        <div className="vf-reader-tray__header">
          <div>
            <div className="vf-reader-tray__eyebrow">
              {header.icon}
              Reader Utility
            </div>
            <h3>{header.title}</h3>
            <p>{header.description}</p>
          </div>
          <button type="button" className="vf-reader-tray__close" onClick={onClose} aria-label="Close reader utility tray">
            <X size={16} />
          </button>
        </div>

        {!isCompactImport && panelScope !== 'translator_only' ? (
          <div className="vf-reader-tray__panel-strip" {...managedTabs.listProps}>
            {availablePanels.map((panelId) => (
              <button
                key={panelId}
                type="button"
                className={`vf-reader-tray__panel-tab ${panelId === activePanel ? 'vf-reader-tray__panel-tab--active' : ''}`}
                {...managedTabs.getTabProps(panelId)}
              >
                {PANEL_LABELS[panelId]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="vf-reader-tray__panel-content" {...managedTabs.getPanelProps(activePanel)}>
          {panelContent}
        </div>
      </section>
    </div>
  );
};
