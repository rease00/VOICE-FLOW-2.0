import React, { Suspense, lazy, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Edit2,
  LibraryBig,
  Loader2,
  Lock,
  Mic2,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { Button } from '../../../components/Button';
import { SectionCard } from '../../../components/SectionCard';
import { useManagedTabs } from '../../shared/ui/tabs';
import type { CharacterProfile, GenerationSettings, VoiceOption, WorkspaceLayoutMode } from '../../../types';
import {
  deriveVoicesInspectorPriority,
  resolveVoicesSelectionId,
  type VoicesWorkspaceMode,
  type VoicesWorkspaceViewState,
} from './model/workspace';

const VoiceCloningTabContent = lazy(async () =>
  import('../voice-cloning/VoiceCloningTabContent').then((module) => ({ default: module.VoiceCloningTabContent }))
);

type PreviewState = { id: string; status: 'loading' | 'playing' } | null;
type ToastTone = 'success' | 'error' | 'info';

interface VoicesWorkspaceProps {
  layoutMode: WorkspaceLayoutMode;
  backendBaseUrl?: string;
  selectedEngine: GenerationSettings['engine'];
  characterLibrary: CharacterProfile[];
  clonedVoices: VoiceOption[];
  galleryVoicePool: VoiceOption[];
  previewState: PreviewState;
  createCharacterDraft: (presetVoiceId?: string) => CharacterProfile;
  onPreviewCharacter: (character: CharacterProfile) => Promise<void>;
  onPreviewVoice: (voiceId: string, name: string) => Promise<void>;
  onSaveCharacter: (character: CharacterProfile, isEditing: boolean) => void;
  onDeleteCharacter: (id: string) => void;
  onToast: (message: string, tone: ToastTone) => void;
  onRequireUpgrade: () => void;
  resolveVoiceDisplayLabel: (voice: VoiceOption) => string;
  resolveVoiceDisplayMeta: (voice: VoiceOption) => { name: string; countryTag: string };
  resolveVoicePersonaLabel: (voice: VoiceOption) => string;
  resolveVoiceAccessTier: (engine: GenerationSettings['engine'], voice: VoiceOption) => 'free' | 'pro';
  resolveVoiceCountry: (voice: VoiceOption) => string;
  isVoiceLockedForFreeTier: (engine: GenerationSettings['engine'], voice: VoiceOption) => boolean;
}

interface ModeItem {
  id: VoicesWorkspaceMode;
  label: string;
  detail: string;
  icon: React.ReactNode;
}

const MODE_ITEMS: ModeItem[] = [
  {
    id: 'library',
    label: 'Library',
    detail: 'Catalog',
    icon: <LibraryBig size={16} />,
  },
  {
    id: 'clone',
    label: 'Clone',
    detail: 'Voices',
    icon: <Mic2 size={16} />,
  },
];

const randomColorFallbacks = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#d946ef',
  '#f43f5e',
];

const getPreviewStatus = (previewState: PreviewState, id: string): 'idle' | 'loading' | 'playing' => {
  if (previewState?.id !== id) return 'idle';
  return previewState.status;
};

const handleSelectableSurfaceKeyDown = (
  event: React.KeyboardEvent<HTMLElement>,
  onSelect: () => void
) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onSelect();
};

const createFallbackDraft = (): CharacterProfile => ({
  id: Date.now().toString(),
  name: '',
  voiceId: '',
  gender: 'Unknown',
  age: 'Adult',
  avatarColor: randomColorFallbacks[Math.floor(Math.random() * randomColorFallbacks.length)] || '#6366f1',
});

