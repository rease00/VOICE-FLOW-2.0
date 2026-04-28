import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData } from 'react-router';
import { ReaderHandoffView } from './_shared';
import { backendFetch } from '../lib/backend';

type LoaderData =
  | {
      mode: 'handoff';
      bookId: string;
    }
  | {
      mode: 'reader';
      bookId: string;
      sourceType: string | null;
      body: string | Record<string, unknown> | null;
      error?: {
        status: number;
        message: string;
      };
    };

const API_ROOT = '/api/v1';

const fetchObject = async (key: string, backendEnv: unknown, request: Request) => {
  const response = await backendFetch(`${API_ROOT}/library/reader/object?key=${encodeURIComponent(key)}`, {
    env: backendEnv as any,
    request,
    headers: {
      accept: 'application/json, text/plain, */*',
    },
  });

  const contentType = String(response.headers.get('content-type') || '');
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  return { response, body, contentType };
};

export async function loader({ params, request, context }: LoaderFunctionArgs): Promise<LoaderData> {
  const bookId = String(params.bookId || '').trim();
  if (!bookId) {
    return {
      mode: 'reader',
      bookId: '',
      sourceType: null,
      body: null,
      error: {
        status: 400,
        message: 'bookId is required.',
      },
    };
  }

  if (bookId.toLowerCase() === 'library') {
    return {
      mode: 'handoff',
      bookId,
    };
  }

  try {
    const backendEnv = (context as any)?.cloudflare?.env;
    const { response, body, contentType } = await fetchObject(bookId, backendEnv, request);
    if (!response.ok) {
      return {
        mode: 'reader',
        bookId,
        sourceType: null,
        body: null,
        error: {
          status: response.status,
          message: body && typeof body === 'object'
            ? String((body as any)?.error?.message || (body as any)?.message || response.statusText || 'Book not found.')
            : String(body || response.statusText || 'Book not found.'),
        },
      };
    }

    return {
      mode: 'reader',
      bookId,
      sourceType: contentType || null,
      body: body as string | Record<string, unknown> | null,
    };
  } catch (error) {
    return {
      mode: 'reader',
      bookId,
      sourceType: null,
      body: null,
      error: {
        status: 503,
        message: error instanceof Error ? error.message : 'Unable to load book.',
      },
    };
  }
}

const renderValue = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
};

export default function LibraryBookReadRoute() {
  const data = useLoaderData() as LoaderData;

  if (data.mode === 'handoff') {
    return <ReaderHandoffView />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Reader</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{data.bookId || 'Book'}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              This route reads the live storage object contract and preserves the current handoff behavior.
            </p>
          </div>
          <Link
            to="/app/library"
            className="inline-flex min-h-11 items-center rounded-full border border-white/12 px-4 py-2.5 text-sm font-semibold text-slate-200"
          >
            Back to library
          </Link>
        </div>
      </header>

      {data.error ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
          <h2 className="text-lg font-semibold text-white">Unable to open book</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{data.error.message}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Status {data.error.status}</p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
          <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Artifact</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{data.bookId}</h2>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                {data.sourceType || 'unknown type'}
              </span>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              {typeof data.body === 'string' ? (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">{data.body || '(empty)'}</pre>
              ) : data.body ? (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">
                  {renderValue(data.body)}
                </pre>
              ) : (
                <p className="text-sm leading-6 text-slate-300">This object has no readable body.</p>
              )}
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
            <h3 className="text-base font-semibold text-white">Metadata</h3>
            {data.body && typeof data.body === 'object' && !Array.isArray(data.body) ? (
              <dl className="mt-4 grid gap-3">
                {Object.entries(data.body)
                  .filter(([key]) => key !== 'body')
                  .slice(0, 12)
                  .map(([key, value]) => (
                    <div key={key} className="grid gap-1">
                      <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{key}</dt>
                      <dd className="break-words text-sm leading-6 text-slate-200">{renderValue(value) || '-'}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-300">
                The object is plain text. If it contains chapter content, it is rendered on the left.
              </p>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
