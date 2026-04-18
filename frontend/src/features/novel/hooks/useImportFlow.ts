import { useCallback, useState } from 'react';
import type { NovelImportChapterPreview, NovelImportExtractDiagnostics } from '../../../../types';
import { extractNovelTextFromFile, splitImportedTextToChapters } from '../../../../services/novelImportService';
import { useNovelEditor, createLocalId, type LocalNovelChapter } from '../contexts/NovelEditorContext';

export type EditableImportChapter = NovelImportChapterPreview & {
  id: string;
  selected: boolean;
  titleEdited: boolean;
};

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

export const useImportFlow = (onToast: ToastFn) => {
  const { selectedProjectId, setChaptersByProjectId, chapters } = useNovelEditor();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [extractDiagnostics, setExtractDiagnostics] = useState<NovelImportExtractDiagnostics | null>(null);
  const [splitWarnings, setSplitWarnings] = useState<string[]>([]);
  const [editableChapters, setEditableChapters] = useState<EditableImportChapter[]>([]);
  const [importStep, setImportStep] = useState<'files' | 'split' | 'confirm'>('files');

  const openImportModal = useCallback(() => {
    setImportFiles([]);
    setEditableChapters([]);
    setExtractDiagnostics(null);
    setSplitWarnings([]);
    setImportStep('files');
    setIsImportModalOpen(true);
  }, []);

  const closeImportModal = useCallback(() => {
    setIsImportModalOpen(false);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    setImportFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      const unique = files.filter((f) => !names.has(f.name));
      return [...prev, ...unique];
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setImportFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const extractAndSplit = useCallback(async () => {
    if (importFiles.length === 0) {
      onToast('No files selected', 'info');
      return;
    }
    setIsExtracting(true);
    setEditableChapters([]);
    setSplitWarnings([]);
    setExtractDiagnostics(null);

    try {
      // Extract all files, concatenating raw text
      const allRawParts: string[] = [];
      let lastDiagnostics: NovelImportExtractDiagnostics | null = null;

      for (const file of importFiles) {
        const result = await extractNovelTextFromFile(file);
        allRawParts.push(result.rawText);
        lastDiagnostics = result.diagnostics;
        if (result.diagnostics.warnings.length > 0) {
          onToast(result.diagnostics.warnings.join('; '), 'info');
        }
      }
      setExtractDiagnostics(lastDiagnostics);

      const combinedRaw = allRawParts.join('\n\n');
      setIsExtracting(false);
      setIsSplitting(true);

      const { chapters: previews, warnings } = await splitImportedTextToChapters(combinedRaw);
      setSplitWarnings(warnings);

      const editable: EditableImportChapter[] = previews.map((ch) => ({
        ...ch,
        id: createLocalId('import'),
        selected: true,
        titleEdited: false,
      }));
      setEditableChapters(editable);
      setImportStep('confirm');
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : 'Import failed', 'error');
    } finally {
      setIsExtracting(false);
      setIsSplitting(false);
    }
  }, [importFiles, onToast]);

  const updateEditableChapter = useCallback(
    (id: string, patch: Partial<Pick<EditableImportChapter, 'title' | 'selected' | 'titleEdited'>>) => {
      setEditableChapters((prev) =>
        prev.map((ch) => (ch.id === id ? { ...ch, ...patch } : ch)),
      );
    },
    [],
  );

  const toggleSelectAll = useCallback((selected: boolean) => {
    setEditableChapters((prev) => prev.map((ch) => ({ ...ch, selected })));
  }, []);

  const applyImport = useCallback(async () => {
    const toImport = editableChapters.filter((ch) => ch.selected);
    if (toImport.length === 0) {
      onToast('No chapters selected', 'info');
      return;
    }
    setIsApplying(true);

    const startIndex = chapters.length;
    const now = new Date().toISOString();

    const newChapters: LocalNovelChapter[] = toImport.map((ch, i) => ({
      id: createLocalId('chapter'),
      projectId: selectedProjectId,
      title: ch.title,
      name: ch.title,
      index: startIndex + i,
      text: ch.text,
      adaptedText: '',
      adaptationStatus: 'idle' as const,
      createdTime: now,
      modifiedTime: now,
    }));

    setChaptersByProjectId((prev) => ({
      ...prev,
      [selectedProjectId]: [...(prev[selectedProjectId] || []), ...newChapters],
    }));

    setIsApplying(false);
    setIsImportModalOpen(false);
    onToast(`Imported ${newChapters.length} chapter${newChapters.length !== 1 ? 's' : ''}`, 'success');
  }, [editableChapters, chapters, selectedProjectId, setChaptersByProjectId, onToast]);

  return {
    isImportModalOpen,
    importFiles,
    isExtracting,
    isSplitting,
    isApplying,
    extractDiagnostics,
    splitWarnings,
    editableChapters,
    importStep,
    openImportModal,
    closeImportModal,
    addFiles,
    removeFile,
    extractAndSplit,
    updateEditableChapter,
    toggleSelectAll,
    applyImport,
    setImportStep,
  };
};
