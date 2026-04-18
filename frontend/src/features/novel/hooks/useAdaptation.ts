import { useCallback, useRef, useState } from 'react';
import type { GenerationSettings, MemoryEntry, MemoryEntryKind, ProjectMemoryLedger, ChapterMemorySummary } from '../../../../types';
import { generateTextContent } from '../../../../services/geminiService';
import { useNovelEditor, type LocalNovelChapter, emptyLedger, createLocalId } from '../contexts/NovelEditorContext';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
const normalizeMemoryKey = (value: string): string => collapseWhitespace(value).toLowerCase();

const upsertMemoryEntries = (existing: MemoryEntry[], incoming: MemoryEntry[], kind: MemoryEntryKind): MemoryEntry[] => {
  const byKey = new Map<string, MemoryEntry>();
  existing.forEach((row) => byKey.set(normalizeMemoryKey(row.sourceName), row));
  incoming.forEach((row) => {
    const key = normalizeMemoryKey(row.sourceName);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...row, kind, updatedAt: new Date().toISOString() });
      return;
    }
    if (current.locked) return;
    byKey.set(key, {
      ...current,
      adaptedName: row.adaptedName || current.adaptedName,
      confidence: typeof row.confidence === 'number' ? row.confidence : current.confidence,
      updatedAt: new Date().toISOString(),
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
};

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
  const stripped = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
};

const buildMemoryInstruction = (ledger: ProjectMemoryLedger): string => {
  const chars = ledger.characters.filter((item) => item.locked);
  const places = ledger.places.filter((item) => item.locked);
  const render = (rows: MemoryEntry[], label: string): string =>
    rows.length === 0
      ? `${label}: none`
      : `${label}:\n${rows.map((row) => `- ${row.sourceName} -> ${row.adaptedName}`).join('\n')}`;
  return [render(chars, 'Locked character mappings'), render(places, 'Locked place mappings')].join('\n');
};

export const useAdaptation = (settings: GenerationSettings, onToast: ToastFn) => {
  const {
    selectedProjectId,
    selectedChapterId,
    chaptersByProjectId,
    setChaptersByProjectId,
    memoryLedgerByProjectId,
    setMemoryLedgerByProjectId,
    chapterSummariesByProjectId,
    setChapterSummariesByProjectId,
    selectedLedger,
    chapters,
  } = useNovelEditor();

  const [isAdapting, setIsAdapting] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [targetCulture, setTargetCulture] = useState('');

  const batchCancelRef = useRef(false);
  const chaptersRef = useRef(chaptersByProjectId);
  chaptersRef.current = chaptersByProjectId;
  const ledgerRef = useRef(memoryLedgerByProjectId);
  ledgerRef.current = memoryLedgerByProjectId;

  const adaptSingle = useCallback(async (
    chapterText: string,
    updateAdapted: (text: string) => void,
  ) => {
    if (!chapterText.trim()) {
      onToast('No text to adapt', 'info');
      return;
    }
    setIsAdapting(true);
    try {
      const memoryBlock = buildMemoryInstruction(selectedLedger);
      const cultureNote = targetCulture ? `\nCultural context: ${targetCulture}` : '';
      const prompt = `Adapt the following novel text to ${targetLang}.${cultureNote}\n\n${memoryBlock}\n\nChapter text:\n${chapterText}`;
      const result = await generateTextContent(prompt, chapterText, settings);
      updateAdapted(result);

      // Extract memory mappings from result
      const extractPrompt = `Extract character names and place names from this adapted text. Return JSON: { "characters": [{ "sourceName": "...", "adaptedName": "..." }], "places": [{ "sourceName": "...", "adaptedName": "..." }] }\n\nSource:\n${chapterText}\n\nAdapted:\n${result}`;
      try {
        const extracted = await generateTextContent(extractPrompt, undefined, settings);
        const parsed = extractJsonObject(extracted);
        if (parsed) {
          const nowIso = new Date().toISOString();
          const chars = (Array.isArray(parsed.characters) ? parsed.characters : []).map((c: Record<string, string>) => ({
            id: createLocalId('memory'),
            kind: 'character' as MemoryEntryKind,
            sourceName: String(c.sourceName || ''),
            adaptedName: String(c.adaptedName || ''),
            locked: false,
            updatedAt: nowIso,
          }));
          const places = (Array.isArray(parsed.places) ? parsed.places : []).map((p: Record<string, string>) => ({
            id: createLocalId('memory'),
            kind: 'place' as MemoryEntryKind,
            sourceName: String(p.sourceName || ''),
            adaptedName: String(p.adaptedName || ''),
            locked: false,
            updatedAt: nowIso,
          }));
          setMemoryLedgerByProjectId((prev) => {
            const current = prev[selectedProjectId] || emptyLedger();
            return {
              ...prev,
              [selectedProjectId]: {
                ...current,
                characters: upsertMemoryEntries(current.characters, chars, 'character'),
                places: upsertMemoryEntries(current.places, places, 'place'),
              },
            };
          });
        }
      } catch {
        // Memory extraction failure is non-critical
      }

      onToast('Chapter adapted', 'success');
    } catch (error) {
      onToast('Adaptation failed', 'error');
    } finally {
      setIsAdapting(false);
    }
  }, [selectedProjectId, selectedLedger, targetLang, targetCulture, settings, onToast, setMemoryLedgerByProjectId]);

  const runBatch = useCallback(async () => {
    if (chapters.length === 0) {
      onToast('No chapters to adapt', 'info');
      return;
    }
    batchCancelRef.current = false;
    setIsBatchRunning(true);
    setBatchMessage('Starting batch adaptation...');

    let batchIdx = 0;
    for (const chapter of chapters) {
      if (batchCancelRef.current) {
        setBatchMessage('Batch cancelled');
        break;
      }
      batchIdx += 1;
      setBatchMessage(`Adapting ${batchIdx}/${chapters.length}: ${chapter.title}`);
      if (!chapter.text.trim()) continue;

      try {
        const ledger = ledgerRef.current[selectedProjectId] || emptyLedger();
        const memoryBlock = buildMemoryInstruction(ledger);
        const cultureNote = targetCulture ? `\nCultural context: ${targetCulture}` : '';
        const prompt = `Adapt the following novel text to ${targetLang}.${cultureNote}\n\n${memoryBlock}\n\nChapter text:\n${chapter.text}`;
        const result = await generateTextContent(prompt, chapter.text, settings);

        setChaptersByProjectId((prev) => ({
          ...prev,
          [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
            c.id === chapter.id
              ? { ...c, adaptedText: result, adaptationStatus: 'done' as const, lastAdaptedAt: new Date().toISOString(), modifiedTime: new Date().toISOString() }
              : c
          ),
        }));
      } catch {
        setChaptersByProjectId((prev) => ({
          ...prev,
          [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
            c.id === chapter.id
              ? { ...c, adaptationStatus: 'failed' as const, adaptationError: 'Batch adaptation failed', modifiedTime: new Date().toISOString() }
              : c
          ),
        }));
      }
    }

    setIsBatchRunning(false);
    setBatchMessage(batchCancelRef.current ? 'Batch cancelled' : 'Batch complete');
    onToast(batchCancelRef.current ? 'Batch cancelled' : 'Batch adaptation complete', batchCancelRef.current ? 'info' : 'success');
  }, [chapters, selectedProjectId, targetLang, targetCulture, settings, onToast, setChaptersByProjectId]);

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  return {
    isAdapting,
    isBatchRunning,
    batchMessage,
    targetLang,
    targetCulture,
    setTargetLang,
    setTargetCulture,
    adaptSingle,
    runBatch,
    cancelBatch,
  };
};
