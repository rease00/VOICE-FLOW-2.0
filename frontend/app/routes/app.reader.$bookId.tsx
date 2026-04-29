import { useLoaderData } from 'react-router';
import { ReaderHandoffView } from './_shared';

type LoaderData =
  | {
      mode: 'handoff';
      bookId: string;
    }
  | {
      mode: 'redirect';
      bookId: string;
      targetPath: string;
    };

export async function loader({ params, request }: { params: { bookId?: string }; request: Request }): Promise<LoaderData> {
  const bookId = String(params.bookId || '').trim();
  if (!bookId) {
    throw new Response('bookId is required.', { status: 400 });
  }

  if (bookId.toLowerCase() === 'library') {
    return {
      mode: 'handoff',
      bookId,
    };
  }

  const url = new URL(request.url);
  const next = new URL(`/app/library/${encodeURIComponent(bookId)}/read`, url.origin);
  next.search = url.search;
  return {
    mode: 'redirect',
    bookId,
    targetPath: `${next.pathname}${next.search}${next.hash}`,
  };
}

export default function ReaderBookRoute() {
  const data = useLoaderData() as LoaderData;
  return <ReaderHandoffView targetPath={data.mode === 'redirect' ? data.targetPath : null} />;
}
