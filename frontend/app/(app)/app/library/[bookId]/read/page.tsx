'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Book } from '@/features/library/model/types';

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
  const bookId = params.bookId as string;
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(
          `https://gutendex.com/books/${encodeURIComponent(bookId)}`,
          { signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setBook(data as Book);
      } catch {
        router.replace('/app/library');
      }
    };
    load();
  }, [bookId, router]);

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
