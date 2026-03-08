import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileAudio,
  Library,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { LANGUAGES, VOICES } from '../../../../constants';
import type { ReaderCatalogItem, ReaderLegalAck, ReaderLibrary, ReaderSession } from '../../../../types';
import type { ReaderPrimaryAction, ReaderSortOption, ReaderSurfaceFilter } from '../model/library';
import type { ReaderAuditModel } from './readerAudit';
import type {
  ReaderAutoAdvanceProfile,
  ReaderContentFilter,
  ReaderPanelSection,
  ReaderProgressFilter,
  ReaderViewMode,
  UploadContentType,
} from './readerTypes';

interface ReaderControlPanelProps {
  activePanel: ReaderPanelSection;
  isCollapsed: boolean;
  isCollapsible: boolean;
  session: ReaderSession | null;
  selectedItem: ReaderCatalogItem | null;
  sessionItem: ReaderCatalogItem | null;
  currentPrimaryAction: ReaderPrimaryAction | null;
  library: ReaderLibrary | null;
  filteredItems: ReaderCatalogItem[];
  selectedItemId: string;
  resultsCountLabel: string;
  viewMode: ReaderViewMode;
  legalAck: ReaderLegalAck | null;
  surface: ReaderSurfaceFilter;
  regionId: string;
  searchQuery: string;
  provider: string;
  collection: string;
  contentKind: ReaderContentFilter;
  progress: ReaderProgressFilter;
  sort: ReaderSortOption;
  uploadTitle: string;
  uploadContentType: UploadContentType;
  uploadOwnershipBasis: string;
  selectedFiles: File[];
  targetLanguageDraft: string;
  pageViewModeDraft: 'original' | 'translated';
  ttsLanguageModeDraft: 'auto' | 'source' | 'target';
  readingModeDraft: string;
  autoAdvanceDraft: ReaderAutoAdvanceProfile;
  castDraft: Record<string, string>;
  castSpeakers: string[];
  multiSpeakerEnabled: boolean;
  multiSpeakerStatusLabel: string;
  isAutoAssigningCast: boolean;
  isSaving: boolean;
  isUploading: boolean;
  auditModel: ReaderAuditModel;
  onPanelChange: (panel: ReaderPanelSection) => void;
  onToggleCollapsed: () => void;
  onPrimaryAction: () => void;
  onExport: () => void;
  onRefreshLibrary: () => void;
  onSavepoint: () => void;
  onCloseSession: () => void;
  onRefreshSession: () => void;
  onSelectItem: (itemId: string) => void;
  onSetViewMode: (mode: ReaderViewMode) => void;
  onSetSurface: (surface: ReaderSurfaceFilter) => void;
  onSetRegionId: (value: string) => void;
  onSetSearchQuery: (value: string) => void;
  onSetProvider: (value: string) => void;
  onSetCollection: (value: string) => void;
  onSetContentKind: (value: ReaderContentFilter) => void;
  onSetProgress: (value: ReaderProgressFilter) => void;
  onSetSort: (value: ReaderSortOption) => void;
  onSetUploadTitle: (value: string) => void;
  onSetUploadContentType: (value: UploadContentType) => void;
  onSetUploadOwnershipBasis: (value: string) => void;
  onFileSelection: (files: File[]) => void;
  onUpload: () => void;
  onSetTargetLanguageDraft: (value: string) => void;
  onSetPageViewModeDraft: (value: 'original' | 'translated') => void;
  onSetTtsLanguageModeDraft: (value: 'auto' | 'source' | 'target') => void;
  onSetReadingModeDraft: (value: string) => void;
  onSetAutoAdvanceDraft: (value: ReaderAutoAdvanceProfile) => void;
  onCastDraftChange: (next: Record<string, string>) => void;
  onSetMultiSpeakerEnabled: (value: boolean) => void;
  onAutoAssignCast: () => void;
  resolveMediaUrl: (url: string | undefined) => string;
  formatCompactStat: (item: ReaderCatalogItem | null) => string;
  formatProgressLabel: (item: ReaderCatalogItem | null) => string;
}