export function VoicesWorkspace({
  layoutMode,
  backendBaseUrl,
  selectedEngine,
  characterLibrary,
  clonedVoices,
  galleryVoicePool,
  previewState,
  createCharacterDraft,
  onPreviewCharacter,
  onPreviewVoice,
  onSaveCharacter,
  onDeleteCharacter,
  onToast,
  onRequireUpgrade,
  resolveVoiceDisplayLabel,
  resolveVoiceDisplayMeta,
  resolveVoicePersonaLabel,
  resolveVoiceAccessTier,
  resolveVoiceCountry,
  isVoiceLockedForFreeTier,
}: VoicesWorkspaceProps) {
  const isDesktop = layoutMode === 'desktop';

  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceFilterGender, setVoiceFilterGender] = useState<'All' | 'Male' | 'Female'>('All');
  const [voiceFilterAccent, setVoiceFilterAccent] = useState<string>('All');
  const deferredVoiceSearch = useDeferredValue(voiceSearch);

  const [viewState, setViewState] = useState<VoicesWorkspaceViewState>(() => ({
    mode: 'library',
    selectedCharacterId: characterLibrary[0]?.id || '',
    selectedVoiceId: galleryVoicePool[0]?.id || '',
    inspectorPriority: 'voice',
    diagnosticsExpanded: false,
  }));

  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState('');
  const [characterDraft, setCharacterDraft] = useState<CharacterProfile>(() => createCharacterDraft() || createFallbackDraft());

  const selectedCharacter = useMemo(
    () => characterLibrary.find((character) => character.id === viewState.selectedCharacterId) || null,
    [characterLibrary, viewState.selectedCharacterId]
  );

  const selectedVoice = useMemo(
    () => galleryVoicePool.find((voice) => voice.id === viewState.selectedVoiceId) || null,
    [galleryVoicePool, viewState.selectedVoiceId]
  );

  const modeTabs = useManagedTabs({
    items: MODE_ITEMS.map((item) => ({ id: item.id })),
    activeId: viewState.mode,
    onChange: (nextMode) => {
      setViewState((current) => {
        const nextDiagnosticsExpanded = nextMode === 'clone' ? current.diagnosticsExpanded : false;
        return {
          ...current,
          mode: nextMode,
          diagnosticsExpanded: nextDiagnosticsExpanded,
          inspectorPriority: deriveVoicesInspectorPriority({
            mode: nextMode,
            hasSelectedCharacter: Boolean(current.selectedCharacterId),
            hasSelectedVoice: Boolean(current.selectedVoiceId),
            hasCloneResult: false,
            hasStemResult: false,
            diagnosticsExpanded: nextDiagnosticsExpanded,
          }),
        };
      });
    },
    label: 'Voices workspace mode',
    orientation: isDesktop ? 'vertical' : 'horizontal',
    idBase: 'voices-workspace',
  });

  useEffect(() => {
    const nextCharacterIds = characterLibrary.map((character) => character.id);
    const nextVoiceIds = galleryVoicePool.map((voice) => voice.id);
    setViewState((current) => {
      const nextCharacterId = resolveVoicesSelectionId(current.selectedCharacterId, nextCharacterIds);
      const nextVoiceId = resolveVoicesSelectionId(current.selectedVoiceId, nextVoiceIds);
      if (nextCharacterId === current.selectedCharacterId && nextVoiceId === current.selectedVoiceId) {
        return current;
      }
      return {
        ...current,
        selectedCharacterId: nextCharacterId,
        selectedVoiceId: nextVoiceId,
      };
    });
  }, [characterLibrary, galleryVoicePool]);

  const filteredVoices = useMemo(() => {
    const normalizedSearch = deferredVoiceSearch.trim().toLowerCase();
    return galleryVoicePool.filter((voice) => {
      const searchable = [voice.name, voice.accent, resolveVoiceCountry(voice), voice.engine || ''].join(' ').toLowerCase();
      const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
      const matchesGender = voiceFilterGender === 'All' || voice.gender === voiceFilterGender;
      const matchesAccent = voiceFilterAccent === 'All' || resolveVoiceCountry(voice) === voiceFilterAccent;
      return matchesSearch && matchesGender && matchesAccent;
    });
  }, [deferredVoiceSearch, galleryVoicePool, resolveVoiceCountry, voiceFilterAccent, voiceFilterGender]);

  const uniqueAccents = useMemo(
    () => Array.from(new Set(galleryVoicePool.map((voice) => resolveVoiceCountry(voice)))).sort(),
    [galleryVoicePool, resolveVoiceCountry]
  );

  useEffect(() => {
    if (viewState.mode !== 'library') return;
    const nextVoiceId = resolveVoicesSelectionId(viewState.selectedVoiceId, filteredVoices.map((voice) => voice.id));
    if (nextVoiceId === viewState.selectedVoiceId) return;
    setViewState((current) => ({ ...current, selectedVoiceId: nextVoiceId }));
  }, [filteredVoices, viewState.mode, viewState.selectedVoiceId]);

  useEffect(() => {
    setViewState((current) => {
      const nextInspectorPriority = deriveVoicesInspectorPriority({
        mode: current.mode,
        hasSelectedCharacter: Boolean(selectedCharacter),
        hasSelectedVoice: Boolean(selectedVoice),
        hasCloneResult: false,
        hasStemResult: false,
        diagnosticsExpanded: current.diagnosticsExpanded,
      });
      if (nextInspectorPriority === current.inspectorPriority) return current;
      return {
        ...current,
        inspectorPriority: nextInspectorPriority,
      };
    });
  }, [selectedCharacter, selectedVoice]);

  const openCharacterModal = (character?: CharacterProfile, presetVoiceId?: string) => {
    if (character) {
      setEditingCharacterId(character.id);
      setCharacterDraft({ ...character });
      setViewState((current) => ({ ...current, selectedCharacterId: character.id, inspectorPriority: 'character' }));
    } else {
      setEditingCharacterId('');
      const draft = createCharacterDraft(presetVoiceId) || createFallbackDraft();
      setCharacterDraft({
        ...draft,
        avatarColor: draft.avatarColor || randomColorFallbacks[Math.floor(Math.random() * randomColorFallbacks.length)] || '#6366f1',
      });
    }
    setCharacterModalOpen(true);
  };

  const saveCharacter = () => {
    if (!String(characterDraft.name || '').trim()) {
      onToast('Character Name required', 'error');
      return;
    }
    const isEditing = Boolean(editingCharacterId);
    onSaveCharacter(characterDraft, isEditing);
    setCharacterModalOpen(false);
    setViewState((current) => ({ ...current, selectedCharacterId: characterDraft.id, inspectorPriority: 'character' }));
  };

  const deleteCharacter = (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this character?')) {
      return;
    }
    onDeleteCharacter(id);
    onToast('Character Deleted', 'info');
  };

  const renderLibraryPanel = () => {
    const selectedCharacterPreviewStatus = selectedCharacter
      ? getPreviewStatus(previewState, selectedCharacter.voiceId)
      : 'idle';

    return (
    <section className="vf-voices-surface vf-voices-stage-surface">
      <div className="vf-voices-section-header">
        <div>
          <p className="vf-voices-kicker">Library</p>
          <h3 className="vf-voices-section-title">Voices</h3>
        </div>
        <div className="vf-voices-status-strip vf-voices-status-strip--compact">
          <span className="vf-voices-chip">{filteredVoices.length} shown</span>
          <span className="vf-voices-chip">{galleryVoicePool.length} total</span>
        </div>
      </div>
      <div className="vf-voices-panel-shell">
        <div className="vf-voices-inline-actions vf-voices-inline-actions--library-controls">
          <Button
            type="button"
            icon={<Plus size={14} />}
            onClick={() => openCharacterModal()}
            aria-label="Add character"
          >
            {isDesktop ? 'Add Character' : 'Add'}
          </Button>
          {selectedCharacter ? (
            <>
              <button
                type="button"
                className="vf-voices-subtle-btn"
                onClick={() => { void onPreviewCharacter(selectedCharacter); }}
                aria-label={selectedCharacterPreviewStatus === 'playing' ? 'Pause character preview' : 'Preview character'}
              >
                {selectedCharacterPreviewStatus === 'loading' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : selectedCharacterPreviewStatus === 'playing' ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}
                {selectedCharacterPreviewStatus === 'playing' ? 'Pause' : isDesktop ? 'Preview Character' : 'Preview'}
              </button>
              <button
                type="button"
                className="vf-voices-subtle-btn"
                onClick={() => openCharacterModal(selectedCharacter)}
                aria-label="Edit character"
              >
                <Edit2 size={14} />
                {isDesktop ? 'Edit Character' : 'Edit'}
              </button>
              <button
                type="button"
                className="vf-voices-subtle-btn vf-voices-subtle-btn--warn"
                onClick={() => deleteCharacter(selectedCharacter.id)}
                aria-label="Delete character"
              >
                <Trash2 size={14} />
                {isDesktop ? 'Delete Character' : 'Delete'}
              </button>
            </>
          ) : null}
        </div>

        <div className="vf-voices-toolbar">
          <label className="vf-voices-search">
            <Search size={15} />
            <input
              value={voiceSearch}
              onChange={(event) => {
                const nextValue = event.target.value;
                startTransition(() => {
                  setVoiceSearch(nextValue);
                });
              }}
              placeholder="Search voices"
            />
          </label>
          <div className="vf-voices-filter-row">
            <select value={voiceFilterGender} onChange={(event) => setVoiceFilterGender(event.target.value as 'All' | 'Male' | 'Female')}>
              <option value="All">All genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
            <select value={voiceFilterAccent} onChange={(event) => setVoiceFilterAccent(event.target.value)}>
              <option value="All">All countries</option>
              {uniqueAccents.map((accent) => (
                <option key={accent} value={accent}>
                  {accent}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="vf-voices-panel-scroll">
          {filteredVoices.length <= 0 ? (
            <div className="vf-voices-empty-state">
              <Search size={18} />
              <div>
                <h4>No matches</h4>
                <p>Try fewer filters.</p>
              </div>
            </div>
          ) : (
            <div className="vf-voices-library-grid">
              {filteredVoices.map((voice) => {
                const voiceEngine = (voice.engine || selectedEngine) as GenerationSettings['engine'];
                const meta = resolveVoiceDisplayMeta(voice);
                const previewStatus = getPreviewStatus(previewState, voice.id);
                const accessTier = resolveVoiceAccessTier(voiceEngine, voice);
                const isLocked = isVoiceLockedForFreeTier(voiceEngine, voice);
                const isSelected = voice.id === viewState.selectedVoiceId;

                return (
                  <article
                    key={voice.id}
                    className={`vf-voices-library-card ${isSelected ? 'vf-voices-library-card--active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setViewState((current) => ({ ...current, selectedVoiceId: voice.id, inspectorPriority: 'voice' }))}
                    onKeyDown={(event) =>
                      handleSelectableSurfaceKeyDown(event, () =>
                        setViewState((current) => ({ ...current, selectedVoiceId: voice.id, inspectorPriority: 'voice' }))
                      )
                    }
                  >
                    <span className="vf-voices-library-header">
                      <span className={`vf-voices-voice-dot vf-voices-voice-dot--${String(voice.gender || 'Unknown').toLowerCase()}`}>
                        {meta.name[0] || 'V'}
                      </span>
                      <span className="vf-voices-row-copy">
                        <span className="vf-voices-row-title">
                          {meta.name}
                          {meta.countryTag ? <span className="vf-voices-country-tag">{meta.countryTag}</span> : null}
                        </span>
                        <span className="vf-voices-row-meta">{resolveVoicePersonaLabel(voice)}</span>
                      </span>
                      <span className={`vf-voices-chip ${accessTier === 'pro' ? 'vf-voices-chip--warn' : 'vf-voices-chip--accent'}`}>{accessTier}</span>
                    </span>
                    <span className="vf-voices-library-footer">
                      <span className="vf-voices-row-meta">{resolveVoiceCountry(voice)}</span>
                      <span className="vf-voices-row-actions">
                        <button
                          type="button"
                          className="vf-voices-icon-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onPreviewVoice(voice.id, voice.name);
                          }}
                          aria-label={`Preview ${voice.name}`}
                        >
                          {previewStatus === 'loading' ? <Loader2 size={15} className="animate-spin" /> : previewStatus === 'playing' ? <Pause size={15} /> : <Play size={15} />}
                        </button>
                        <button
                          type="button"
                          className={`vf-voices-subtle-btn ${isLocked ? 'vf-voices-subtle-btn--warn' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isLocked) {
                              onRequireUpgrade();
                              return;
                            }
                            openCharacterModal(undefined, voice.id);
                          }}
                          aria-label={isLocked ? `Upgrade to use ${voice.name}` : `Create character using ${voice.name}`}
                        >
                          {isLocked ? <Lock size={14} /> : <Plus size={14} />}
                          {isLocked ? (isDesktop ? 'Upgrade' : 'Pro') : isDesktop ? 'Create character' : 'Create'}
                        </button>
                      </span>
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
    );
  };

  return (
    <div className="vf-voices-workspace" data-voices-layout={isDesktop ? 'desktop' : 'stacked'} data-testid="voices-workspace">
      {isDesktop ? (
        <div className="vf-voices-header">
          <div className="vf-voices-status-strip vf-voices-status-strip--workspace">
            <span className="vf-voices-chip vf-voices-chip--accent">{characterLibrary.length} cast</span>
            <span className="vf-voices-chip">{galleryVoicePool.length} voices</span>
            <span className="vf-voices-chip">{clonedVoices.length} clones</span>
            <span className="vf-voices-chip">{selectedEngine}</span>
          </div>
        </div>
      ) : null}

      <div className={`vf-voices-shell ${isDesktop ? 'vf-voices-shell--desktop' : ''}`}>
        <aside className={`vf-voices-mode-rail ${isDesktop ? 'vf-voices-mode-rail--desktop' : ''}`}>
          <div className="vf-voices-mode-list" {...modeTabs.listProps}>
            {MODE_ITEMS.map((item) => {
              const isActive = item.id === viewState.mode;
              return (
                <button
                  key={item.id}
                  type="button"
                  {...modeTabs.getTabProps(item.id)}
                  className={`vf-voices-mode-btn ${isActive ? 'vf-voices-mode-btn--active' : ''}`}
                >
                  <span className="vf-voices-mode-icon">{item.icon}</span>
                  <span className="vf-voices-mode-copy">
                    <span className="vf-voices-mode-label">{item.label}</span>
                    <span className="vf-voices-mode-detail">{item.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="vf-voices-stage">
          {viewState.mode === 'clone' ? (
            <Suspense fallback={<SectionCard className="rounded-3xl p-6 text-sm">Loading voice cloning workspace...</SectionCard>}>
              <VoiceCloningTabContent
                backendBaseUrl={backendBaseUrl}
                selectedEngine={selectedEngine}
                layout={isDesktop ? 'workspace' : 'stacked'}
                showRail={false}
                diagnosticsExpanded={viewState.diagnosticsExpanded}
                onDiagnosticsExpandedChange={(expanded) =>
                  setViewState((current) => ({
                    ...current,
                    diagnosticsExpanded: expanded,
                    inspectorPriority: deriveVoicesInspectorPriority({
                      mode: current.mode,
                      hasSelectedCharacter: Boolean(selectedCharacter),
                      hasSelectedVoice: Boolean(selectedVoice),
                      hasCloneResult: false,
                      hasStemResult: false,
                      diagnosticsExpanded: expanded,
                    }),
                  }))
                }
              />
            </Suspense>
          ) : (
            <div className="vf-voices-stage-main">{renderLibraryPanel()}</div>
          )}
        </div>
      </div>

      {characterModalOpen ? (
        <div className="vf-scrim vf-scrim--modal fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="vf-voices-modal">
            <div className="vf-voices-modal-header">
              <div>
                <h3 className="vf-voices-section-title">{editingCharacterId ? 'Edit character' : 'New character'}</h3>
              </div>
              <button type="button" className="vf-voices-icon-btn" onClick={() => setCharacterModalOpen(false)} aria-label="Close character editor">
                <span aria-hidden>x</span>
              </button>
            </div>

            <div className="vf-voices-modal-body">
              <div className="vf-voices-modal-identity">
                <label className="vf-voices-color-chip" style={{ backgroundColor: characterDraft.avatarColor || '#6366f1' }}>
                  <span>{characterDraft.name ? characterDraft.name.substring(0, 2).toUpperCase() : '?'}</span>
                  <input type="color" value={characterDraft.avatarColor || '#6366f1'} onChange={(event) => setCharacterDraft({ ...characterDraft, avatarColor: event.target.value })} />
                </label>
                <label className="vf-voices-field">
                  <span>Name</span>
                  <input value={characterDraft.name} onChange={(event) => setCharacterDraft({ ...characterDraft, name: event.target.value })} placeholder="Narrator, Hero, Host" />
                </label>
              </div>

              <div className="vf-voices-field-grid">
                <label className="vf-voices-field">
                  <span>Gender</span>
                  <select
                    value={characterDraft.gender}
                    onChange={(event) =>
                      setCharacterDraft((current) => ({
                        ...current,
                        gender: event.target.value as NonNullable<CharacterProfile['gender']>,
                      }))
                    }
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Unknown">Non-Binary / Other</option>
                  </select>
                </label>
                <label className="vf-voices-field">
                  <span>Age Group</span>
                  <select value={characterDraft.age} onChange={(event) => setCharacterDraft({ ...characterDraft, age: event.target.value })}>
                    <option value="Child">Child</option>
                    <option value="Young Adult">Young Adult</option>
                    <option value="Adult">Adult</option>
                    <option value="Elderly">Elderly</option>
                  </select>
                </label>
              </div>

              <label className="vf-voices-field">
                <span>Voice</span>
                <select value={characterDraft.voiceId} onChange={(event) => setCharacterDraft({ ...characterDraft, voiceId: event.target.value })}>
                  <optgroup label="Free Speakers">
                    {galleryVoicePool
                      .filter((voice) => resolveVoiceAccessTier((voice.engine || selectedEngine) as GenerationSettings['engine'], voice) === 'free')
                      .map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {`${resolveVoiceDisplayLabel(voice)} (${resolveVoicePersonaLabel(voice)})`}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Pro Speakers">
                    {galleryVoicePool
                      .filter((voice) => resolveVoiceAccessTier((voice.engine || selectedEngine) as GenerationSettings['engine'], voice) === 'pro')
                      .map((voice) => (
                        <option key={voice.id} value={voice.id} disabled={isVoiceLockedForFreeTier((voice.engine || selectedEngine) as GenerationSettings['engine'], voice)}>
                          {`${resolveVoiceDisplayLabel(voice)} (${resolveVoicePersonaLabel(voice)}) - Pro`}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>

              <div className="vf-voices-inline-actions">
                <button type="button" className="vf-voices-subtle-btn" onClick={() => setCharacterModalOpen(false)}>
                  Cancel
                </button>
                <Button type="button" icon={<Plus size={14} />} onClick={saveCharacter}>
                  {editingCharacterId ? 'Save Changes' : 'Create Character'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
