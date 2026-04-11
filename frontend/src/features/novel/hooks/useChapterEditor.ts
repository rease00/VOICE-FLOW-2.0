import { useCallback, useEffect, useRef, useState } from 'react';
import { useNovelEditor, type LocalNovelChapter } from '../contexts/NovelEditorContext';
import type { ChapterVersionSnapshot } from '../../../../types';

const MAX_VERSIONS_PER_CHAPTER = 20;

export const useChapterEditor = () => {
  const {
    selectedProjectId,
    selectedChapterId,
    selectedChapter,
    chaptersByProjectId,
    setChaptersByProjectId,
    chapterVersionsByProjectId,
    setChapterVersionsByProjectId,
    chapters,
  } = useNovelEditor();

  const [chapterText, setChapterText] = useState('');
  const [adaptedOutput, setAdaptedOutput] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTextRef = useRef('');

  // Sync editor text when selected chapter changes
  useEffect(() => {
    if (!selectedChapter) {
      setChapterText('');
      setAdaptedOutput('');
      setIsDirty(false);
      lastSavedTextRef.current = '';
      return;
    }
    setChapterText(selectedChapter.text);
    setAdaptedOutput(selectedChapter.adaptedText || '');
    setIsDirty(false);
    lastSavedTextRef.current = selectedChapter.text;
  }, [selectedChapter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateChapterText = useCallback((text: string) => {
    setChapterText(text);
    setIsDirty(text !== lastSavedTextRef.current);

    // Debounced auto-save to context
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      setChaptersByProjectId((prev) => ({
        ...prev,
        [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
          c.id === selectedChapterId ? { ...c, text, modifiedTime: new Date().toISOString() } : c
        ),
      }));
      lastSavedTextRef.current = text;
      setIsDirty(false);
    }, 500);
  }, [selectedProjectId, selectedChapterId, setChaptersByProjectId]);

  const updateAdaptedOutput = useCallback((text: string) => {
    setAdaptedOutput(text);
    setChaptersByProjectId((prev) => ({
      ...prev,
      [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
        c.id === selectedChapterId ? { ...c, adaptedText: text, modifiedTime: new Date().toISOString() } : c
      ),
    }));
  }, [selectedProjectId, selectedChapterId, setChaptersByProjectId]);

  const saveNow = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setChaptersByProjectId((prev) => ({
      ...prev,
      [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
        c.id === selectedChapterId
          ? { ...c, text: chapterText, adaptedText: adaptedOutput, modifiedTime: new Date().toISOString() }
          : c
      ),
    }));
    lastSavedTextRef.current = chapterText;
    setIsDirty(false);
  }, [selectedProjectId, selectedChapterId, chapterText, adaptedOutput, setChaptersByProjectId]);

  const recordVersionSnapshot = useCallback((reason: string = 'manual') => {
    if (!selectedChapterId) return;
    const snapshot: ChapterVersionSnapshot = {
      id: `${selectedChapterId}_${Date.now()}`,
      chapterId: selectedChapterId,
      timestamp: new Date().toISOString(),
      sourceText: chapterText,
      adaptedText: adaptedOutput,
      label: 'snapshot',
      reason,
    };
    setChapterVersionsByProjectId((prev) => {
      const projectVersions = prev[selectedProjectId] || {};
      const chapterVersions = projectVersions[selectedChapterId] || [];
      const updated = [snapshot, ...chapterVersions].slice(0, MAX_VERSIONS_PER_CHAPTER);
      return {
        ...prev,
        [selectedProjectId]: { ...projectVersions, [selectedChapterId]: updated },
      };
    });
  }, [selectedProjectId, selectedChapterId, chapterText, adaptedOutput, setChapterVersionsByProjectId]);

  const revertToVersion = useCallback((snapshot: ChapterVersionSnapshot) => {
    setChapterText(snapshot.sourceText);
    setAdaptedOutput(snapshot.adaptedText);
    setChaptersByProjectId((prev) => ({
      ...prev,
      [selectedProjectId]: (prev[selectedProjectId] || []).map((c) =>
        c.id === selectedChapterId
          ? { ...c, text: snapshot.sourceText, adaptedText: snapshot.adaptedText, modifiedTime: new Date().toISOString() }
          : c
      ),
    }));
    lastSavedTextRef.current = snapshot.sourceText;
    setIsDirty(false);
  }, [selectedProjectId, selectedChapterId, setChaptersByProjectId]);

  const versions = (chapterVersionsByProjectId[selectedProjectId]?.[selectedChapterId] || [])
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const selectedChapterIndex = chapters.findIndex((c) => c.id === selectedChapterId);

  const goToPrevChapter = useCallback(() => {
    const idx = chapters.findIndex((c) => c.id === selectedChapterId);
    if (idx > 0) {
      const prev = chapters[idx - 1];
      if (prev) {
        setChapterText(prev.text);
        setAdaptedOutput(prev.adaptedText || '');
      }
    }
  }, [chapters, selectedChapterId]);

  const goToNextChapter = useCallback(() => {
    const idx = chapters.findIndex((c) => c.id === selectedChapterId);
    if (idx >= 0 && idx < chapters.length - 1) {
      const next = chapters[idx + 1];
      if (next) {
        setChapterText(next.text);
        setAdaptedOutput(next.adaptedText || '');
      }
    }
  }, [chapters, selectedChapterId]);

  const wordCount = chapterText.trim() ? chapterText.trim().split(/\s+/).length : 0;
  const charCount = chapterText.length;

  return {
    chapterText,
    adaptedOutput,
    isDirty,
    wordCount,
    charCount,
    selectedChapterIndex,
    versions,
    updateChapterText,
    updateAdaptedOutput,
    saveNow,
    recordVersionSnapshot,
    revertToVersion,
    goToPrevChapter,
    goToNextChapter,
  };
};
