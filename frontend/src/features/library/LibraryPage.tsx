'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Heart, Play, Mic } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { GenerationSettings } from '../../../types';
import { APP_ROUTE_PATHS } from '../../app/navigation';
import { readStorageJson, writeStorageString } from '../../shared/storage/localStore';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { BookCard } from './components/BookCard';
import { BookDetail } from './components/BookDetail';
import {
  buildLibraryReadHref,
  fetchBooks,
  getBookCover,
  rememberSelectedLibraryBook,
} from './services/bookDiscoveryService';
import type { Book, LanguageCode } from './model/types';

const AILibrarian = dynamic(
  () => import('./components/AILibrarian').then((m) => ({ default: m.AILibrarian })),
  { ssr: false },
);

const NovelWriterSurface = dynamic(
  () => import('../novel/components/NovelTabContent').then((m) => ({ default: m.NovelTabContent })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[480px] items-center justify-center rounded-[1.5rem] border border-white/10 bg-white/[0.04]">
        <div className="flex items-center gap-2 text-sm text-white/65">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading writer workspace...
        </div>
      </div>
    ),
  },
);

type SubNav = 'browse' | 'favorites' | 'writer' | 'chat';

type WriterToastState = {
  message: string;
  type: 'success' | 'error' | 'info';
};

const LIBRARY_FAVORITES_KEY = 'vf-library-favorites';
const LIBRARY_LAST_PLAYED_KEY = 'vf-library-last-played';

const FALLBACK_WRITER_SETTINGS: GenerationSettings = {
  voiceId: '',
  speed: 1,
  pitch: 'Medium',
  language: 'Auto',
  emotion: 'Neutral',
  style: 'default',
  engine: 'PRIME',
  helperProvider: 'GEMINI',
  assistantProviderControlsEnabled: true,
  musicTrackId: '',
  musicVolume: 0.18,
  speechVolume: 1,
  autoEnhance: true,
  useModelSourceSeparation: false,
  preserveDubVoiceTone: true,
  multiSpeakerEnabled: true,
  uiMotionLevel: 'balanced',
  autoPlayGeneratedAudio: false,
};

const GENRES = [
  'all',
  'fiction',
  'adventure',
  'romance',
  'mystery',
  'science fiction',
  'fantasy',
  'horror',
  'poetry',
  'philosophy',
  'history',
] as const;

const LANGUAGES: { value: LanguageCode; label: string }[] = [
  { value: 'all', label: 'All Languages' },
  { value: 'en', label: 'English' },
];

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg overflow-hidden">
      <div className="aspect-[2/3] bg-white/10 rounded-lg" />
      <div className="mt-2 space-y-1.5 px-0.5">
        <div className="h-3 bg-white/10 rounded w-3/4" />
        <div className="h-2.5 bg-white/10 rounded w-1/2" />
      </div>
    </div>
  );
}

