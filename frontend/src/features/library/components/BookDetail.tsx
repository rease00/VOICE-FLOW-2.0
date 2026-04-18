'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  X,
  Heart,
  Share2,
  Sparkles,
  Info,
  Loader2,
  BookOpenText,
  Download,
} from 'lucide-react';
import type { Book } from '../model/types';
import { getBookCover, getBookDownloadLink } from '../services/bookDiscoveryService';

interface BookDetailProps {
  book: Book;
  onClose: () => void;
  isFavorite: boolean;
  onToggleFavorite: (book: Book) => void;
  onRead: (book: Book) => void;
  isOffline?: boolean;
  onAnalyze?: (title: string, authors: string) => Promise<string | null>;
  onSaveOffline?: (book: Book) => Promise<void>;
  onDeleteOffline?: (bookId: string | number) => Promise<void>;
  onOfflineChange?: () => void;
}

export const BookDetail: React.FC<BookDetailProps> = ({
  book,
  onClose,
  isFavorite,
  onToggleFavorite,
  onRead,
  isOffline = false,
  onAnalyze,
  onSaveOffline,
  onDeleteOffline,
  onOfflineChange,
}) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOffline, setSavedOffline] = useState(isOffline);
  const [saveError, setSaveError] = useState<string | null>(null);

  const coverUrl = getBookCover(book);
  const authors =
    (book.authors ?? [])
      .map((a) => a.name.split(',').reverse().join(' ').trim())
      .join(', ') || 'Unknown Author';
  const htmlLink = getBookDownloadLink(book, 'html');
  const txtLink = getBookDownloadLink(book, 'txt');
  const canReadOnline = !!(htmlLink || txtLink);

  useEffect(() => {
    setSavedOffline(isOffline);
  }, [isOffline]);

  const handleAnalyze = async () => {
    if (!onAnalyze) return;
    setAnalyzing(true);
    const result = await onAnalyze(book.title, authors);
    setAnalysis(result);
    setAnalyzing(false);
  };

  const handleSaveOffline = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (savedOffline && onDeleteOffline) {
        await onDeleteOffline(book.id);
        setSavedOffline(false);
      } else if (onSaveOffline) {
        await onSaveOffline(book);
        setSavedOffline(true);
      }
      onOfflineChange?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save book.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-5xl h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row relative
                   bg-[color:var(--vf-color-bg)] border border-[color:var(--vf-color-border)]"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full
                     bg-[color:var(--vf-color-surface)]/80 hover:bg-[color:var(--vf-color-surface-2)]
                     text-[color:var(--vf-color-text-muted)] transition-colors shadow-sm backdrop-blur-sm"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Left Column: Image & Actions */}
        <div
          className="w-full md:w-1/3 p-8 flex flex-col items-center justify-start overflow-y-auto
                     bg-[color:var(--vf-color-bg-deep)] border-r border-[color:var(--vf-color-border)]"
        >
          <div className="aspect-[2/3] w-48 md:w-full max-w-[280px] shadow-xl rounded-lg overflow-hidden mb-6 rotate-1 hover:rotate-0 transition-transform duration-500">
            <div className="relative h-full w-full">
              <Image
                src={coverUrl}
                alt={book.title}
                fill
                sizes="(max-width: 768px) 192px, 280px"
                unoptimized
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>

          <div className="flex gap-3 w-full max-w-[280px] mb-6">
            <button
              onClick={() => onToggleFavorite(book)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border font-medium transition-all ${
                isFavorite
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-[color:var(--vf-color-surface)] border-[color:var(--vf-color-border)] text-[color:var(--vf-color-text-muted)] hover:border-[color:var(--vf-accent-secondary)]'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              {isFavorite ? 'Saved' : 'Save'}
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[color:var(--vf-color-border)] bg-[color:var(--vf-color-surface)] text-[color:var(--vf-color-text-muted)] hover:border-[color:var(--vf-accent-secondary)] font-medium transition-all">
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>

          <div className="w-full max-w-[280px] space-y-3">
            <h3 className="font-semibold text-[color:var(--vf-color-text)] mb-1">
              Actions
            </h3>
            {canReadOnline ? (
              <button
                onClick={() => onRead(book)}
                className="flex items-center justify-center gap-2 w-full py-3 px-4
                           bg-[color:var(--vf-accent-secondary)] text-white text-center rounded-lg
                           hover:brightness-110 transition-all font-medium shadow-sm hover:shadow-md"
              >
                <BookOpenText className="w-4 h-4" />
                {book.source === 'openlibrary' ? 'Read / Preview' : 'Read Online'}
              </button>
            ) : (
              <div className="w-full py-3 px-4 bg-[color:var(--vf-color-surface-2)] text-[color:var(--vf-color-text-muted)] text-center rounded-lg font-medium cursor-not-allowed">
                Read Online Unavailable
              </div>
            )}
            {canReadOnline && (
              <button
                onClick={handleSaveOffline}
                disabled={saving}
                className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-lg font-medium transition-colors shadow-sm hover:shadow-md ${
                  savedOffline
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400'
                    : 'bg-[color:var(--vf-color-surface)] border border-[color:var(--vf-color-border)] text-[color:var(--vf-color-text-muted)] hover:bg-[color:var(--vf-color-surface-2)]'
                } disabled:opacity-60`}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {saving
                  ? 'Saving...'
                  : savedOffline
                    ? 'Saved Offline ✓'
                    : 'Save for Offline'}
              </button>
            )}
            {saveError && (
              <p className="text-xs text-red-400 text-center">{saveError}</p>
            )}
            {book.source === 'openlibrary' && (
              <p className="text-xs text-center text-[color:var(--vf-color-text-muted)] mt-2">
                Source: Open Library / Internet Archive
              </p>
            )}
          </div>
        </div>

        {/* Right Column: Details & AI */}
        <div className="w-full md:w-2/3 p-8 md:p-12 overflow-y-auto bg-[color:var(--vf-color-bg)]">
          <div className="mb-8">
            <h1 className="font-serif font-bold text-3xl md:text-4xl text-[color:var(--vf-color-text)] mb-2">
              {book.title}
            </h1>
            <p className="text-xl text-[color:var(--vf-color-text-muted)] font-medium">
              {authors}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            {(book.subjects ?? []).slice(0, 4).map((subject) => (
              <span
                key={subject}
                className="px-3 py-1 bg-[color:var(--vf-color-surface-2)] text-[color:var(--vf-color-text-muted)] text-xs rounded-full border border-[color:var(--vf-color-border)]"
              >
                {subject.split(' -- ')[0]}
              </span>
            ))}
            <span className="px-3 py-1 bg-[color:var(--vf-accent-secondary-soft)] text-[color:var(--vf-accent-secondary)] text-xs rounded-full border border-[color:var(--vf-accent-secondary)]/20 uppercase">
              {book.languages.join(', ')}
            </span>
            <span className="px-3 py-1 bg-[color:var(--vf-accent-primary-soft)] text-[color:var(--vf-accent-primary)] text-xs rounded-full border border-[color:var(--vf-accent-primary)]/20">
              {book.source === 'openlibrary'
                ? 'Open Library'
                : book.source === 'published'
                  ? 'V FLOW AI'
                  : 'Project Gutenberg'}
            </span>
          </div>

          {/* AI Analysis Section */}
          <div
            className="bg-gradient-to-br from-[color:var(--vf-color-surface)] to-[color:var(--vf-color-bg)]
                       border border-[color:var(--vf-color-border)] rounded-2xl p-6 shadow-sm mb-8 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Sparkles className="w-24 h-24 text-[color:var(--vf-accent-secondary)]" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-[color:var(--vf-accent-secondary)]">
                  <Sparkles className="w-5 h-5" />
                  <h3 className="font-semibold">AI Analysis</h3>
                </div>
                {!analysis && !analyzing && onAnalyze && (
                  <button
                    onClick={handleAnalyze}
                    className="text-sm px-4 py-2 bg-[color:var(--vf-color-surface)] border border-[color:var(--vf-color-border)] text-[color:var(--vf-accent-secondary)] rounded-lg hover:bg-[color:var(--vf-color-surface-2)] transition-colors shadow-sm"
                  >
                    Generate Summary
                  </button>
                )}
              </div>

              <div className="text-[color:var(--vf-color-text-muted)] leading-relaxed text-sm md:text-base">
                {analyzing ? (
                  <div className="flex items-center gap-2 py-4 text-[color:var(--vf-color-text-muted)]">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing text structure and themes...
                  </div>
                ) : analysis ? (
                  <div className="prose prose-invert prose-sm">
                    {analysis.split('\n').map((line, i) => (
                      <p
                        key={i}
                        className={line.trim() === '' ? 'h-2' : undefined}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[color:var(--vf-color-text-muted)] italic">
                    Tap &quot;Generate Summary&quot; to get an AI-powered overview of
                    this book&#39;s themes, significance, and content using Gemini.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[color:var(--vf-color-bg-deep)] p-5 rounded-xl border border-[color:var(--vf-color-border)]">
              <h4 className="flex items-center gap-2 font-semibold text-[color:var(--vf-color-text)] mb-3">
                <Info className="w-4 h-4" />
                Details
              </h4>
              <ul className="space-y-2 text-sm text-[color:var(--vf-color-text-muted)]">
                <li className="flex justify-between">
                  <span>Reads/Downloads:</span>
                  <span className="font-medium">
                    {book.download_count.toLocaleString()}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Language:</span>
                  <span className="font-medium">{book.languages.join(', ')}</span>
                </li>
                <li className="flex justify-between">
                  <span>Copyright:</span>
                  <span className="font-medium">
                    {book.copyright ? 'Yes' : 'Public Domain'}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Media Type:</span>
                  <span className="font-medium">{book.media_type}</span>
                </li>
              </ul>
            </div>
            <div className="bg-[color:var(--vf-color-bg-deep)] p-5 rounded-xl border border-[color:var(--vf-color-border)]">
              <h4 className="flex items-center gap-2 font-semibold text-[color:var(--vf-color-text)] mb-3">
                <Info className="w-4 h-4" />
                Available Formats
              </h4>
              <div className="flex flex-wrap gap-2">
                {Object.keys(book.formats).map((mime) => (
                  <span
                    key={mime}
                    className="text-xs px-2 py-1 bg-[color:var(--vf-color-surface)] border border-[color:var(--vf-color-border)] rounded text-[color:var(--vf-color-text-muted)]"
                  >
                    {mime.split('/')[1]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
