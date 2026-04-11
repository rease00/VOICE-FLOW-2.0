import { useCallback } from 'react';
import type { MemoryEntry, MemoryEntryKind, ProjectMemoryLedger, ChapterMemorySummary } from '../../../../types';
import { useNovelEditor, createLocalId, emptyLedger } from '../contexts/NovelEditorContext';

const normalizeKey = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

export const useMemoryLedger = () => {
  const {
    selectedProjectId,
    memoryLedgerByProjectId,
    setMemoryLedgerByProjectId,
    chapterSummariesByProjectId,
    setChapterSummariesByProjectId,
    selectedLedger,
  } = useNovelEditor();

  const mutateLedger = useCallback(
    (updater: (current: ProjectMemoryLedger) => ProjectMemoryLedger) => {
      setMemoryLedgerByProjectId((prev) => ({
        ...prev,
        [selectedProjectId]: updater(prev[selectedProjectId] || emptyLedger()),
      }));
    },
    [selectedProjectId, setMemoryLedgerByProjectId],
  );

  const addEntry = useCallback(
    (kind: MemoryEntryKind, sourceName: string, adaptedName: string) => {
      const newEntry: MemoryEntry = {
        id: createLocalId('memory'),
        kind,
        sourceName: sourceName.trim(),
        adaptedName: adaptedName.trim(),
        locked: false,
        updatedAt: new Date().toISOString(),
      };
      mutateLedger((current) => {
        const field = kind === 'character' ? 'characters' : 'places';
        const existing = current[field];
        const key = normalizeKey(sourceName);
        const alreadyExists = existing.some((e) => normalizeKey(e.sourceName) === key);
        if (alreadyExists) return current;
        const updated = [...existing, newEntry].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
        return { ...current, [field]: updated };
      });
    },
    [mutateLedger],
  );

  const updateEntry = useCallback(
    (id: string, patch: Partial<Pick<MemoryEntry, 'sourceName' | 'adaptedName' | 'confidence' | 'notes'>>) => {
      mutateLedger((current) => {
        const mapEntries = (entries: MemoryEntry[]): MemoryEntry[] =>
          entries.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e,
          );
        return {
          ...current,
          characters: mapEntries(current.characters),
          places: mapEntries(current.places),
        };
      });
    },
    [mutateLedger],
  );

  const removeEntry = useCallback(
    (id: string) => {
      mutateLedger((current) => ({
        ...current,
        characters: current.characters.filter((e) => e.id !== id),
        places: current.places.filter((e) => e.id !== id),
      }));
    },
    [mutateLedger],
  );

  const toggleLock = useCallback(
    (id: string) => {
      mutateLedger((current) => {
        const mapEntries = (entries: MemoryEntry[]): MemoryEntry[] =>
          entries.map((e) =>
            e.id === id ? { ...e, locked: !e.locked, updatedAt: new Date().toISOString() } : e,
          );
        return {
          ...current,
          characters: mapEntries(current.characters),
          places: mapEntries(current.places),
        };
      });
    },
    [mutateLedger],
  );

  const mergeLedger = useCallback(
    (incoming: ProjectMemoryLedger) => {
      mutateLedger((current) => {
        const mergeEntries = (existing: MemoryEntry[], next: MemoryEntry[], kind: MemoryEntryKind): MemoryEntry[] => {
          const byKey = new Map<string, MemoryEntry>();
          existing.forEach((row) => byKey.set(normalizeKey(row.sourceName), row));
          next.forEach((row) => {
            const key = normalizeKey(row.sourceName);
            const prior = byKey.get(key);
            if (!prior) {
              byKey.set(key, { ...row, kind, updatedAt: new Date().toISOString() });
              return;
            }
            if (prior.locked) return;
            byKey.set(key, {
              ...prior,
              adaptedName: row.adaptedName || prior.adaptedName,
              updatedAt: new Date().toISOString(),
            });
          });
          return Array.from(byKey.values()).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
        };
        return {
          ...current,
          characters: mergeEntries(current.characters, incoming.characters, 'character'),
          places: mergeEntries(current.places, incoming.places, 'place'),
        };
      });
    },
    [mutateLedger],
  );

  const upsertChapterSummary = useCallback(
    (summary: ChapterMemorySummary) => {
      setChapterSummariesByProjectId((prev) => {
        const current = prev[selectedProjectId] ?? [];
        const exists = current.some((s) => s.chapterId === summary.chapterId);
        const updated = exists
          ? current.map((s) => (s.chapterId === summary.chapterId ? { ...summary } : s))
          : [...current, summary];
        return { ...prev, [selectedProjectId]: updated };
      });
    },
    [selectedProjectId, setChapterSummariesByProjectId],
  );

  const removeChapterSummary = useCallback(
    (chapterId: string) => {
      setChapterSummariesByProjectId((prev) => ({
        ...prev,
        [selectedProjectId]: (prev[selectedProjectId] ?? []).filter((s) => s.chapterId !== chapterId),
      }));
    },
    [selectedProjectId, setChapterSummariesByProjectId],
  );

  const chapterSummaries = chapterSummariesByProjectId[selectedProjectId] ?? [];

  return {
    ledger: selectedLedger,
    chapterSummaries,
    addEntry,
    updateEntry,
    removeEntry,
    toggleLock,
    mergeLedger,
    upsertChapterSummary,
    removeChapterSummary,
  };
};