export function LibraryPage() {
  const [tab, setTab] = useState<SubNav>('browse');
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('all');
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [favorites, setFavorites] = useState<Set<string | number>>(new Set());
  const [lastPlayed, setLastPlayed] = useState<Book | null>(null);
  const [writerSettings, setWriterSettings] = useState<GenerationSettings>(FALLBACK_WRITER_SETTINGS);
  const [writerToast, setWriterToast] = useState<WriterToastState | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIBRARY_FAVORITES_KEY);
      if (raw) {
        const ids: (string | number)[] = JSON.parse(raw);
        setFavorites(new Set(ids));
      }
    } catch { /* ignore */ }

    try {
      const raw = localStorage.getItem(LIBRARY_LAST_PLAYED_KEY);
      if (raw) setLastPlayed(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const storedSettings = readStorageJson<Partial<GenerationSettings>>(STORAGE_KEYS.settings);
    if (!storedSettings) return;
    setWriterSettings({
      ...FALLBACK_WRITER_SETTINGS,
      ...storedSettings,
    });
  }, []);

  useEffect(() => {
    if (!writerToast) return undefined;
    const timer = window.setTimeout(() => setWriterToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [writerToast]);

  // Persist favorites
  const saveFavorites = useCallback((next: Set<string | number>) => {
    setFavorites(next);
    try {
      localStorage.setItem(LIBRARY_FAVORITES_KEY, JSON.stringify([...next]));
    } catch { /* ignore */ }
  }, []);

  const toggleFavorite = useCallback(
    (e: React.MouseEvent, book: Book) => {
      e.stopPropagation();
      const next = new Set(favorites);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      saveFavorites(next);
    },
    [favorites, saveFavorites],
  );

  // Fetch books with debounced search
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const opts: { sort: string; languages: LanguageCode; search?: string; topic?: string } = {
          sort: 'popular',
          languages: language,
        };
        if (searchRef.current) opts.search = searchRef.current;
        if (genre !== 'all') opts.topic = genre;
        const response = await fetchBooks(opts);
        setBooks(response.results ?? []);
      } catch {
        setBooks([]);
      } finally {
        setLoading(false);
      }
    };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, search ? 250 : 0);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, genre, language]);

  const handleRead = useCallback((book: Book) => {
    try {
      localStorage.setItem(LIBRARY_LAST_PLAYED_KEY, JSON.stringify(book));
    } catch { /* ignore */ }
    rememberSelectedLibraryBook(book);
    window.location.assign(buildLibraryReadHref(book));
  }, []);

  const handleWriterToast = useCallback((message: string, type: WriterToastState['type'] = 'info') => {
    setWriterToast({ message, type });
  }, []);

  const handleStudioSwitch = useCallback((content: string) => {
    const draft = String(content || '').trim();
    if (!draft) {
      handleWriterToast('Add some chapter text before sending it to Studio.', 'error');
      return;
    }
    writeStorageString(STORAGE_KEYS.studioDraftText, draft);
    window.location.assign(APP_ROUTE_PATHS.studio);
  }, [handleWriterToast]);

  const favBooks = books.filter((b) => favorites.has(b.id));

  return (
    <div
      className="min-h-screen p-4 md:p-6 lg:p-8"
      style={{ background: 'var(--vf-bg)', color: 'var(--vf-text)' }}
    >
      <div className="mb-5 flex flex-col gap-2">
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-300/80">Readers</p>
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold text-white sm:text-2xl">Browse books, save favorites, and step into Writer without leaving Readers.</h1>
          <p className="mt-1.5 text-sm leading-6 text-white/55">
            Keep discovery, reading history, and your novel workspace connected in one place.
          </p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div
        className="mb-6 flex items-center justify-between gap-3 border-b border-white/10 pb-2"
        data-testid="readers-subnav"
      >
        <div className="flex items-center gap-1">
          {([
            { key: 'browse', label: 'Browse' },
            { key: 'favorites', label: 'Favorites' },
            { key: 'writer', label: 'Writer' },
            { key: 'chat', label: 'AI Chat' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === key
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-white/60 hover:text-white/80'
              }`}
              data-testid={key === 'writer' ? 'readers-writer-trigger' : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'writer' ? (
          <button
            type="button"
            onClick={() => window.location.assign(APP_ROUTE_PATHS.studio)}
            aria-label="Switch to Studio"
            title="Switch to Studio"
            data-testid="readers-studio-switch"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-cyan-400/30 bg-[linear-gradient(180deg,rgba(9,26,43,0.94),rgba(8,18,32,0.92))] px-3.5 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100 shadow-[0_10px_26px_rgba(8,145,178,0.16)] transition hover:border-cyan-300/45 hover:bg-[linear-gradient(180deg,rgba(10,34,56,0.98),rgba(8,24,40,0.95))] hover:text-white"
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Studio</span>
          </button>
        ) : null}
      </div>

      {/* Browse tab */}
      {tab === 'browse' && (
        <>
          {/* Last Played resume card */}
          {lastPlayed && (
            <button
              onClick={() => handleRead(lastPlayed)}
              className="w-full mb-6 flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
            >
              <div className="w-12 h-16 rounded-md overflow-hidden bg-white/10 flex-shrink-0">
                <img
                  src={getBookCover(lastPlayed)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/50 uppercase tracking-wider">Continue reading</p>
                <p className="text-sm font-medium truncate">{lastPlayed.title}</p>
              </div>
              <Play className="h-5 w-5 text-blue-400 flex-shrink-0" />
            </button>
          )}

          {/* Search & filters */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="text"
                placeholder="Search books…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-white/10 text-sm placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50"
            >
              {GENRES.map((g) => (
                <option key={g} value={g} className="bg-gray-900">
                  {g === 'all' ? 'All Genres' : g.charAt(0).toUpperCase() + g.slice(1)}
                </option>
              ))}
            </select>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="px-3 py-2 rounded-lg bg-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value} className="bg-gray-900">
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Book grid */}
          {loading ? (
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {Array.from({ length: 16 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : books.length === 0 ? (
            <p className="text-center text-white/50 py-20">No books found</p>
          ) : (
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {books.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onClick={setSelectedBook}
                  isFavorite={favorites.has(book.id)}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Favorites tab */}
      {tab === 'favorites' && (
        <>
          {favBooks.length === 0 ? (
            <div className="text-center py-20">
              <Heart className="h-10 w-10 mx-auto mb-3 text-white/20" />
              <p className="text-white/50">No favorites yet</p>
              <p className="text-white/30 text-sm mt-1">
                Browse books and tap the heart to save them here
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
              {favBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  onClick={setSelectedBook}
                  isFavorite
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Writer tab */}
      {tab === 'writer' && (
        <div
          className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,27,0.92),rgba(8,13,24,0.78))]"
          data-testid="readers-writer-tab"
        >
          <div className="border-b border-white/10 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300/70">Writer</p>
                <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">Draft novels here, then hand chapters to Studio when they are ready for audio.</h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55">
                Readers keeps writing progress and discovery in one workflow.
              </div>
            </div>
            {writerToast ? (
              <div
                className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${
                  writerToast.type === 'error'
                    ? 'border-rose-300/30 bg-rose-400/10 text-rose-100'
                    : writerToast.type === 'success'
                      ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'
                      : 'border-cyan-300/25 bg-cyan-400/10 text-cyan-100'
                }`}
              >
                {writerToast.message}
              </div>
            ) : null}
          </div>
          <div className="min-h-[72vh]" data-testid="embedded-writer-surface">
            <NovelWriterSurface
              settings={writerSettings}
              onToast={handleWriterToast}
              onSendToStudio={handleStudioSwitch}
              embeddedMode
            />
          </div>
        </div>
      )}

      {/* AI Chat tab */}
      {tab === 'chat' && <AILibrarian />}

      {/* Book detail modal */}
      {selectedBook && (
        <BookDetail
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          isFavorite={favorites.has(selectedBook.id)}
          onToggleFavorite={(b) => {
            const next = new Set(favorites);
            if (next.has(b.id)) next.delete(b.id);
            else next.add(b.id);
            saveFavorites(next);
          }}
          onRead={handleRead}
        />
      )}
    </div>
  );
}
