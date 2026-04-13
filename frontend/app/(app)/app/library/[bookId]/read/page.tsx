'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Book } from '@/features/library/model/types';
import { readRememberedLibraryBook } from '@/features/library/services/bookDiscoveryService';
import { API_ROUTES } from '@/shared/api/routes';

const ReaderView = dynamic(
  () =>
    import('@/features/library/components/ReaderView').then((m) => ({
      default: m.ReaderView,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--vf-bg)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    ),
  },
);

export default function ReadPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookId = decodeURIComponent(String(params.bookId || ''));
  const bookSource = searchParams.get('source');
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    const load = async () => {
      const rememberedBook = readRememberedLibraryBook(bookId);
      if (rememberedBook) {
        setBook(rememberedBook);
        return;
      }

      try {
        const url = new URL(API_ROUTES.library.book(bookId), window.location.origin);
        if (bookSource) {
          url.searchParams.set('source', bookSource);
        }

        const res = await fetch(url.toString(), {
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('Not found');
        const data = (await res.json()) as { book?: Book };
        if (!data.book) throw new Error('Not found');
        setBook(data.book);
      } catch {
        router.replace('/app/library');
      }
    };
    load();
  }, [bookId, bookSource, router]);

  if (!book) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: 'var(--vf-bg)' }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return <ReaderView book={book} onClose={() => router.push('/app/library')} />;
}
