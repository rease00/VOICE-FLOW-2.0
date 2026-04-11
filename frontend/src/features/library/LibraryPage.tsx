'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Heart, Play } from 'lucide-react';
import dynamic from 'next/dynamic';
import { BookCard } from './components/BookCard';
import { BookDetail } from './components/BookDetail';
import { fetchBooks, getBookCover } from './services/bookDiscoveryService';
import type { Book, LanguageCode } from './model/types';

const AILibrarian = dynamic(
  () => import('./components/AILibrarian').then((m) => ({ default: m.AILibrarian })),
  { ssr: false },
);

type SubNav = 'browse' | 'favorites' | 'chat';

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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('vf-library-favorites');
      if (raw) {
        const ids: (string | number)[] = JSON.parse(raw);
        setFavorites(new Set(ids));
      }
    } catch { /* ignore */ }

    try {
      const raw = localStorage.getItem('vf-library-last-played');
      if (raw) setLastPlayed(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Persist favorites
  const saveFavorites = useCallback((next: Set<string | number>) => {
    setFavorites(next);
    try {
      localStorage.setItem('vf-library-favorites', JSON.stringify([...next]));
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
      localStorage.setItem('vf-library-last-played', JSON.stringify(book));
    } catch { /* ignore */ }
    window.location.href = `/app/library/${book.id}/read`;
  }, []);

  const favBooks = books.filter((b) => favorites.has(b.id));

  return (
    <div
      className="min-h-screen p-4 md:p-6 lg:p-8"
      style={{ background: 'var(--vf-bg)', color: 'var(--vf-text)' }}
    >
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 mb-6 border-b border-white/10 pb-2">
        {([
          { key: 'browse', label: 'Browse' },
          { key: 'favorites', label: 'Favorites' },
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
          >
            {label}
          </button>
        ))}
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
