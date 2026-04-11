'use client';

import React from 'react';
import Image from 'next/image';
import { Heart } from 'lucide-react';
import type { Book } from '../model/types';
import { getBookCover } from '../services/bookDiscoveryService';

interface BookCardProps {
  book: Book;
  onClick: (book: Book) => void;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent, book: Book) => void;
  isOffline?: boolean;
}

export const BookCard: React.FC<BookCardProps> = ({
  book,
  onClick,
  isFavorite,
  onToggleFavorite,
  isOffline = false,
}) => {
  const coverUrl = getBookCover(book);
  const authors =
    (book.authors ?? [])
      .map((a) => a.name?.split(',').reverse().join(' ').trim())
      .filter(Boolean)
      .join(', ') || 'Unknown Author';

  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg
                 border border-[color:var(--vf-color-border)]
                 bg-[color:var(--vf-color-surface)]
                 shadow-[var(--vf-shadow-card)]
                 transition-all duration-300 hover:shadow-[var(--vf-shadow-floating)]"
      onClick={() => onClick(book)}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-[color:var(--vf-color-bg-deep)]">
        <Image
          src={coverUrl}
          alt={book.title}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 28vw, 20vw"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-between p-2">
          <span className="text-white text-xs font-medium bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-full">
            {book.download_count
              ? book.download_count >= 1000
                ? `${(book.download_count / 1000).toFixed(0)}k`
                : String(book.download_count)
              : '—'}
          </span>
        </div>
        {isOffline && (
          <span className="absolute bottom-1.5 left-1.5 text-xs font-medium bg-green-600 text-white px-1.5 py-0.5 rounded-full shadow-sm z-10">
            ✓ Offline
          </span>
        )}
        {book.vnPrice != null && (
          <span className="absolute top-1.5 left-1.5 text-xs font-bold bg-[color:var(--vf-accent-tertiary)] text-black px-1.5 py-0.5 rounded-full shadow-sm z-10">
            {book.vnPrice === 0 ? 'FREE' : `${book.vnPrice} VN`}
          </span>
        )}
        <button
          onClick={(e) => onToggleFavorite(e, book)}
          className={`absolute top-1.5 right-1.5 p-1.5 rounded-full backdrop-blur-md transition-all ${
            isFavorite
              ? 'bg-rose-500 text-white'
              : 'bg-[color:var(--vf-color-surface)]/90 text-[color:var(--vf-color-text-muted)] hover:text-rose-300'
          }`}
        >
          <Heart className={`w-3 h-3 ${isFavorite ? 'fill-current' : ''}`} />
        </button>
      </div>

      <div className="p-2 flex flex-col flex-grow">
        <h3 className="mb-0.5 line-clamp-2 text-xs font-serif font-bold leading-tight text-[color:var(--vf-color-text)] transition-colors group-hover:text-[color:var(--vf-accent-secondary)]">
          {book.title}
        </h3>
        <p className="line-clamp-1 text-[10px] text-[color:var(--vf-color-text-muted)]">
          {authors}
        </p>
      </div>
    </div>
  );
};
