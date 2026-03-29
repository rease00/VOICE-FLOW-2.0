import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Loader2, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import type { ReaderOwnershipBasis } from '../../../../types';
import {
  createAdminReaderCatalogItem,
  deleteAdminReaderCatalogItem,
  fetchAdminReaderCatalogItem,
  fetchAdminReaderCatalogItems,
  patchAdminReaderCatalogItem,
  type AdminReaderCatalogItem,
} from '../../../../services/adminService';
import {
  ADMIN_READER_CATALOG_CONTENT_TYPES,
  ADMIN_READER_CATALOG_PUBLISH_STATES,
  createAdminReaderCatalogDraft,
  getAdminReaderCatalogContentTypeLabel,
  getAdminReaderCatalogPublishStateLabel,
  normalizeAdminReaderCatalogDraft,
  resolveAdminReaderCatalogDirectionOverride,
  type AdminReaderCatalogContentType,
  type AdminReaderCatalogDraft,
} from '../model/readerLibrary';

interface AdminReaderLibraryPanelProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  canManage: boolean;
}

const OWNERSHIP_OPTIONS: Array<{ value: ReaderOwnershipBasis; label: string }> = [
  { value: 'licensed', label: 'Licensed' },
  { value: 'own_work', label: 'Own work' },
  { value: 'open_license', label: 'Open license' },
  { value: 'public_domain', label: 'Public domain' },
  { value: 'user_responsible', label: 'User responsible' },
];

const DIRECTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto' },
  { value: 'vertical-scroll', label: 'Vertical scroll' },
  { value: 'manga', label: 'Manga / right-to-left' },
  { value: 'rtl', label: 'Right-to-left' },
  { value: 'ltr', label: 'Left-to-right' },
];

const FILE_HINTS: Record<AdminReaderCatalogContentType, string> = {
  novel: '.txt, .md, .docx, .pdf, .epub',
  manga: '.cbz, .zip, .png, .jpg, .jpeg, .webp, .pdf',
};

const toDraft = (item: AdminReaderCatalogItem): AdminReaderCatalogDraft => normalizeAdminReaderCatalogDraft({
  title: String(item.title || ''),
  author: String(item.author || ''),
  contentType: item.contentKind === 'comic' ? 'manga' : 'novel',
  ownershipBasis: (item.ownershipBasis as ReaderOwnershipBasis) || 'licensed',
  regionId: String(item.regionId || 'english'),
  license: String(item.license || ''),
  summary: String(item.summary || ''),
  collectionLabel: String(item.collectionLabel || 'Reader Library'),
  directionOverride: String(item.direction || ''),
  publishState: String(item.publishState || 'published').toLowerCase() === 'draft' ? 'draft' : 'published',
});

const formatUpdatedAt = (value?: string): string => {
  if (!value) return 'Not yet saved';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not yet saved';
  return parsed.toLocaleString();
};

