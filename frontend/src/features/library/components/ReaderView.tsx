'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  GraduationCap,
  List,
  Loader2,
  Music,
  MessageSquare,
  Play,
  Speaker,
  Sparkles,
  Settings as SettingsIcon,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import type {
  Book,
  ChapterComment,
  LastPlayedRecord,
  PlaybackState,
  ReaderChapter,
  TtsSettings,
} from '../model/types';
import { getBookDownloadLink } from '../services/bookDiscoveryService';
import { tokenizeParagraph, DEFAULT_CHUNK_LIMIT } from '../services/ttsUtils';
import { AmbiancePanel } from './dock/AmbiancePanel';
import { MiniPlayer } from './dock/MiniPlayer';
import { ScriptDetails } from './dock/ScriptDetails';
import { SpeakerOptions } from './dock/SpeakerOptions';
import { TTSOptions } from './dock/TTSOptions';
import {
  createChapterComment,
  extractReaderChapters,
  getChapterComments,
  saveLastPlayed,
} from '../services/readerDataService';

interface ReaderViewProps {
  book: Book;
  onClose: () => void;
  user?: { id: string; email?: string } | null;
  initialChapterIndex?: number;
  onLastPlayedChange?: (record: LastPlayedRecord) => void;
}

interface DisplaySettings {
  background: 'dark' | 'sepia' | 'light';
  fontSize: number;
  font: 'serif' | 'sans';
  lineHeight: number;
}

interface TranslationLanguageOption {
  code: string;
  label: string;
}

const DISPLAY_SETTINGS_KEY = 'vf:reader-display-settings';

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  background: 'dark',
  fontSize: 18,
  font: 'serif',
  lineHeight: 1.75,
};

const TRANSLATION_LANGUAGE_OPTIONS: TranslationLanguageOption[] = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'tr', label: 'Turkish' },
  { code: 'id', label: 'Indonesian' },
  { code: 'zh', label: 'Chinese (Simplified)' },
];

const LANGUAGE_TO_LOCALE: Record<string, string> = {
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ar: 'ar-SA',
  hi: 'hi-IN',
  bn: 'bn-IN',
  ru: 'ru-RU',
  ja: 'ja-JP',
  ko: 'ko-KR',
  tr: 'tr-TR',
  id: 'id-ID',
  zh: 'zh-CN',
};

const getLocaleForLanguage = (code?: string) => {
  if (!code) return 'en-US';
  if (code.includes('-')) return code;
  return LANGUAGE_TO_LOCALE[code] || `${code}-US`;
};

const getTranslationCacheKey = (
  bookId: string | number,
  chapter: ReaderChapter | undefined,
  targetLanguage: string,
  text: string
) => {
  const chapterKey = chapter
    ? `${chapter.index}:${chapter.start}:${chapter.title.toLowerCase()}`
    : `raw:${text.length}`;

  return `${bookId}:${chapterKey}:${targetLanguage}:${text.length}`;
};

const readDisplaySettings = (): DisplaySettings => {
  if (typeof window === 'undefined') {
    return DEFAULT_DISPLAY_SETTINGS;
  }

  const raw = window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_DISPLAY_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as DisplaySettings;
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
};

const getAuthorLabel = (book: Book) =>
  book.authors.map((author) => author.name.split(',').reverse().join(' ').trim()).join(', ') ||
  'Unknown Author';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const normalizeChapterText = (value: string) =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

const normalizeChapterTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dedupeChapters = (items: ReaderChapter[]): ReaderChapter[] => {
  const byTitle = new Map<string, ReaderChapter>();

  for (const chapter of items) {
    const titleKey = normalizeChapterTitle(chapter.title);
    const previous = byTitle.get(titleKey);
    if (!previous) {
      byTitle.set(titleKey, chapter);
      continue;
    }

    const pickCurrent =
      chapter.text.length > previous.text.length ||
      (chapter.text.length === previous.text.length && chapter.start > previous.start);

    if (pickCurrent) {
      byTitle.set(titleKey, chapter);
    }
  }

  const byTitleValues = [...byTitle.values()].sort((a, b) => a.start - b.start);
  const seenText = new Set<string>();
  const unique: ReaderChapter[] = [];

  for (const chapter of byTitleValues) {
    const signature = normalizeChapterText(chapter.text.slice(0, 420));
    if (seenText.has(signature)) {
      continue;
    }

    seenText.add(signature);
    unique.push(chapter);
  }

  return unique.map((chapter, index) => ({
    ...chapter,
    index,
  }));
};