const SURFACE_OPTIONS: Array<{ value: ReaderSurfaceFilter; label: string }> = [
  { value: 'all', label: 'All Collections' },
  { value: 'books', label: 'Books' },
  { value: 'comics', label: 'Manga & Comics' },
  { value: 'uploads', label: 'Imports' },
];

const AUTO_ADVANCE_OPTIONS: Array<{ value: ReaderAutoAdvanceProfile; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'audio_sync', label: 'Audio Sync' },
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'fast', label: 'Fast' },
];

const renderCover = (item: ReaderCatalogItem, resolveMediaUrl: (url: string | undefined) => string): React.ReactNode => {
  const coverUrl = resolveMediaUrl(item.coverUrl);
  if (coverUrl) {
    return <img src={coverUrl} alt={item.title} className="vf-reader__sheet-cover-image" />;
  }
  return (
    <div className="vf-reader__sheet-cover-image vf-reader__poster-fallback">
      <span>{item.title}</span>
    </div>
  );
};

export const ReaderControlPanel: React.FC<ReaderControlPanelProps> = ({
  activePanel,
  isCollapsed,
  isCollapsible,
  session,
  selectedItem,
  sessionItem,
  currentPrimaryAction,
  library,
  filteredItems,
  selectedItemId,
  resultsCountLabel,
  viewMode,
  legalAck,
  surface,
  regionId,
  searchQuery,
  provider,
  collection,
  contentKind,
  progress,
  sort,
  uploadTitle,
  uploadContentType,
  uploadOwnershipBasis,
  selectedFiles,
  targetLanguageDraft,
  pageViewModeDraft,
  ttsLanguageModeDraft,
  readingModeDraft,
  autoAdvanceDraft,
  castDraft,
  castSpeakers,
  multiSpeakerEnabled,
  multiSpeakerStatusLabel,
  isAutoAssigningCast,
  isSaving,
  isUploading,
  auditModel,
  onPanelChange,
  onToggleCollapsed,
  onPrimaryAction,
  onExport,
  onRefreshLibrary,
  onSavepoint,
  onCloseSession,
  onRefreshSession,
  onSelectItem,
  onSetViewMode,
  onSetSurface,
  onSetRegionId,
  onSetSearchQuery,
  onSetProvider,
  onSetCollection,
  onSetContentKind,
  onSetProgress,
  onSetSort,
  onSetUploadTitle,
  onSetUploadContentType,
  onSetUploadOwnershipBasis,
  onFileSelection,
  onUpload,
  onSetTargetLanguageDraft,
  onSetPageViewModeDraft,
  onSetTtsLanguageModeDraft,
  onSetReadingModeDraft,
  onSetAutoAdvanceDraft,
  onCastDraftChange,
  onSetMultiSpeakerEnabled,
  onAutoAssignCast,
  resolveMediaUrl,
  formatCompactStat,
  formatProgressLabel,
}) => {
  const currentItem = sessionItem || selectedItem;
  const comicControlsVisible = (session?.contentKind || currentItem?.contentKind) === 'comic';
  const activePanelLabel = activePanel === 'library' ? 'Library' : activePanel === 'tools' ? 'Tools' : 'Audit';
  const collapsedSummary = session ? (currentItem?.title || session.title || 'Reader session') : (currentItem?.title || resultsCountLabel);

  const handlePanelSelect = (panel: ReaderPanelSection) => {
    onPanelChange(panel);
    if (isCollapsible && isCollapsed) {
      onToggleCollapsed();
    }
  };

  const renderLibraryPanel = () => (
    <div className="vf-reader__sheet-body" data-testid="reader-library-panel">
      <div className="vf-reader__section-header">
        <div>
          <div className="vf-reader__section-eyebrow">Selected Title</div>
          <h3>{currentItem?.title || 'Choose a title'}</h3>
        </div>
        <div className="vf-reader__toggle-row">
          <button
            type="button"
            className={`vf-reader__icon-toggle ${viewMode === 'grid' ? 'vf-reader__icon-toggle--active' : ''}`}
            onClick={() => onSetViewMode('grid')}
            aria-label="Reader library grid view"
          >
            <Library size={16} />
          </button>
          <button
            type="button"
            className={`vf-reader__icon-toggle ${viewMode === 'list' ? 'vf-reader__icon-toggle--active' : ''}`}
            onClick={() => onSetViewMode('list')}
            aria-label="Reader library list view"
          >
            <FileAudio size={16} />
          </button>
        </div>
      </div>

      {currentItem && (
        <div className="vf-reader__sheet-feature">
          <div className="vf-reader__sheet-cover">{renderCover(currentItem, resolveMediaUrl)}</div>
          <div className="vf-reader__sheet-feature-body">
            <div className="vf-reader__meta-line">
              <span className="vf-reader__pill">{currentItem.collectionLabel || currentItem.provider}</span>
              <span className="vf-reader__pill vf-reader__pill--muted">{currentItem.contentKind}</span>
            </div>
            <p className="vf-reader__sheet-summary">{currentItem.summary || 'Prepared for Reader playback.'}</p>
            <div className="vf-reader__rail-meta">
              <span>{formatCompactStat(currentItem)}</span>
              <span>{formatProgressLabel(currentItem)}</span>
            </div>
            <div className="vf-reader__action-row">
              <button
                type="button"
                className="vf-reader__btn vf-reader__btn--primary"
                onClick={onPrimaryAction}
                disabled={Boolean(currentPrimaryAction?.disabled)}
              >
                {currentPrimaryAction?.label || 'Prepare'}
              </button>
              <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onRefreshSession} disabled={!currentItem}>
                Refresh Session
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="vf-reader__section-header">
        <div>
          <div className="vf-reader__section-eyebrow">Filtered Library</div>
          <h3>{resultsCountLabel}</h3>
        </div>
      </div>

      <div className={viewMode === 'grid' ? 'vf-reader__sheet-results' : 'vf-reader__sheet-results vf-reader__sheet-results--list'}>
        {filteredItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`vf-reader__sheet-item ${selectedItemId === item.id ? 'vf-reader__sheet-item--selected' : ''}`}
            onClick={() => onSelectItem(item.id)}
          >
            <div className="vf-reader__sheet-item-cover">{renderCover(item, resolveMediaUrl)}</div>
            <div className="vf-reader__sheet-item-body">
              <strong>{item.title}</strong>
              <span>{item.author}</span>
              <div className="vf-reader__rail-meta">
                <span>{formatCompactStat(item)}</span>
                <span>{formatProgressLabel(item)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderToolsPanel = () => (
    <div className="vf-reader__sheet-body" data-testid="reader-tools-panel">
      <div className="vf-reader__form-grid">
        <label className="vf-reader__field vf-reader__field--wide">
          <span>Search</span>
          <input
            value={searchQuery}
            onChange={(event) => onSetSearchQuery(event.target.value)}
            className="vf-reader__input"
            placeholder="Search title, author, provider"
          />
        </label>

        <label className="vf-reader__field">
          <span>Surface</span>
          <select value={surface} onChange={(event) => onSetSurface(event.target.value as ReaderSurfaceFilter)} className="vf-reader__select">
            {SURFACE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Region</span>
          <select value={regionId} onChange={(event) => onSetRegionId(event.target.value)} className="vf-reader__select">
            {(library?.regions || []).map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Provider</span>
          <select value={provider} onChange={(event) => onSetProvider(event.target.value)} className="vf-reader__select">
            <option value="all">All providers</option>
            {(library?.facets.providers || []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Collection</span>
          <select value={collection} onChange={(event) => onSetCollection(event.target.value)} className="vf-reader__select">
            <option value="all">All collections</option>
            {(library?.facets.collections || []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Content Type</span>
          <select value={contentKind} onChange={(event) => onSetContentKind(event.target.value as ReaderContentFilter)} className="vf-reader__select">
            <option value="all">Books and comics</option>
            <option value="book">Books / novels</option>
            <option value="comic">Manga / comics</option>
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Progress</span>
          <select value={progress} onChange={(event) => onSetProgress(event.target.value as ReaderProgressFilter)} className="vf-reader__select">
            <option value="all">All states</option>
            <option value="in_progress">Continue reading</option>
            <option value="ready">Playable now</option>
            <option value="new">New to start</option>
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSetSort(event.target.value as ReaderSortOption)} className="vf-reader__select">
            <option value="featured">Featured</option>
            <option value="resume">Resume progress</option>
            <option value="newest">Newest</option>
            <option value="title">Title A-Z</option>
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Target Language</span>
          <select value={targetLanguageDraft} onChange={(event) => onSetTargetLanguageDraft(event.target.value)} className="vf-reader__select vf-theme-select">
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </select>
        </label>

        <label className="vf-reader__field">
          <span>Page View</span>
          <select value={pageViewModeDraft} onChange={(event) => onSetPageViewModeDraft(event.target.value as 'original' | 'translated')} className="vf-reader__select">
            <option value="original">Original</option>
            <option value="translated">Translated</option>
          </select>
        </label>

        <label className="vf-reader__field">
          <span>TTS Language</span>
          <select value={ttsLanguageModeDraft} onChange={(event) => onSetTtsLanguageModeDraft(event.target.value as 'auto' | 'source' | 'target')} className="vf-reader__select">
            <option value="auto">Auto</option>
            <option value="source">Source</option>
            <option value="target">Target</option>
          </select>
        </label>

        {comicControlsVisible && (
          <>
            <label className="vf-reader__field">
              <span>Reading Mode</span>
              <select value={readingModeDraft} onChange={(event) => onSetReadingModeDraft(event.target.value)} className="vf-reader__select">
                <option value="vertical_strip">Vertical strip</option>
                <option value="rtl_paged">Right to left</option>
                <option value="ltr_paged">Left to right</option>
              </select>
            </label>

            <label className="vf-reader__field">
              <span>Auto Swipe</span>
              <select value={autoAdvanceDraft} onChange={(event) => onSetAutoAdvanceDraft(event.target.value as ReaderAutoAdvanceProfile)} className="vf-reader__select">
                {AUTO_ADVANCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <div className="vf-reader__sheet-block">
        <div className="vf-reader__section-eyebrow">Multi-Speaker</div>
        <div className="vf-reader__multi-speaker-bar">
          <div>
            <strong>Studio-style grouped narration</strong>
            <p className="vf-reader__sheet-summary">
              {multiSpeakerEnabled
                ? `${multiSpeakerStatusLabel}. Dialogue chunks use grouped Gemini pairing when they qualify.`
                : 'Single narrator mode only. Cast mapping is disabled until you enable multi-speaker.'}
            </p>
          </div>
          <button
            type="button"
            className={`vf-reader__toggle-switch ${multiSpeakerEnabled ? 'vf-reader__toggle-switch--active' : ''}`}
            onClick={() => onSetMultiSpeakerEnabled(!multiSpeakerEnabled)}
            aria-label="Toggle Reader multi-speaker mode"
          >
            <span className="vf-reader__toggle-switch-thumb" />
          </button>
        </div>

        <div className="vf-reader__section-header">
          <div>
            <div className="vf-reader__section-eyebrow">AI Cast</div>
            <h3>{castSpeakers.length > 0 ? `${castSpeakers.length} speaker${castSpeakers.length === 1 ? '' : 's'}` : 'Narrator only'}</h3>
          </div>
          <button
            type="button"
            className="vf-reader__btn vf-reader__btn--secondary"
            onClick={onAutoAssignCast}
            disabled={!multiSpeakerEnabled || castSpeakers.length === 0 || isAutoAssigningCast}
          >
            {isAutoAssigningCast ? <RefreshCw size={14} className="vf-reader__spin" /> : <Sparkles size={14} />}
            AI Auto
          </button>
        </div>

        {!multiSpeakerEnabled && (
          <p className="vf-reader__sheet-summary">Enable Multi-Speaker Mode to edit cast mappings.</p>
        )}

        <div className={`vf-reader__cast-grid vf-reader__cast-grid--vertical ${multiSpeakerEnabled ? '' : 'vf-reader__cast-grid--disabled'}`}>
          {castSpeakers.map((speaker) => (
            <label key={speaker} className="vf-reader__field">
              <span>{speaker}</span>
              <select
                value={castDraft[speaker] || VOICES[0]?.id || ''}
                onChange={(event) => onCastDraftChange({ ...castDraft, [speaker]: event.target.value })}
                className="vf-reader__select vf-theme-select"
                disabled={!multiSpeakerEnabled}
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
      </div>

      <div className="vf-reader__sheet-block">
        <div className="vf-reader__section-eyebrow">Import</div>
        <div className="vf-reader__form-grid">
          <label className="vf-reader__field vf-reader__field--wide">
            <span>Display Title</span>
            <input value={uploadTitle} onChange={(event) => onSetUploadTitle(event.target.value)} className="vf-reader__input" placeholder="Optional display title" />
          </label>
          <label className="vf-reader__field">
            <span>Content Type</span>
            <select value={uploadContentType} onChange={(event) => onSetUploadContentType(event.target.value as UploadContentType)} className="vf-reader__select">
              <option value="auto">Auto detect</option>
              <option value="book">Book / novel</option>
              <option value="comic">Comic / manga</option>
            </select>
          </label>
          <label className="vf-reader__field">
            <span>Rights Basis</span>
            <select value={uploadOwnershipBasis} onChange={(event) => onSetUploadOwnershipBasis(event.target.value)} className="vf-reader__select">
              <option value="own_work">I created this</option>
              <option value="licensed_permission">I have permission</option>
              <option value="open_source_open_license">It is openly licensed</option>
            </select>
          </label>
        </div>

        <label className="vf-reader__upload-drop">
          <input
            type="file"
            multiple
            accept=".txt,.pdf,.epub,.cbz,.zip,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(event) => onFileSelection(Array.from(event.target.files || []))}
          />
          <UploadCloud size={18} />
          <div>
            <strong>{selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected` : 'Choose files to import'}</strong>
            <p>TXT, PDF, EPUB, comic archives, or image sets.</p>
          </div>
        </label>
        <button
          type="button"
          className="vf-reader__btn vf-reader__btn--primary"
          onClick={onUpload}
          disabled={!legalAck?.accepted || isUploading}
        >
          {isUploading ? 'Importing...' : 'Import to Reader'}
        </button>
      </div>

      <div className="vf-reader__action-row">
        <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onRefreshLibrary}>
          Refresh Library
        </button>
        <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onRefreshSession} disabled={!currentItem}>
          Refresh Session
        </button>
        <button type="button" className="vf-reader__btn vf-reader__btn--secondary" onClick={onExport} disabled={!session}>
          <Download size={14} />
          Export
        </button>
        <button type="button" className="vf-reader__btn vf-reader__btn--primary" onClick={onSavepoint} disabled={!session || isSaving}>
          <Save size={14} />
          {isSaving ? 'Saving...' : 'Savepoint'}
        </button>
        <button type="button" className="vf-reader__btn vf-reader__btn--ghost" onClick={onCloseSession} disabled={!session}>
          <X size={14} />
          Close Session
        </button>
      </div>
    </div>
  );

  const renderAuditPanel = () => (
    <div className="vf-reader__sheet-body" data-testid="reader-audit-panel">
      <div className="vf-reader__section-header">
        <div>
          <div className="vf-reader__section-eyebrow">Audit Overview</div>
          <h3>{auditModel.headline}</h3>
        </div>
      </div>
      <p className="vf-reader__sheet-summary">{auditModel.subhead}</p>

      <div className="vf-reader__metric-grid">
        {auditModel.metrics.map((metric) => (
          <div key={metric.id} className={`vf-reader__metric vf-reader__metric--${metric.tone}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.detail && <small>{metric.detail}</small>}
          </div>
        ))}
      </div>

      {auditModel.alerts.length > 0 && (
        <div className="vf-reader__alert-list">
          {auditModel.alerts.map((alert) => (
            <div key={alert.id} className={`vf-reader__alert vf-reader__alert--${alert.tone}`}>
              <strong>{alert.label}</strong>
              <p>{alert.detail}</p>
            </div>
          ))}
        </div>
      )}

      <div className="vf-reader__audit-rows">
        {auditModel.rows.map((row) => (
          <div key={row.id} className={`vf-reader__audit-row vf-reader__audit-row--${row.tone}`}>
            <div className="vf-reader__audit-row-head">
              <strong>{row.label}</strong>
              <span className="vf-reader__pill vf-reader__pill--muted">{row.status}</span>
            </div>
            <p>{row.summary}</p>
            {(row.detail || row.meta) && (
              <div className="vf-reader__audit-meta">
                {row.detail && <span>{row.detail}</span>}
                {row.meta && <span>{row.meta}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const renderCollapsedRail = () => (
    <div className="vf-reader__panel-mini" data-testid="reader-control-panel-collapsed">
      <div className="vf-reader__panel-mini-badge">{session ? 'Live' : 'Browse'}</div>
      <strong title={collapsedSummary}>{collapsedSummary}</strong>
      <span>{session ? 'Playback controls are pinned here.' : resultsCountLabel}</span>
      <div className="vf-reader__panel-mini-actions">
        <button
          type="button"
          className="vf-reader__icon-toggle"
          onClick={onPrimaryAction}
          disabled={!currentItem || Boolean(currentPrimaryAction?.disabled)}
          aria-label={currentPrimaryAction?.label || 'Prepare selected Reader title'}
        >
          <Sparkles size={16} />
        </button>
        <button
          type="button"
          className="vf-reader__icon-toggle"
          onClick={session ? onRefreshSession : onRefreshLibrary}
          aria-label={session ? 'Refresh Reader session' : 'Refresh Reader library'}
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <section
      className={`vf-reader__section vf-reader__panel-shell${isCollapsed ? ' vf-reader__panel-shell--collapsed' : ''}`}
      data-testid="reader-control-panel"
    >
      <div className="vf-reader__section-header vf-reader__panel-header">
        <div className="vf-reader__panel-heading">
          <div className="vf-reader__section-eyebrow">Reader Controls</div>
          <h3>{activePanelLabel}</h3>
        </div>
        <div className="vf-reader__panel-header-actions">
          <div className="vf-reader__panel-switcher">
            <button
              type="button"
              className={`vf-reader__chip ${activePanel === 'library' ? 'vf-reader__chip--active' : ''}`}
              onClick={() => handlePanelSelect('library')}
              aria-label="Open Reader library panel"
            >
              <Library size={15} />
              <span className="vf-reader__chip-label">Library</span>
            </button>
            <button
              type="button"
              className={`vf-reader__chip ${activePanel === 'tools' ? 'vf-reader__chip--active' : ''}`}
              onClick={() => handlePanelSelect('tools')}
              aria-label="Open Reader tools panel"
            >
              <Settings2 size={15} />
              <span className="vf-reader__chip-label">Tools</span>
            </button>
            <button
              type="button"
              className={`vf-reader__chip ${activePanel === 'audit' ? 'vf-reader__chip--active' : ''}`}
              onClick={() => handlePanelSelect('audit')}
              aria-label="Open Reader audit panel"
            >
              <ShieldCheck size={15} />
              <span className="vf-reader__chip-label">Audit</span>
            </button>
          </div>
          {isCollapsible && (
            <button
              type="button"
              className="vf-reader__icon-toggle vf-reader__panel-collapse-toggle"
              onClick={onToggleCollapsed}
              aria-label={isCollapsed ? 'Expand Reader control panel' : 'Collapse Reader control panel'}
            >
              {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </div>
      </div>

      {isCollapsed && renderCollapsedRail()}

      {!isCollapsed && activePanel === 'library' && renderLibraryPanel()}
      {!isCollapsed && activePanel === 'tools' && renderToolsPanel()}
      {!isCollapsed && activePanel === 'audit' && renderAuditPanel()}
    </section>
  );
};