export const AdminReaderLibraryPanel: React.FC<AdminReaderLibraryPanelProps> = ({
  mediaBackendUrl,
  onToast,
  canManage,
}) => {
  const [items, setItems] = useState<AdminReaderCatalogItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedItem, setSelectedItem] = useState<AdminReaderCatalogItem | null>(null);
  const [draft, setDraft] = useState<AdminReaderCatalogDraft>(() => createAdminReaderCatalogDraft());
  const [files, setFiles] = useState<File[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedItemIdRef = useRef('');
  const isCreatingNewRef = useRef(false);

  const reloadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const payload = await fetchAdminReaderCatalogItems(mediaBackendUrl);
      setItems(payload);
      const currentSelectionId = String(selectedItemIdRef.current || '').trim();
      const currentSelection = currentSelectionId ? payload.find((item) => item.id === currentSelectionId) || null : null;
      const isCreatingNew = isCreatingNewRef.current;
      if (currentSelection) {
        setSelectedItem(currentSelection);
        setDraft(toDraft(currentSelection));
      } else if (!currentSelectionId && payload.length > 0 && !isCreatingNew) {
        const first = payload[0];
        if (first) {
          setSelectedItemId(first.id);
          selectedItemIdRef.current = first.id;
          setSelectedItem(first);
          setDraft(toDraft(first));
        }
      } else if (currentSelectionId && !currentSelection) {
        setSelectedItem(null);
        setDraft(createAdminReaderCatalogDraft());
      }
    } catch (error) {
      onToast(String((error as Error)?.message || 'Failed to load Reader Library items.'), 'error');
    } finally {
      setIsLoading(false);
    }
  }, [mediaBackendUrl, onToast]);

  const loadSelectedItem = useCallback(async (itemId: string) => {
    const safeItemId = String(itemId || '').trim();
    if (!safeItemId) return;
    try {
      const item = await fetchAdminReaderCatalogItem(safeItemId, mediaBackendUrl);
      isCreatingNewRef.current = false;
      setSelectedItemId(safeItemId);
      selectedItemIdRef.current = safeItemId;
      setSelectedItem(item);
      setDraft(toDraft(item));
      setFiles([]);
    } catch (error) {
      onToast(String((error as Error)?.message || 'Failed to load Reader Library item.'), 'error');
    }
  }, [mediaBackendUrl, onToast]);

  useEffect(() => {
    void reloadItems();
  }, [reloadItems]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.author,
        item.regionId,
        item.license,
        item.collectionLabel,
        item.publishState,
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }, [items, searchTerm]);

  const counts = useMemo(() => {
    const published = items.filter((item) => String(item.publishState || 'published').toLowerCase() !== 'draft').length;
    const drafts = items.length - published;
    return { published, drafts, total: items.length };
  }, [items]);

  const activeDirection = draft.directionOverride || resolveAdminReaderCatalogDirectionOverride(draft.contentType, draft.directionOverride);
  const isEditingExisting = Boolean(selectedItemId);
  const acceptedFileHint = FILE_HINTS[draft.contentType];

  const handleContentTypeChange = (nextType: AdminReaderCatalogContentType) => {
    setDraft((current) => normalizeAdminReaderCatalogDraft({
      ...current,
      contentType: nextType,
      directionOverride: resolveAdminReaderCatalogDirectionOverride(nextType, current.directionOverride),
    }));
  };

  const handleResetForm = () => {
    isCreatingNewRef.current = true;
    setSelectedItemId('');
    selectedItemIdRef.current = '';
    setSelectedItem(null);
    setFiles([]);
    setDraft(createAdminReaderCatalogDraft());
  };

  const handleSave = async () => {
    if (!canManage) {
      onToast('Unlock admin mutation access to publish Reader content.', 'info');
      return;
    }
    const nextDraft = normalizeAdminReaderCatalogDraft(draft);
    if (!String(nextDraft.title || '').trim()) {
      onToast('Title is required.', 'info');
      return;
    }
    if (!String(nextDraft.author || '').trim()) {
      onToast('Author is required.', 'info');
      return;
    }
    if (!isEditingExisting && files.length === 0) {
      onToast('Add at least one file before publishing.', 'info');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditingExisting) {
        const updated = await patchAdminReaderCatalogItem(selectedItemId, {
          title: nextDraft.title,
          author: nextDraft.author,
          regionId: nextDraft.regionId,
          license: nextDraft.license,
          ownershipBasis: nextDraft.ownershipBasis,
          direction: activeDirection,
          summary: nextDraft.summary,
          collectionLabel: nextDraft.collectionLabel,
          publishState: nextDraft.publishState,
        }, mediaBackendUrl);
        setSelectedItem(updated);
        setItems((current) => {
          const remaining = current.filter((item) => item.id !== updated.id);
          return [updated, ...remaining];
        });
        selectedItemIdRef.current = updated.id;
        setDraft(toDraft(updated));
        isCreatingNewRef.current = false;
        onToast(`Updated "${updated.title}".`, 'success');
      } else {
        const created = await createAdminReaderCatalogItem({
          files,
          title: nextDraft.title,
          author: nextDraft.author,
          contentType: nextDraft.contentType,
          ownershipBasis: nextDraft.ownershipBasis,
          regionId: nextDraft.regionId,
          license: nextDraft.license,
          summary: nextDraft.summary,
          collectionLabel: nextDraft.collectionLabel,
          directionOverride: activeDirection,
          publishState: nextDraft.publishState,
        }, mediaBackendUrl);
        isCreatingNewRef.current = false;
        setSelectedItemId(created.id);
        selectedItemIdRef.current = created.id;
        setSelectedItem(created);
        setItems((current) => {
          const remaining = current.filter((item) => item.id !== created.id);
          return [created, ...remaining];
        });
        setDraft(toDraft(created));
        setFiles([]);
        onToast(`${getAdminReaderCatalogPublishStateLabel(created.publishState === 'draft' ? 'draft' : 'published')} "${created.title}" in Reader Library.`, 'success');
      }
      await reloadItems();
    } catch (error) {
      onToast(String((error as Error)?.message || 'Failed to save Reader Library item.'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canManage || !selectedItemId) return;
    if (!window.confirm(`Delete "${selectedItem?.title || 'this title'}" from Reader Library?`)) return;
    setIsDeleting(true);
    try {
      await deleteAdminReaderCatalogItem(selectedItemId, mediaBackendUrl);
      onToast('Reader Library item deleted.', 'success');
      setItems((current) => current.filter((item) => item.id !== selectedItemId));
      handleResetForm();
      await reloadItems();
    } catch (error) {
      onToast(String((error as Error)?.message || 'Failed to delete Reader Library item.'), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <BookOpen size={16} className="text-indigo-600" />
          Reader Library
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
            Published: {counts.published.toLocaleString()}
          </span>
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-700">
            Drafts: {counts.drafts.toLocaleString()}
          </span>
          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600">
            Total: {counts.total.toLocaleString()}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Publish novels and manga to the shared Reader catalog. Published titles appear for every Reader user after the next catalog refresh.
      </p>

      {!canManage ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          Unlock admin mutation access to create, publish, edit, or delete Reader Library items.
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(18rem,22rem)_1fr]">
        <aside className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-gray-700">Catalog</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void reloadItems(); }}
                className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700"
              >
                <RefreshCw size={12} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleResetForm}
                className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700"
              >
                <Plus size={12} />
                New title
              </button>
            </div>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Search catalog</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search title, author, region, state..."
              className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
            />
          </label>

          <div className="mt-3 space-y-2">
            {isLoading ? (
              <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                <Loader2 size={13} className="animate-spin" />
                Loading catalog...
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-xs text-gray-500">
                No Reader Library items found.
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = item.id === selectedItemId;
                const publishState = String(item.publishState || 'published').toLowerCase() === 'draft' ? 'draft' : 'published';
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { void loadSelectedItem(item.id); }}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-800">{item.title}</div>
                        <div className="truncate text-[11px] text-gray-500">{item.author}</div>
                      </div>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        publishState === 'draft' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      }`}>
                        {getAdminReaderCatalogPublishStateLabel(publishState)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5">{getAdminReaderCatalogContentTypeLabel(item.contentKind === 'comic' ? 'manga' : 'novel')}</span>
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5">{item.regionId || 'english'}</span>
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5">{item.collectionLabel || 'Reader Library'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-gray-700">
                {isEditingExisting ? 'Edit Reader Library item' : 'Create Reader Library item'}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {isEditingExisting
                  ? 'Update metadata or switch publish state. File replacement is intentionally not part of v1.'
                  : 'Upload local files, then publish or keep the title as a draft.'}
              </p>
            </div>
            {selectedItem ? (
              <div className="text-right text-[10px] text-gray-500">
                <div>Updated {formatUpdatedAt(selectedItem.updatedAt)}</div>
                <div>Published {formatUpdatedAt(selectedItem.publishedAt)}</div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Title</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Reader title"
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Author</span>
              <input
                value={draft.author}
                onChange={(event) => setDraft((current) => ({ ...current, author: event.target.value }))}
                placeholder="Author name"
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Content Type</span>
              <select
                value={draft.contentType}
                onChange={(event) => handleContentTypeChange(event.target.value === 'manga' ? 'manga' : 'novel')}
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              >
                {ADMIN_READER_CATALOG_CONTENT_TYPES.map((contentType) => (
                  <option key={contentType} value={contentType}>
                    {getAdminReaderCatalogContentTypeLabel(contentType)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Publish State</span>
              <select
                value={draft.publishState}
                onChange={(event) => setDraft((current) => normalizeAdminReaderCatalogDraft({
                  ...current,
                  publishState: event.target.value === 'draft' ? 'draft' : 'published',
                }))}
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              >
                {ADMIN_READER_CATALOG_PUBLISH_STATES.map((state) => (
                  <option key={state} value={state}>
                    {getAdminReaderCatalogPublishStateLabel(state)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Region</span>
              <input
                value={draft.regionId}
                onChange={(event) => setDraft((current) => ({ ...current, regionId: event.target.value }))}
                placeholder="english"
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Rights basis</span>
              <select
                value={draft.ownershipBasis}
                onChange={(event) => setDraft((current) => ({ ...current, ownershipBasis: event.target.value as ReaderOwnershipBasis }))}
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              >
                {OWNERSHIP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 md:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">License</span>
              <input
                value={draft.license}
                onChange={(event) => setDraft((current) => ({ ...current, license: event.target.value }))}
                placeholder="public-domain, CC BY 4.0, licensed..."
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Collection</span>
              <input
                value={draft.collectionLabel}
                onChange={(event) => setDraft((current) => ({ ...current, collectionLabel: event.target.value }))}
                placeholder="Reader Library"
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Direction</span>
              <select
                value={activeDirection}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  directionOverride: event.target.value,
                }))}
                disabled={!canManage}
                className="h-9 rounded-lg border border-gray-200 px-2 text-xs disabled:bg-gray-100"
              >
                {DIRECTION_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 md:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Summary</span>
              <textarea
                value={draft.summary}
                onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
                placeholder="Short description for Reader cards and previews."
                disabled={!canManage}
                className="min-h-28 rounded-lg border border-gray-200 px-2 py-2 text-xs disabled:bg-gray-100"
              />
            </label>
            {!isEditingExisting ? (
              <label className="grid gap-1 md:col-span-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Files</span>
                <input
                  type="file"
                  multiple
                  accept={draft.contentType === 'manga' ? '.cbz,.zip,.png,.jpg,.jpeg,.webp,.pdf' : '.txt,.md,.docx,.pdf,.epub'}
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                  disabled={!canManage}
                  className="block w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-indigo-700 disabled:bg-gray-100"
                />
                <span className="text-[11px] text-gray-500">
                  Accepted for {getAdminReaderCatalogContentTypeLabel(draft.contentType)}: {acceptedFileHint}
                </span>
                {files.length > 0 ? (
                  <span className="text-[11px] text-gray-600">
                    Selected {files.length.toLocaleString()} file{files.length === 1 ? '' : 's'}.
                  </span>
                ) : null}
              </label>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-white p-3 text-[11px] text-gray-500 md:col-span-2">
                File replacement is not part of v1. Publish a new entry if you need to upload a different asset bundle.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={!canManage || isSaving}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 disabled:opacity-60"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {isEditingExisting ? 'Save changes' : 'Publish to Reader'}
            </button>
            {isEditingExisting ? (
              <button
                type="button"
                onClick={() => { void handleDelete(); }}
                disabled={!canManage || isDeleting}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-60"
              >
                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleResetForm}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700"
            >
              <Upload size={13} />
              Reset form
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-gray-100 bg-white p-3 text-[11px] text-gray-600">
            <div className="flex flex-wrap gap-2">
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">Direction: {activeDirection || 'Auto'}</span>
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">File mode: {acceptedFileHint}</span>
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1">Publish: {getAdminReaderCatalogPublishStateLabel(draft.publishState)}</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};