type BookPanelTab = 'chapters' | 'settings' | 'comments';
type DockPopupTab = 'tts' | 'script' | 'speaker' | 'ambiance' | 'summary' | 'quiz' | null;

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export function ReaderView({
  book,
  onClose,
  user = null,
  initialChapterIndex = 0,
  onLastPlayedChange,
}: ReaderViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState('');
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);

  const [bookPanelTab, setBookPanelTab] = useState<BookPanelTab>('chapters');
  const [activeDockPopup, setActiveDockPopup] = useState<DockPopupTab>(null);
  const [activeBookPopup, setActiveBookPopup] = useState<BookPanelTab | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [chapterSearchOpen, setChapterSearchOpen] = useState(false);
  const [chapterSearchQuery, setChapterSearchQuery] = useState('');
  const sidebarPopupRef = useRef<HTMLDivElement>(null);
  const dockPopupRef = useRef<HTMLDivElement>(null);

  const [comments, setComments] = useState<ChapterComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [settings, setSettings] = useState<DisplaySettings>(readDisplaySettings);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('es');
  const [translatedText, setTranslatedText] = useState('');
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const translationCacheRef = useRef<Map<string, string>>(new Map());

  const [chapterSummary, setChapterSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryChapterIdx, setSummaryChapterIdx] = useState(-1);

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizChapterIdx, setQuizChapterIdx] = useState(-1);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizRevealed, setQuizRevealed] = useState(false);

  const [bookmarks, setBookmarks] = useState<number[]>([]);

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    bookId: String(book.id),
    currentChunkIndex: 0,
    currentTime: 0,
    isPlaying: false,
    isPreloading: true,
    totalChunks: 1,
  });

  const [ttsSettings, setTtsSettings] = useState<TtsSettings>({
    engine: 'gemini-native',
    voice: 'Kore',
    speed: 1.0,
    pitch: 0,
    language: 'en-US',
    speakerMode: 'single',
    speakerConfigs: [],
  });
  const effectiveTtsSettings = useMemo(() => {
    return {
      ...ttsSettings,
      language: translationEnabled ? getLocaleForLanguage(targetLanguage) : ttsSettings.language,
    } as TtsSettings;
  }, [ttsSettings, translationEnabled, targetLanguage]);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const lastUserInteractionRef = useRef<number>(Date.now());

  // Bookmarks — localStorage-backed
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`bookmarks-${book.id}`);
      if (stored) setBookmarks(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [book.id]);

  const toggleBookmark = (chapterIdx: number) => {
    setBookmarks((prev) => {
      const next = prev.includes(chapterIdx) ? prev.filter((i) => i !== chapterIdx) : [...prev, chapterIdx];
      try { localStorage.setItem(`bookmarks-${book.id}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const chapterComments = useMemo(
    () => comments.filter((comment) => comment.chapterIndex === selectedChapterIndex),
    [comments, selectedChapterIndex]
  );
  const filteredChapters = useMemo(() => {
    const query = chapterSearchQuery.trim().toLowerCase();
    if (!query) {
      return chapters;
    }

    return chapters.filter((chapter) => {
      const haystack = `chapter ${chapter.index + 1} ${chapter.title}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [chapterSearchQuery, chapters]);

  const activeChapter = chapters[selectedChapterIndex];
  const readerText = activeChapter?.text || rawContent;
  const visibleReaderText = translationEnabled && translatedText ? translatedText : readerText;
  const selectedTranslationLanguage = useMemo(
    () =>
      TRANSLATION_LANGUAGE_OPTIONS.find((language) => language.code === targetLanguage) ||
      TRANSLATION_LANGUAGE_OPTIONS[0],
    [targetLanguage]
  );
  const formattedReaderParagraphs = useMemo(() => {
    return visibleReaderText
      .replace(/\r/g, '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }, [visibleReaderText]);

  // Tokenize paragraphs and build a paragraph->chunk map so we can
  // highlight words in sync with audio chunks produced by MiniPlayer.
  const paragraphTokens = useMemo(() => {
    return formattedReaderParagraphs.map((p) => tokenizeParagraph(p));
  }, [formattedReaderParagraphs]);

  const paragraphTokenCounts = useMemo(() => paragraphTokens.map((t) => t.length), [paragraphTokens]);

  // Build chunk -> paragraph index mapping using same heuristic as splitIntoChunks
  const chunkParagraphMap = useMemo(() => {
    const map: number[][] = [];
    let current: number[] = [];
    let currentLen = 0;

    for (let i = 0; i < formattedReaderParagraphs.length; i++) {
      const para = formattedReaderParagraphs[i] || '';
      const pLen = para.length;
      if (current.length === 0) {
        current = [i];
        currentLen = pLen;
        continue;
      }

      const wouldBe = currentLen + 2 + pLen; // +2 for the "\n\n" join used by splitIntoChunks
      if (wouldBe > DEFAULT_CHUNK_LIMIT && current.length > 0) {
        map.push(current);
        current = [i];
        currentLen = pLen;
      } else {
        current.push(i);
        currentLen = wouldBe;
      }
    }

    if (current.length) map.push(current);
    return map;
  }, [formattedReaderParagraphs]);

  const tokensPerChunk = useMemo(() => {
    return chunkParagraphMap.map((paras) => paras.reduce((acc, p) => acc + (paragraphTokenCounts[p] || 0), 0));
  }, [chunkParagraphMap, paragraphTokenCounts]);

  // Compute which token (global) is currently active based on playbackState.
  const activeHighlight = useMemo(() => {
    const chunkIndex = Math.min(
      Math.max(0, playbackState.currentChunkIndex),
      Math.max(0, chunkParagraphMap.length - 1)
    );

    const chunkDur = playbackState.chunkDuration || 0;
    const timeInto = Math.max(0, playbackState.currentTime || 0);
    const tokensInChunk = tokensPerChunk[chunkIndex] || 0;
    if (!tokensInChunk || chunkDur <= 0) {
      return { paragraphIndex: -1, tokenIndexInParagraph: -1, globalIndex: -1, chunkIndex };
    }

    const frac = Math.min(1, Math.max(0, timeInto / chunkDur));
    const tokenIdxWithinChunk = Math.min(tokensInChunk - 1, Math.floor(frac * tokensInChunk));

    // Find which paragraph within the chunk holds this token
    let remaining = tokenIdxWithinChunk;
    let paragraphIndex = chunkParagraphMap[chunkIndex]?.[0] ?? -1;
    let tokenIndexInParagraph = 0;

    for (const pIdx of chunkParagraphMap[chunkIndex] || []) {
      const len = paragraphTokenCounts[pIdx] || 0;
      if (remaining < len) {
        paragraphIndex = pIdx;
        tokenIndexInParagraph = remaining;
        break;
      }
      remaining -= len;
    }

    // Compute global token index for stable element ids
    let global = 0;
    for (let i = 0; i < paragraphIndex; i++) global += paragraphTokenCounts[i] || 0;
    global += tokenIndexInParagraph;

    return { paragraphIndex, tokenIndexInParagraph, globalIndex: global, chunkIndex };
  }, [playbackState.currentChunkIndex, playbackState.currentTime, playbackState.chunkDuration, chunkParagraphMap, tokensPerChunk, paragraphTokenCounts]);

  const lastHighlightedRef = useRef<string | null>(null);

  const sentenceTokenRanges = useMemo(() => {
    const all: Array<
      Array<{
        paragraphIndex: number;
        startTokenIndex: number;
        endTokenIndex: number;
        globalStart: number;
        globalEnd: number;
        text: string;
      }>
    > = [];

    let globalCursor = 0;

    for (let p = 0; p < formattedReaderParagraphs.length; p++) {
      const paragraph = formattedReaderParagraphs[p] || '';
      const tokens = paragraphTokens[p] || [];

      // build token char positions
      const tokenPositions: Array<{ start: number; end: number }> = [];
      let off = 0;
      for (const t of tokens) {
        tokenPositions.push({ start: off, end: off + t.length });
        off += t.length;
      }

      // split paragraph into sentences
      const sentenceRegex = /[^.!?]+[.!?]+["']?(?=\s|$)|[^.!?]+$/g;
      const matches = paragraph.match(sentenceRegex) || [];
      const ranges: Array<{
        paragraphIndex: number;
        startTokenIndex: number;
        endTokenIndex: number;
        globalStart: number;
        globalEnd: number;
        text: string;
      }> = [];
      let searchFrom = 0;

      for (const s of matches) {
        const trimmed = s.trim();
        if (!trimmed) {
          searchFrom += s.length;
          continue;
        }

        const startChar = paragraph.indexOf(s, searchFrom);
        const endChar = startChar + s.length;
        searchFrom = endChar;

        // find token indices overlapping this sentence
        let startToken = tokens.findIndex((_: string, idx: number) => tokenPositions[idx] && tokenPositions[idx].end > startChar);
        if (startToken === -1) startToken = 0;
        let endToken = tokenPositions.length - 1;
        for (let ti = tokenPositions.length - 1; ti >= 0; ti--) {
          if (tokenPositions[ti] && tokenPositions[ti]!.start < endChar) {
            endToken = ti;
            break;
          }
        }

        ranges.push({
          paragraphIndex: p,
          startTokenIndex: Math.max(0, startToken),
          endTokenIndex: Math.max(0, endToken),
          globalStart: globalCursor + Math.max(0, startToken),
          globalEnd: globalCursor + Math.max(0, endToken),
          text: trimmed,
        });
      }

      all.push(ranges);
      globalCursor += tokens.length;
    }

    return all;
  }, [formattedReaderParagraphs, paragraphTokens, paragraphTokenCounts]);

  const flatSentenceRanges = useMemo(() => sentenceTokenRanges.flat(), [sentenceTokenRanges]);

  const activeSentence = useMemo(() => {
    const g = activeHighlight.globalIndex;
    if (g < 0 || !flatSentenceRanges.length) return null;
    let lo = 0, hi = flatSentenceRanges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const r = flatSentenceRanges[mid];
      if (!r) break;
      if (g < r.globalStart) hi = mid - 1;
      else if (g > r.globalEnd) lo = mid + 1;
      else return r;
    }
    return null;
  }, [activeHighlight.globalIndex, flatSentenceRanges]);

  // Auto-scroll highlighted token into view when playing
  useEffect(() => {
    if (!activeSentence) return;
    if (!playbackState.isPlaying) return; // only auto-scroll while playing
    // avoid interrupting recent user scrolls
    if (Date.now() - lastUserInteractionRef.current < 1500) return;

    const id = `${activeSentence.globalStart}-${activeSentence.globalEnd}`;
    if (lastHighlightedRef.current === id) return;
    lastHighlightedRef.current = id;

    const mid = Math.floor((activeSentence.globalStart + activeSentence.globalEnd) / 2);
    const el = document.getElementById(`token-${mid}`);
    const container = mainScrollRef.current;
    if (el && container) {
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const offsetTop = elRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, offsetTop - container.clientHeight / 2), behavior: 'smooth' });
    }
  }, [activeSentence, playbackState.isPlaying]);
  const readerProgress = chapters.length
    ? Math.round(((selectedChapterIndex + 1) / chapters.length) * 10000) / 100
    : 0;
  const playbackCheckpoint = Math.floor(playbackState.currentTime / 5);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const timer = setTimeout(() => {
      window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
    }, 300);
    return () => clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    if (bookPanelTab !== 'chapters') {
      setChapterSearchOpen(false);
      setChapterSearchQuery('');
    }
  }, [bookPanelTab]);

  useEffect(() => {
    if (!translationEnabled) {
      setTranslationLoading(false);
      setTranslationError(null);
      setTranslatedText('');
      return;
    }

    const sourceText = readerText.trim();
    if (!sourceText) {
      setTranslatedText('');
      setTranslationError(null);
      return;
    }

    const cacheKey = getTranslationCacheKey(book.id, activeChapter, targetLanguage, sourceText);
    const cached = translationCacheRef.current.get(cacheKey);
    if (cached) {
      setTranslatedText(cached);
      setTranslationLoading(false);
      setTranslationError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const translate = async () => {
      setTranslationLoading(true);
      setTranslationError(null);

      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text: sourceText,
            targetLanguage,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { translatedText?: string; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error || `Translation failed (${response.status})`);
        }

        const nextText = payload?.translatedText?.trim() || '';
        if (!nextText) {
          throw new Error('Translation service returned empty content.');
        }

        if (cancelled) {
          return;
        }

        const cache = translationCacheRef.current;
        cache.set(cacheKey, nextText);
        if (cache.size > 40) {
          const firstKey = cache.keys().next().value;
          if (firstKey) {
            cache.delete(firstKey);
          }
        }

        setTranslatedText(nextText);
      } catch (translateError: unknown) {
        if (controller.signal.aborted || cancelled) {
          return;
        }

        setTranslatedText('');
        setTranslationError(
          translateError instanceof Error
            ? translateError.message
            : 'Unable to translate this chapter right now.'
        );
      } finally {
        if (!cancelled) {
          setTranslationLoading(false);
        }
      }
    };

    translate();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeChapter, book.id, readerText, targetLanguage, translationEnabled]);

  useEffect(() => {
    if (!translationEnabled || !translatedText) {
      return;
    }

    const nextChapter = chapters[selectedChapterIndex + 1];
    if (!nextChapter?.text?.trim()) {
      return;
    }

    const sourceText = nextChapter.text.trim();
    const nextCacheKey = getTranslationCacheKey(book.id, nextChapter, targetLanguage, sourceText);
    if (translationCacheRef.current.has(nextCacheKey)) {
      return;
    }

    const controller = new AbortController();

    // Prefetch the next chapter translation so page turns feel instant.
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: sourceText,
        targetLanguage,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { translatedText?: string };
        const nextText = payload.translatedText?.trim();
        if (!nextText) {
          return;
        }

        const cache = translationCacheRef.current;
        cache.set(nextCacheKey, nextText);
        if (cache.size > 40) {
          const firstKey = cache.keys().next().value;
          if (firstKey) {
            cache.delete(firstKey);
          }
        }
      })
      .catch(() => {
        // Silent by design: prefetch should never interrupt reading.
      });

    return () => controller.abort();
  }, [book.id, chapters, selectedChapterIndex, targetLanguage, translatedText, translationEnabled]);

  useEffect(() => {
    let cancelled = false;

    const loadBookContent = async () => {
      setLoading(true);
      setError(null);

      try {
        // Offline-first: try IndexedDB cache
        let text: string | null = null;
        try {
          const { bookStorage } = await import('@/shared/storage/bookStorage');
          const saved = await bookStorage.getBook(book.id);
          if (saved?.textContent) {
            text = saved.textContent;
          }
        } catch {
          // IndexedDB unavailable, fall through to network
        }

        if (!text) {
          const textLink = getBookDownloadLink(book, 'txt');
          if (!textLink) {
            throw new Error(
              'No readable text source was found for this book. Try a Gutenberg edition for full chapter reading.'
            );
          }

          const proxyUrl = `/api/book?url=${encodeURIComponent(textLink)}`;
          const response = await fetch(proxyUrl);
          if (!response.ok) {
            throw new Error(`Book content request failed (${response.status})`);
          }

          text = await response.text();
        }
        const parsedChapters = extractReaderChapters(text);
        const cleanChapters = dedupeChapters(parsedChapters);

        if (!cleanChapters.length) {
          throw new Error('Book text loaded, but no chapter content could be parsed.');
        }

        if (!cancelled) {
          setRawContent(text);
          setChapters(cleanChapters);
          const safeInitial = Math.min(
            Math.max(0, initialChapterIndex),
            Math.max(0, cleanChapters.length - 1)
          );
          setSelectedChapterIndex(safeInitial);
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Unable to load content'
          );
          setRawContent('');
          setChapters([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadBookContent();
    return () => {
      cancelled = true;
    };
  }, [book, initialChapterIndex]);

  useEffect(() => {
    let cancelled = false;

    const loadComments = async () => {
      const loaded = await getChapterComments(String(book.id));
      if (!cancelled) {
        setComments(loaded);
      }
    };

    loadComments();
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => {
    if (!activeChapter || chapters.length === 0) {
      return;
    }

    const timeout = setTimeout(async () => {
      const saved = await saveLastPlayed(user?.id ?? null, {
        userId: user?.id ?? null,
        bookId: String(book.id),
        chapterIndex: selectedChapterIndex,
        chapterTitle: activeChapter.title,
        progressPercent: readerProgress,
        currentTime: playbackState.currentTime,
        updatedAt: new Date().toISOString(),
        book,
      });

      if (onLastPlayedChange) {
        onLastPlayedChange(saved);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [
    activeChapter,
    book,
    chapters.length,
    onLastPlayedChange,
    playbackCheckpoint,
    playbackState.currentTime,
    readerProgress,
    selectedChapterIndex,
    user,
  ]);

  // Click-outside handler for closing popups
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close sidebar popup if click is outside
      if (
        activeBookPopup &&
        sidebarPopupRef.current &&
        !sidebarPopupRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[aria-label="Open chapters"]')
      ) {
        setActiveBookPopup(null);
      }

      // Close dock popup if click is outside
      if (
        activeDockPopup &&
        dockPopupRef.current &&
        !dockPopupRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[title="Collapse dock"], [title="Expand dock"]')
      ) {
        setActiveDockPopup(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeBookPopup, activeDockPopup]);

  const submitComment = async () => {
    const body = commentDraft.trim();
    if (!body || !activeChapter) {
      return;
    }

    setSubmittingComment(true);
    try {
      const created = await createChapterComment(
        String(book.id),
        selectedChapterIndex,
        activeChapter.title,
        body,
        user?.email ?? 'Guest Reader'
      );
      setComments((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setCommentDraft('');
    } finally {
      setSubmittingComment(false);
    }
  };

  const palette = {
    dark: {
      shell: 'bg-[var(--vf-reader-shell-bg)] text-[var(--vf-reader-shell-text)]',
      header: 'bg-[var(--vf-reader-header-bg)] text-[var(--vf-reader-header-text)] border-[var(--vf-reader-header-border)]',
      panel: 'bg-[var(--vf-reader-panel-bg)] border-[var(--vf-reader-panel-border)]',
      panelText: 'text-[var(--vf-reader-panel-text)]',
      muted: 'text-[var(--vf-reader-muted)]',
      card: 'border-[var(--vf-reader-card-border)]',
      selected: 'bg-[var(--vf-reader-selected-bg)] text-[var(--vf-reader-selected-text)]',
      hover: 'hover:bg-[var(--vf-reader-hover-bg)]',
      input: 'bg-[var(--vf-reader-input-bg)] border-[var(--vf-reader-input-border)] text-[var(--vf-reader-input-text)]',
      accentText: 'text-[var(--vf-reader-accent-text)]',
      choiceActive: 'border-[var(--vf-reader-choice-active-border)] bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)]',
      choiceIdle: 'border-[var(--vf-reader-choice-idle-border)] bg-[var(--vf-reader-choice-idle-bg)] text-[var(--vf-reader-choice-idle-text)] hover:bg-[var(--vf-reader-choice-idle-hover-bg)]',
      primaryButton: 'bg-[var(--vf-reader-primary-btn-bg)] text-[var(--vf-reader-primary-btn-text)] hover:bg-[var(--vf-reader-primary-btn-hover-bg)]',
      sidebarTriggerIdle: 'text-[var(--vf-reader-sidebar-trigger-idle-text)] border-[var(--vf-reader-sidebar-trigger-idle-border)] bg-[var(--vf-reader-sidebar-trigger-idle-bg)] hover:border-[var(--vf-reader-sidebar-trigger-idle-hover-border)] hover:bg-[var(--vf-reader-sidebar-trigger-idle-hover-bg)]',
      sidebarTriggerActive: 'border-[var(--vf-reader-sidebar-trigger-active-border)] bg-[var(--vf-reader-sidebar-trigger-active-bg)] text-[var(--vf-reader-sidebar-trigger-active-text)] shadow-lg',
      sidebarPopup: 'border-[var(--vf-reader-sidebar-popup-border)] shadow-lg',
      sidebarHeaderBorder: 'border-[var(--vf-reader-sidebar-header-border)]',
      sidebarTabsWrap: 'bg-[var(--vf-reader-sidebar-tabs-wrap-bg)]',
      sidebarTabActive: 'bg-[var(--vf-reader-sidebar-tab-active-bg)] text-[var(--vf-reader-sidebar-tab-active-text)] shadow-sm',
      sidebarTabIdle: 'text-[var(--vf-reader-sidebar-tab-idle-text)] hover:bg-[var(--vf-reader-sidebar-tab-idle-hover-bg)] hover:text-[var(--vf-reader-sidebar-tab-idle-hover-text)]',
      sidebarSearchWrap: 'border-[var(--vf-reader-sidebar-search-wrap-border)] bg-[var(--vf-reader-sidebar-search-wrap-bg)]',
      sidebarSearchInput: 'border-[var(--vf-reader-sidebar-search-input-border)] bg-[var(--vf-reader-sidebar-search-input-bg)] text-[var(--vf-reader-sidebar-search-input-text)]',
      iconMuted: 'text-[var(--vf-reader-icon-muted)]',
      iconHover: 'hover:bg-[var(--vf-reader-icon-hover-bg)]',
      dockPopup: 'border-[var(--vf-reader-dock-popup-border)] bg-[var(--vf-reader-dock-popup-bg)]',
      dockPopupHeaderBorder: 'border-[var(--vf-reader-dock-popup-header-border)]',
      dockShell: 'border-[var(--vf-reader-dock-shell-border)] bg-[var(--vf-reader-dock-shell-bg)]',
      dockActionActive: 'border-[var(--vf-reader-dock-action-active-border)] bg-[var(--vf-reader-dock-action-active-bg)] text-[var(--vf-reader-dock-action-active-text)] shadow-md',
      dockActionIdle: 'border-[var(--vf-reader-dock-action-idle-border)] bg-[var(--vf-reader-dock-action-idle-bg)] text-[var(--vf-reader-dock-action-idle-text)] hover:bg-[var(--vf-reader-dock-action-idle-hover-bg)] hover:border-[var(--vf-reader-dock-action-idle-hover-border)]',
      sliderTrackStart: 'var(--vf-reader-slider-track-start)',
      sliderTrackEnd: 'var(--vf-reader-slider-track-end)',
      sliderThumbBorder: 'var(--vf-reader-slider-thumb-border)',
      sliderThumbBg: 'var(--vf-reader-slider-thumb-bg)',
      sliderThumbHalo: 'var(--vf-reader-slider-thumb-halo)',
      sliderThumbHaloHover: 'var(--vf-reader-slider-thumb-halo-hover)',
    },
    sepia: {
      shell: 'bg-[var(--vf-reader-shell-bg)] text-[var(--vf-reader-shell-text)]',
      header: 'bg-[var(--vf-reader-header-bg)] text-[var(--vf-reader-header-text)] border-[var(--vf-reader-header-border)]',
      panel: 'bg-[var(--vf-reader-panel-bg)] border-[var(--vf-reader-panel-border)]',
      panelText: 'text-[var(--vf-reader-panel-text)]',
      muted: 'text-[var(--vf-reader-muted)]',
      card: 'border-[var(--vf-reader-card-border)]',
      selected: 'bg-[var(--vf-reader-selected-bg)] text-[var(--vf-reader-selected-text)]',
      hover: 'hover:bg-[var(--vf-reader-hover-bg)]',
      input: 'bg-[var(--vf-reader-input-bg)] border-[var(--vf-reader-input-border)] text-[var(--vf-reader-input-text)]',
      accentText: 'text-[var(--vf-reader-accent-text)]',
      choiceActive: 'border-[var(--vf-reader-choice-active-border)] bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)]',
      choiceIdle: 'border-[var(--vf-reader-choice-idle-border)] bg-[var(--vf-reader-choice-idle-bg)] text-[var(--vf-reader-choice-idle-text)] hover:bg-[var(--vf-reader-choice-idle-hover-bg)]',
      primaryButton: 'bg-[var(--vf-reader-primary-btn-bg)] text-[var(--vf-reader-primary-btn-text)] hover:bg-[var(--vf-reader-primary-btn-hover-bg)]',
      sidebarTriggerIdle: 'text-[var(--vf-reader-sidebar-trigger-idle-text)] border-[var(--vf-reader-sidebar-trigger-idle-border)] bg-[var(--vf-reader-sidebar-trigger-idle-bg)] hover:border-[var(--vf-reader-sidebar-trigger-idle-hover-border)] hover:bg-[var(--vf-reader-sidebar-trigger-idle-hover-bg)]',
      sidebarTriggerActive: 'border-[var(--vf-reader-sidebar-trigger-active-border)] bg-[var(--vf-reader-sidebar-trigger-active-bg)] text-[var(--vf-reader-sidebar-trigger-active-text)] shadow-lg',
      sidebarPopup: 'border-[var(--vf-reader-sidebar-popup-border)] shadow-lg',
      sidebarHeaderBorder: 'border-[var(--vf-reader-sidebar-header-border)]',
      sidebarTabsWrap: 'bg-[var(--vf-reader-sidebar-tabs-wrap-bg)]',
      sidebarTabActive: 'bg-[var(--vf-reader-sidebar-tab-active-bg)] text-[var(--vf-reader-sidebar-tab-active-text)] shadow-sm',
      sidebarTabIdle: 'text-[var(--vf-reader-sidebar-tab-idle-text)] hover:bg-[var(--vf-reader-sidebar-tab-idle-hover-bg)] hover:text-[var(--vf-reader-sidebar-tab-idle-hover-text)]',
      sidebarSearchWrap: 'border-[var(--vf-reader-sidebar-search-wrap-border)] bg-[var(--vf-reader-sidebar-search-wrap-bg)]',
      sidebarSearchInput: 'border-[var(--vf-reader-sidebar-search-input-border)] bg-[var(--vf-reader-sidebar-search-input-bg)] text-[var(--vf-reader-sidebar-search-input-text)]',
      iconMuted: 'text-[var(--vf-reader-icon-muted)]',
      iconHover: 'hover:bg-[var(--vf-reader-icon-hover-bg)]',
      dockPopup: 'border-[var(--vf-reader-dock-popup-border)] bg-[var(--vf-reader-dock-popup-bg)]',
      dockPopupHeaderBorder: 'border-[var(--vf-reader-dock-popup-header-border)]',
      dockShell: 'border-[var(--vf-reader-dock-shell-border)] bg-[var(--vf-reader-dock-shell-bg)]',
      dockActionActive: 'border-[var(--vf-reader-dock-action-active-border)] bg-[var(--vf-reader-dock-action-active-bg)] text-[var(--vf-reader-dock-action-active-text)] shadow-md',
      dockActionIdle: 'border-[var(--vf-reader-dock-action-idle-border)] bg-[var(--vf-reader-dock-action-idle-bg)] text-[var(--vf-reader-dock-action-idle-text)] hover:bg-[var(--vf-reader-dock-action-idle-hover-bg)] hover:border-[var(--vf-reader-dock-action-idle-hover-border)]',
      sliderTrackStart: 'var(--vf-reader-slider-track-start)',
      sliderTrackEnd: 'var(--vf-reader-slider-track-end)',
      sliderThumbBorder: 'var(--vf-reader-slider-thumb-border)',
      sliderThumbBg: 'var(--vf-reader-slider-thumb-bg)',
      sliderThumbHalo: 'var(--vf-reader-slider-thumb-halo)',
      sliderThumbHaloHover: 'var(--vf-reader-slider-thumb-halo-hover)',
    },
    light: {
      shell: 'bg-[var(--vf-reader-shell-bg)] text-[var(--vf-reader-shell-text)]',
      header: 'bg-[var(--vf-reader-header-bg)] text-[var(--vf-reader-header-text)] border-[var(--vf-reader-header-border)]',
      panel: 'bg-[var(--vf-reader-panel-bg)] border-[var(--vf-reader-panel-border)]',
      panelText: 'text-[var(--vf-reader-panel-text)]',
      muted: 'text-[var(--vf-reader-muted)]',
      card: 'border-[var(--vf-reader-card-border)]',
      selected: 'bg-[var(--vf-reader-selected-bg)] text-[var(--vf-reader-selected-text)]',
      hover: 'hover:bg-[var(--vf-reader-hover-bg)]',
      input: 'bg-[var(--vf-reader-input-bg)] border-[var(--vf-reader-input-border)] text-[var(--vf-reader-input-text)]',
      accentText: 'text-[var(--vf-reader-accent-text)]',
      choiceActive: 'border-[var(--vf-reader-choice-active-border)] bg-[var(--vf-reader-choice-active-bg)] text-[var(--vf-reader-choice-active-text)]',
      choiceIdle: 'border-[var(--vf-reader-choice-idle-border)] bg-[var(--vf-reader-choice-idle-bg)] text-[var(--vf-reader-choice-idle-text)] hover:bg-[var(--vf-reader-choice-idle-hover-bg)]',
      primaryButton: 'bg-[var(--vf-reader-primary-btn-bg)] text-[var(--vf-reader-primary-btn-text)] hover:bg-[var(--vf-reader-primary-btn-hover-bg)]',
      sidebarTriggerIdle: 'text-[var(--vf-reader-sidebar-trigger-idle-text)] border-[var(--vf-reader-sidebar-trigger-idle-border)] bg-[var(--vf-reader-sidebar-trigger-idle-bg)] hover:border-[var(--vf-reader-sidebar-trigger-idle-hover-border)] hover:bg-[var(--vf-reader-sidebar-trigger-idle-hover-bg)]',
      sidebarTriggerActive: 'border-[var(--vf-reader-sidebar-trigger-active-border)] bg-[var(--vf-reader-sidebar-trigger-active-bg)] text-[var(--vf-reader-sidebar-trigger-active-text)] shadow-lg',
      sidebarPopup: 'border-[var(--vf-reader-sidebar-popup-border)] shadow-lg',
      sidebarHeaderBorder: 'border-[var(--vf-reader-sidebar-header-border)]',
      sidebarTabsWrap: 'bg-[var(--vf-reader-sidebar-tabs-wrap-bg)]',
      sidebarTabActive: 'bg-[var(--vf-reader-sidebar-tab-active-bg)] text-[var(--vf-reader-sidebar-tab-active-text)] shadow-sm',
      sidebarTabIdle: 'text-[var(--vf-reader-sidebar-tab-idle-text)] hover:bg-[var(--vf-reader-sidebar-tab-idle-hover-bg)] hover:text-[var(--vf-reader-sidebar-tab-idle-hover-text)]',
      sidebarSearchWrap: 'border-[var(--vf-reader-sidebar-search-wrap-border)] bg-[var(--vf-reader-sidebar-search-wrap-bg)]',
      sidebarSearchInput: 'border-[var(--vf-reader-sidebar-search-input-border)] bg-[var(--vf-reader-sidebar-search-input-bg)] text-[var(--vf-reader-sidebar-search-input-text)]',
      iconMuted: 'text-[var(--vf-reader-icon-muted)]',
      iconHover: 'hover:bg-[var(--vf-reader-icon-hover-bg)]',
      dockPopup: 'border-[var(--vf-reader-dock-popup-border)] bg-[var(--vf-reader-dock-popup-bg)]',
      dockPopupHeaderBorder: 'border-[var(--vf-reader-dock-popup-header-border)]',
      dockShell: 'border-[var(--vf-reader-dock-shell-border)] bg-[var(--vf-reader-dock-shell-bg)]',
      dockActionActive: 'border-[var(--vf-reader-dock-action-active-border)] bg-[var(--vf-reader-dock-action-active-bg)] text-[var(--vf-reader-dock-action-active-text)] shadow-md',
      dockActionIdle: 'border-[var(--vf-reader-dock-action-idle-border)] bg-[var(--vf-reader-dock-action-idle-bg)] text-[var(--vf-reader-dock-action-idle-text)] hover:bg-[var(--vf-reader-dock-action-idle-hover-bg)] hover:border-[var(--vf-reader-dock-action-idle-hover-border)]',
      sliderTrackStart: 'var(--vf-reader-slider-track-start)',
      sliderTrackEnd: 'var(--vf-reader-slider-track-end)',
      sliderThumbBorder: 'var(--vf-reader-slider-thumb-border)',
      sliderThumbBg: 'var(--vf-reader-slider-thumb-bg)',
      sliderThumbHalo: 'var(--vf-reader-slider-thumb-halo)',
      sliderThumbHaloHover: 'var(--vf-reader-slider-thumb-halo-hover)',
    },
  }[settings.background];

  const sliderCssVars = {
     '--dock-slider-track-start': `var(--vf-reader-slider-track-start)`,
     '--dock-slider-track-end': `var(--vf-reader-slider-track-end)`,
     '--dock-slider-thumb-border': `var(--vf-reader-slider-thumb-border)`,
     '--dock-slider-thumb-bg': `var(--vf-reader-slider-thumb-bg)`,
     '--dock-slider-thumb-halo': `var(--vf-reader-slider-thumb-halo)`,
     '--dock-slider-thumb-halo-hover': `var(--vf-reader-slider-thumb-halo-hover)`,
  } as React.CSSProperties;

  const generateSummary = async () => {
    if (summaryLoading) return;
    const chapterText = readerText;
    if (!chapterText) return;
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chapterText.slice(0, 30000), chapterTitle: activeChapter?.title }),
      });
      if (!res.ok) throw new Error('Summary failed');
      const data = await res.json();
      setChapterSummary(data.summary || 'No summary available.');
      setSummaryChapterIdx(selectedChapterIndex);
    } catch {
      setChapterSummary('Failed to generate summary. Please try again.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const generateQuiz = async () => {
    if (quizLoading) return;
    const chapterText = readerText;
    if (!chapterText) return;
    setQuizLoading(true);
    setQuizAnswers({});
    setQuizRevealed(false);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chapterText.slice(0, 30000), chapterTitle: activeChapter?.title }),
      });
      if (!res.ok) throw new Error('Quiz failed');
      const data = await res.json();
      setQuizQuestions(data.questions || []);
      setQuizChapterIdx(selectedChapterIndex);
    } catch {
      setQuizQuestions([]);
    } finally {
      setQuizLoading(false);
    }
  };

  const jumpToChapter = (index: number, scrollBehavior: ScrollBehavior = 'auto') => {
    const safeIndex = Math.min(Math.max(0, index), Math.max(chapters.length - 1, 0));
    setSelectedChapterIndex(safeIndex);
    setActiveDockPopup(null);
    // Scroll the main container to the target chapter article.
    setTimeout(() => {
      const container = mainScrollRef.current;
      const article = container?.querySelector(`#chapter-${safeIndex}`) as HTMLElement | null;
      const top = article ? article.offsetTop : 0;
      container?.scrollTo({ top, behavior: scrollBehavior });
      lastUserInteractionRef.current = Date.now();
    }, 0);
  };

  const goToPreviousChapter = () => {
    if (selectedChapterIndex <= 0) {
      return;
    }
    jumpToChapter(selectedChapterIndex - 1, 'smooth');
  };

  const goToNextChapter = () => {
    if (selectedChapterIndex >= chapters.length - 1) {
      return;
    }
    jumpToChapter(selectedChapterIndex + 1, 'smooth');
  };

  const keyHandlersRef = useRef({ goToNextChapter, goToPreviousChapter, onClose });
  keyHandlersRef.current = { goToNextChapter, goToPreviousChapter, onClose };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);

      if (isTypingTarget) {
        return;
      }

      if (event.key === 'PageDown') {
        event.preventDefault();
        const container = mainScrollRef.current;
        if (!container) {
          return;
        }

        lastUserInteractionRef.current = Date.now();
        container.scrollBy({ top: Math.max(120, container.clientHeight * 0.85), behavior: 'smooth' });
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        const container = mainScrollRef.current;
        if (!container) {
          return;
        }

        lastUserInteractionRef.current = Date.now();
        container.scrollBy({ top: -Math.max(120, container.clientHeight * 0.85), behavior: 'smooth' });
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        keyHandlersRef.current.goToNextChapter();
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        keyHandlersRef.current.goToPreviousChapter();
      }

      if (event.key === ' ') {
        event.preventDefault();
        setPlaybackState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        keyHandlersRef.current.onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const renderDockPopupContent = () => {
    if (activeDockPopup === 'tts') {
      return <TTSOptions ttsSettings={ttsSettings} onSettingsChange={setTtsSettings} />;
    }

    if (activeDockPopup === 'script') {
      return <ScriptDetails currentText={readerText} {...(activeChapter?.title != null ? { chapterTitle: activeChapter.title } : {})} />;
    }

    if (activeDockPopup === 'speaker') {
      return <SpeakerOptions ttsSettings={ttsSettings} onSettingsChange={setTtsSettings} />;
    }

    if (activeDockPopup === 'ambiance') {
      return <AmbiancePanel />;
    }

    if (activeDockPopup === 'summary') {
      const needsGeneration = summaryChapterIdx !== selectedChapterIndex && !summaryLoading;
      return (
        <div className="space-y-3">
          {needsGeneration && (
            <button
              onClick={generateSummary}
              className={`w-full rounded-xl px-3 py-2 text-xs font-medium transition ${palette.dockActionIdle} hover:opacity-80`}
            >
              <Sparkles size={14} className="inline mr-1" />
              Generate Summary
            </button>
          )}
          {summaryLoading && (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 size={14} className="animate-spin" />
              <span className={palette.muted}>Generating summary…</span>
            </div>
          )}
          {chapterSummary && summaryChapterIdx === selectedChapterIndex && (
            <div className={`prose prose-sm max-w-none text-xs leading-relaxed ${palette.panelText}`}>
              {chapterSummary.split('\n').map((line, i) => (
                <p key={i} className="mb-1">{line}</p>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeDockPopup === 'quiz') {
      const needsGeneration = quizChapterIdx !== selectedChapterIndex && !quizLoading;
      return (
        <div className="space-y-3">
          {needsGeneration && (
            <button
              onClick={generateQuiz}
              className={`w-full rounded-xl px-3 py-2 text-xs font-medium transition ${palette.dockActionIdle} hover:opacity-80`}
            >
              <Sparkles size={14} className="inline mr-1" />
              Generate Quiz
            </button>
          )}
          {quizLoading && (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 size={14} className="animate-spin" />
              <span className={palette.muted}>Generating quiz…</span>
            </div>
          )}
          {quizQuestions.length > 0 && quizChapterIdx === selectedChapterIndex && (
            <div className="space-y-4">
              {quizQuestions.map((q, qi) => (
                <div key={qi} className={`rounded-xl border p-3 ${palette.card}`}>
                  <p className={`text-xs font-semibold mb-2 ${palette.panelText}`}>{qi + 1}. {q.question}</p>
                  <div className="space-y-1">
                    {q.options.map((opt, oi) => {
                      const selected = quizAnswers[qi] === oi;
                      const isCorrect = oi === q.correctIndex;
                      const showResult = quizRevealed;
                      return (
                        <button
                          key={oi}
                          onClick={() => !quizRevealed && setQuizAnswers((prev) => ({ ...prev, [qi]: oi }))}
                          aria-pressed={selected}
                          className={`w-full text-left rounded-lg px-2 py-1.5 text-xs transition border ${
                            showResult && isCorrect
                              ? 'border-green-600/50 bg-green-600/10 text-green-700 dark:text-green-300'
                              : showResult && selected && !isCorrect
                                ? 'border-red-600/50 bg-red-600/10 text-red-700 dark:text-red-300'
                                : selected
                                  ? `${palette.choiceActive}`
                                  : `${palette.card} hover:opacity-80`
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {quizRevealed && (
                    <p className={`mt-2 text-xs italic ${palette.muted}`}>{q.explanation}</p>
                  )}
                </div>
              ))}
              {!quizRevealed && (
                <button
                  onClick={() => setQuizRevealed(true)}
                  disabled={Object.keys(quizAnswers).length < quizQuestions.length}
                  className={`w-full rounded-xl px-3 py-2 text-xs font-medium transition ${palette.dockActionIdle} hover:opacity-80 disabled:opacity-40`}
                >
                  Check Answers ({Object.keys(quizAnswers).length}/{quizQuestions.length})
                </button>
              )}
              {quizRevealed && (
                <p className={`text-center text-xs font-medium ${palette.accentText}`}>
                  Score: {quizQuestions.filter((q, i) => quizAnswers[i] === q.correctIndex).length}/{quizQuestions.length}
                </p>
              )}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const renderBookPopupContent = () => {
    if (bookPanelTab === 'chapters') {
      return (
        <div className="space-y-2">
          {chapterSearchOpen && (
            <div className={`sticky top-0 z-10 rounded-lg border p-2 backdrop-blur ${palette.sidebarSearchWrap}`}>
              <div className="flex items-center gap-2">
                <Search size={14} className={palette.iconMuted} />
                <input
                  value={chapterSearchQuery}
                  onChange={(event) => setChapterSearchQuery(event.target.value)}
                  placeholder="Search chapters..."
                  className={`w-full rounded-md border px-2 py-1.5 text-xs outline-none ${palette.sidebarSearchInput}`}
                />
                {chapterSearchQuery.trim() && (
                  <button
                    onClick={() => setChapterSearchQuery('')}
                    className={`rounded-md p-1 ${palette.iconMuted} ${palette.iconHover}`}
                    aria-label="Clear chapter search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {chapterSearchQuery.trim() && (
                <p className={`mt-1.5 text-[10px] ${palette.muted}`}>
                  {filteredChapters.length} of {chapters.length} chapters
                </p>
              )}
            </div>
          )}

          {filteredChapters.map((chapter) => (
            <button
              key={`${chapter.index}-${chapter.start}`}
              onClick={() => jumpToChapter(chapter.index)}
              className={`w-full rounded-lg border p-2 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                selectedChapterIndex === chapter.index
                  ? `${palette.selected} border-transparent`
                  : `${palette.card} ${palette.hover}`
              }`}
            >
              <p className="text-xs font-semibold">
                {bookmarks.includes(chapter.index) && <BookmarkCheck size={12} className="inline mr-1 text-yellow-400" />}
                Chapter {chapter.index + 1}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs opacity-90">{chapter.title}</p>
            </button>
          ))}

          {filteredChapters.length === 0 && chapterSearchQuery.trim() && (
            <p className={`rounded-md border p-3 text-xs ${palette.card}`}>
              No chapters found for &quot;{chapterSearchQuery.trim()}&quot;.
            </p>
          )}

          {chapters.length === 0 && !chapterSearchQuery.trim() && (
            <p className={`rounded-md border p-3 text-xs ${palette.card}`}>
              No chapters available.
            </p>
          )}
        </div>
      );
    }

    if (bookPanelTab === 'settings') {
      return (
        <div className="space-y-5 text-xs">
          <div>
            <p className="mb-2 font-semibold">Background</p>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'sepia', 'dark'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSettings((prev) => ({ ...prev, background: mode }))}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${
                    settings.background === mode ? palette.choiceActive : palette.choiceIdle
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 font-semibold">Font</p>
            <div className="grid grid-cols-2 gap-2">
              {(['serif', 'sans'] as const).map((font) => (
                <button
                  key={font}
                  onClick={() => setSettings((prev) => ({ ...prev, font }))}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${
                    settings.font === font ? palette.choiceActive : palette.choiceIdle
                  } ${font === 'serif' ? 'font-serif' : 'font-sans'}`}
                >
                  {font}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold">Translation</p>
              {translationLoading && <span className={`text-[11px] ${palette.muted}`}>Translating...</span>}
            </div>
            <label className={`flex items-center gap-2 rounded-md border px-3 py-2 ${palette.card}`}>
              <input
                type="checkbox"
                checked={translationEnabled}
                onChange={(event) => setTranslationEnabled(event.target.checked)}
                className="h-4 w-4"
              />
              <span>Translate this page</span>
            </label>
            <select
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
              disabled={!translationEnabled}
              title="Translation language"
              aria-label="Translation language"
              className={`mt-2 w-full rounded-md border px-3 py-2 text-xs outline-none disabled:opacity-60 ${palette.input}`}
            >
              {TRANSLATION_LANGUAGE_OPTIONS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
            {translationError && <p className="mt-2 text-[11px] text-rose-500">{translationError}</p>}
          </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Text size</p>
                <span className={`font-semibold ${palette.accentText}`}>{settings.fontSize}px</span>
              </div>
              <input
                type="range"
              min={14}
              max={28}
              value={settings.fontSize}
              title="Text size"
              aria-label="Text size"
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, fontSize: Number(event.target.value) }))
              }
              className="dock-slider"
            />
          </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Line height</p>
                <span className={`font-semibold ${palette.accentText}`}>{settings.lineHeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
              min={1.3}
              max={2.2}
              step={0.05}
              value={settings.lineHeight}
              title="Line height"
              aria-label="Line height"
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, lineHeight: Number(event.target.value) }))
              }
              className="dock-slider"
            />
          </div>

          <div className={`rounded-md border p-3 ${palette.card}`}>
            <p className="mb-2 font-semibold">Reading Stats</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className={palette.muted}>Chapters</p>
                <p className="font-semibold">{selectedChapterIndex + 1} / {chapters.length || 1}</p>
              </div>
              <div>
                <p className={palette.muted}>Progress</p>
                <p className="font-semibold">{readerProgress.toFixed(1)}%</p>
              </div>
              <div>
                <p className={palette.muted}>Words (chapter)</p>
                <p className="font-semibold">{readerText ? readerText.split(/\s+/).length.toLocaleString() : 0}</p>
              </div>
              <div>
                <p className={palette.muted}>Est. reading time</p>
                <p className="font-semibold">{readerText ? Math.max(1, Math.ceil(readerText.split(/\s+/).length / 250)) : 0} min</p>
              </div>
              <div>
                <p className={palette.muted}>Bookmarks</p>
                <p className="font-semibold">{bookmarks.length}</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div>
          <p className={`text-xs font-semibold ${palette.accentText}`}>
            {activeChapter?.title || 'Current chapter'}
          </p>
          <textarea
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Share a thought about this chapter..."
            className={`mt-2 min-h-24 w-full rounded-md border px-3 py-2 text-xs ${palette.input}`}
          />
          <button
            onClick={submitComment}
            disabled={submittingComment || !commentDraft.trim()}
            className={`mt-2 w-full rounded-md px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${palette.primaryButton}`}
          >
            {submittingComment ? 'Posting...' : 'Post chapter comment'}
          </button>
        </div>

        <div className="space-y-2">
          {chapterComments.length === 0 ? (
            <p className={`rounded-md border p-3 text-xs ${palette.card}`}>No comments for this chapter yet.</p>
          ) : (
            chapterComments.map((comment) => (
              <div key={comment.id} className={`rounded-md border p-3 text-xs ${palette.card}`}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{comment.userLabel}</p>
                  <p className={palette.muted}>{formatDate(comment.createdAt)}</p>
                </div>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{comment.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="reader-root"
      data-vf-reader-theme={settings.background}
      className={`fixed inset-0 z-[100] flex flex-col ${palette.shell} relative`}
      style={sliderCssVars}
    >
      {/* Floating Back Button - Always Visible in Top Left */}
      <button
        onClick={onClose}
        className="fixed top-3 left-3 z-[101] flex items-center justify-center rounded-full p-2 backdrop-blur-sm transition-all hover:bg-white/10 active:bg-white/20"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
        aria-label="Back button"
        title="Go back"
      >
        <ArrowLeft size={18} className="text-white" />
      </button>

      <header
        className={`fixed inset-x-0 top-0 z-[102] flex h-14 items-center justify-between border-b px-4 backdrop-blur-xl ${palette.header}`}
        style={{
          background:
            settings.background === 'dark'
              ? 'rgba(15, 23, 42, 0.45)'
              : settings.background === 'sepia'
                ? 'rgba(239, 224, 199, 0.72)'
                : 'rgba(233, 240, 255, 0.72)',
        }}
      >
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold hover:bg-black/10"
        >
          <ArrowLeft size={16} />
          Exit
        </button>

        <div className="min-w-0 flex-1 px-4 text-center">
          <h1 className="truncate text-sm font-semibold">{book.title}</h1>
          <p className={`truncate text-[11px] ${palette.muted}`}>{getAuthorLabel(book)}</p>
        </div>

        <div className="text-right">
          <div className="mb-1 flex items-center justify-end gap-1.5">
            <button
              onClick={() => toggleBookmark(selectedChapterIndex)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${palette.choiceIdle}`}
              aria-label={bookmarks.includes(selectedChapterIndex) ? 'Remove bookmark' : 'Add bookmark'}
              title={bookmarks.includes(selectedChapterIndex) ? 'Remove bookmark' : 'Bookmark this chapter'}
            >
              {bookmarks.includes(selectedChapterIndex) ? <BookmarkCheck size={14} className="text-yellow-400" /> : <Bookmark size={14} />}
            </button>
            <button
              onClick={goToPreviousChapter}
              disabled={selectedChapterIndex <= 0}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${palette.choiceIdle} disabled:opacity-35`}
              aria-label="Previous chapter"
              title="Previous chapter"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={goToNextChapter}
              disabled={selectedChapterIndex >= chapters.length - 1}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${palette.choiceIdle} disabled:opacity-35`}
              aria-label="Next chapter"
              title="Next chapter"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <p className="text-xs font-semibold">{readerProgress.toFixed(2)}%</p>
          <p className={`text-[11px] ${palette.muted}`}>Chapter {selectedChapterIndex + 1}/{Math.max(chapters.length, 1)}</p>
        </div>
      </header>

      {/* Reading progress bar */}
      <div className="fixed inset-x-0 top-14 z-[101] h-0.5 bg-black/10">
        <div
          role="progressbar"
          aria-valuenow={Math.round(readerProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading progress"
          className="h-full transition-all duration-300"
          style={{ width: `${readerProgress}%`, backgroundColor: 'var(--vf-reader-accent-text)' }}
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <main
          ref={mainScrollRef}
          className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-20 pb-44 md:px-10 md:pt-20 md:pb-48"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className={`mx-auto mb-2 h-6 w-6 animate-spin ${palette.accentText}`} />
                <p className={`text-sm ${palette.muted}`}>Loading book text...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <div className={`max-w-xl rounded-xl border p-6 text-center ${palette.card}`}>
                <p className="text-sm font-semibold text-rose-600">Unable to load content</p>
                <p className={`mt-2 text-xs ${palette.muted}`}>{error}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-10">
              {chapters.map((chapter, chIdx) => {
                const isActive = chIdx === selectedChapterIndex;
                const chapterParagraphs = (chapter.text || '')
                  .split(/\n{2,}/)
                  .map((p: string) => p.trim())
                  .filter(Boolean);

                return (
                  <article
                    key={chIdx}
                    id={`chapter-${chIdx}`}
                    className={`mx-auto max-w-3xl rounded-2xl border p-6 md:p-8 ${palette.card} ${
                      settings.font === 'serif' ? 'font-serif' : 'font-sans'
                    }`}
                    style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}
                  >
                    <p className={`mb-2 text-center text-xs font-semibold uppercase tracking-wide ${palette.accentText}`}>
                      Chapter {chIdx + 1}
                    </p>
                    <h2 className="mb-5 text-center text-xl font-bold leading-tight">{chapter.title || 'Reading'}</h2>
                    {isActive && translationEnabled && (
                      <p className={`mb-5 text-center text-[11px] ${translationLoading ? palette.muted : palette.accentText}`}>
                        {translationLoading
                          ? `Translating to ${selectedTranslationLanguage?.label ?? 'Unknown'}...`
                          : `Translated to ${selectedTranslationLanguage?.label ?? 'Unknown'}`}
                      </p>
                    )}
                    {isActive && translationError && <p className="mb-4 text-center text-xs text-rose-500">{translationError}</p>}
                    <div className="space-y-4 text-left leading-relaxed [text-wrap:pretty]">
                      {isActive && formattedReaderParagraphs.length > 0 ? (
                        formattedReaderParagraphs.map((paragraph, index) => {
                          const tokens = paragraphTokens[index] || [];
                          let globalStart = 0;
                          for (let i = 0; i < index; i++) globalStart += paragraphTokenCounts[i] || 0;

                          return (
                            <p
                              key={`${chIdx}-${index}`}
                              className="break-words first-letter:pl-0 whitespace-pre-wrap"
                            >
                              {tokens.map((tok: string, tIdx: number) => {
                                const globalIdx = globalStart + tIdx;
                                const key = `p-${index}-t-${tIdx}`;
                                const inActiveSentence =
                                  activeSentence && globalIdx >= activeSentence.globalStart && globalIdx <= activeSentence.globalEnd;

                                if (/^\s+$/.test(tok)) {
                                  return <span key={key}>{tok}</span>;
                                }

                                return (
                                  <span
                                    id={`token-${globalIdx}`}
                                    key={key}
                                    className={inActiveSentence ? 'bg-yellow-300/30 rounded-sm font-semibold' : undefined}
                                  >
                                    {tok}
                                  </span>
                                );
                              })}
                            </p>
                          );
                        })
                      ) : (
                        chapterParagraphs.map((para, pIdx) => (
                          <p key={`${chIdx}-plain-${pIdx}`} className="break-words whitespace-pre-wrap">{para}</p>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Right Sidebar Trigger */}
      <div className="pointer-events-none fixed right-3 top-1/2 z-[90] -translate-y-1/2">
        <button
          onClick={() => {
            if (activeBookPopup) {
              setActiveBookPopup(null);
              return;
            }
            setBookPanelTab('chapters');
            setActiveBookPopup('chapters');
          }}
          className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border transition backdrop-blur-xl ${
            activeBookPopup ? palette.sidebarTriggerActive : palette.sidebarTriggerIdle
          }`}
          aria-label="Open chapters"
          title="Open reader panel"
        >
          <List size={18} />
        </button>
      </div>

      {/* Right Sidebar Popup */}
      {activeBookPopup && (
        <div
          ref={sidebarPopupRef}
          data-testid="reader-sidebar-popup"
          className="pointer-events-auto fixed right-3 top-1/2 z-[91] w-[min(90vw,380px)] -translate-y-1/2 sm:right-16"
        >
          <div
            className={`pointer-events-auto rounded-2xl border p-3 shadow-2xl backdrop-blur-xl ${palette.sidebarPopup}`}
              style={{
                background: `linear-gradient(to bottom right, var(--vf-reader-sidebar-popup-from), var(--vf-reader-sidebar-popup-to))`,
                boxShadow: settings.background === 'dark'
                  ? 'rgba(15, 20, 25, 0.65) 0 10px 35px'
                  : settings.background === 'sepia'
                  ? 'rgba(158, 128, 94, 0.45) 0 10px 35px'
                  : 'rgba(139, 166, 214, 0.35) 0 10px 35px',
              }}
          >
            <div className={`mb-3 flex items-center justify-between border-b pb-2 ${palette.sidebarHeaderBorder}`}>
              <div className={`flex items-center gap-1.5 rounded-lg p-1.5 ${palette.sidebarTabsWrap}`}>
                <button
                  onClick={() => setBookPanelTab('chapters')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition ${
                    bookPanelTab === 'chapters' ? palette.sidebarTabActive : palette.sidebarTabIdle
                  }`}
                >
                  <List size={13} />
                  Chapters
                </button>
                <button
                  onClick={() => {
                    setBookPanelTab('chapters');
                    setChapterSearchOpen((prev) => {
                      const next = !prev;
                      if (!next) {
                        setChapterSearchQuery('');
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold ${
                    chapterSearchOpen ? palette.sidebarTabActive : palette.sidebarTabIdle
                  }`}
                  aria-label="Toggle chapter search"
                  title="Search chapters"
                >
                  <Search size={13} />
                </button>
                <button
                  onClick={() => setBookPanelTab('settings')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition ${
                    bookPanelTab === 'settings' ? palette.sidebarTabActive : palette.sidebarTabIdle
                  }`}
                >
                  <SettingsIcon size={13} />
                  Settings
                </button>
                <button
                  onClick={() => setBookPanelTab('comments')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition ${
                    bookPanelTab === 'comments' ? palette.sidebarTabActive : palette.sidebarTabIdle
                  }`}
                >
                  <MessageSquare size={13} />
                  Comments
                </button>
              </div>
              <button
                onClick={() => setActiveBookPopup(null)}
                className={`rounded-md p-1 transition ${palette.iconMuted} ${palette.iconHover}`}
                data-testid="reader-sidebar-popup-close"
                aria-label="Close sidebar popup"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
            <div className={`no-scrollbar max-h-[65vh] overflow-y-auto pr-2 ${palette.panelText}`}>
              {renderBookPopupContent()}
            </div>
          </div>
        </div>
      )}

      {/* Dock Popup */}
      {activeDockPopup && (
        <div
          ref={dockPopupRef}
          data-testid="reader-dock-popup"
          className="pointer-events-auto fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-[95] flex justify-center px-2 md:px-4"
        >
          <div className="pointer-events-auto w-full max-w-[min(94vw,420px)]">
            <div className={`rounded-2xl border p-3 shadow-2xl backdrop-blur-lg ${palette.dockPopup}`}>
              <div
                className={`mb-3 flex items-center justify-between border-b pb-2 ${palette.dockPopupHeaderBorder}`}
              >
                <p className={`text-xs font-semibold uppercase tracking-wide ${palette.muted}`}>
                  {activeDockPopup === 'tts'
                    ? 'Voice Settings'
                    : activeDockPopup === 'script'
                      ? 'Script Details'
                      : activeDockPopup === 'speaker'
                        ? 'Playback Device'
                        : activeDockPopup === 'summary'
                          ? 'Chapter Summary'
                          : activeDockPopup === 'quiz'
                            ? 'Reading Quiz'
                            : 'Ambiance'}
                </p>
                <button
                  onClick={() => setActiveDockPopup(null)}
                  className={`rounded-md p-1 transition ${palette.iconMuted} ${palette.iconHover}`}
                  data-testid="reader-dock-popup-close"
                  aria-label="Close popup"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="no-scrollbar max-h-[50vh] overflow-y-auto pr-2">
                {renderDockPopupContent()}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        data-testid="reader-dock"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-1.5 sm:px-3 sm:pt-2"
      >
        <div className="pointer-events-auto relative w-full max-w-[min(98vw,1100px)]">
          <div className={`rounded-[26px] border px-2 py-2 sm:px-2.5 sm:py-2.5 md:px-3 md:py-3 backdrop-blur-xl ${palette.dockShell}`}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              {!dockCollapsed ? (
              <div className="min-w-0 lg:flex-1">
                <MiniPlayer
                  playbackState={playbackState}
                  ttsSettings={effectiveTtsSettings}
                  bookText={visibleReaderText}
                  onStateChange={setPlaybackState}
                  isCompact
                  theme={settings.background}
                />
              </div>
              ) : (
              <div className="flex items-center gap-2 px-2 py-1">
                <div className={`text-xs font-medium ${palette.accentText}`}>
                  Chunk {playbackState.totalChunks ? playbackState.currentChunkIndex + 1 : 0}/{playbackState.totalChunks || 1}
                </div>
                <div className={`text-xs ${palette.muted}`}>Ready to resume</div>
              </div>
              )}

              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5 lg:flex-shrink-0">
                {!dockCollapsed && (
                  <>
                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'tts' ? null : 'tts'))}
                  data-testid="dock-action-tts"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'tts' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Voice settings"
                >
                  <Volume2 size={13} />
                  <span className="hidden sm:inline">Voice</span>
                </button>

                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'script' ? null : 'script'))}
                  data-testid="dock-action-script"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'script' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Script details"
                >
                  <FileText size={13} />
                  <span className="hidden sm:inline">Script</span>
                </button>

                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'speaker' ? null : 'speaker'))}
                  data-testid="dock-action-speaker"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'speaker' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Playback device"
                >
                  <Speaker size={13} />
                  <span className="hidden sm:inline">Device</span>
                </button>

                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'ambiance' ? null : 'ambiance'))}
                  data-testid="dock-action-ambiance"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'ambiance' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Ambiance settings"
                >
                  <Music size={13} />
                  <span className="hidden sm:inline">Ambiance</span>
                </button>

                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'summary' ? null : 'summary'))}
                  data-testid="dock-action-summary"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'summary' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Chapter summary"
                >
                  <Sparkles size={13} />
                  <span className="hidden sm:inline">Summary</span>
                </button>

                <button
                  onClick={() => setActiveDockPopup((prev) => (prev === 'quiz' ? null : 'quiz'))}
                  data-testid="dock-action-quiz"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${
                    activeDockPopup === 'quiz' ? palette.dockActionActive : palette.dockActionIdle
                  }`}
                  title="Reading quiz"
                >
                  <GraduationCap size={13} />
                  <span className="hidden sm:inline">Quiz</span>
                </button>
                  </>
                )}
                <button
                  onClick={() => setDockCollapsed((prev) => !prev)}
                  className={`inline-flex items-center gap-0.5 sm:gap-1 rounded-full border px-1.5 sm:px-2 md:px-2.5 py-1 sm:py-1.5 text-xs font-semibold transition flex-shrink-0 ${palette.dockActionIdle}`}
                  title={dockCollapsed ? 'Expand dock' : 'Collapse dock'}
                  aria-label={dockCollapsed ? 'Expand dock' : 'Collapse dock'}
                >
                  {dockCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
