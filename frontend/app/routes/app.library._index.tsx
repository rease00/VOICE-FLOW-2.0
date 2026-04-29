import { useEffect, useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData } from 'react-router';
import { resolveReaderHandoffTarget } from './_shared';
import { backendFetch } from '../lib/backend';

type StorageListItem = {
  key: string;
  size?: number | null;
  etag?: string | null;
  uploadedAtMs?: number | null;
  contentType?: string | null;
  filename?: string | null;
  publicUrl?: string | null;
};

type LoaderData = {
  ok: boolean;
  items: StorageListItem[];
  count: number;
  error?: {
    status: number;
    message: string;
  };
};

const API_ROOT = '/api/v1';

const readJson = async (response: Response) => {
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => '');
};

const normalizeItem = (value: unknown): StorageListItem | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    return {
      key: value,
      filename: value.split('/').filter(Boolean).pop() || value,
    };
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const key = String(record.key || record.id || record.bookId || record.filename || '').trim();
  if (!key) return null;
  return {
    key,
    size: typeof record.size === 'number' ? record.size : null,
    etag: typeof record.etag === 'string' ? record.etag : null,
    uploadedAtMs: typeof record.uploadedAtMs === 'number' ? record.uploadedAtMs : null,
    contentType: typeof record.contentType === 'string' ? record.contentType : null,
    filename: typeof record.filename === 'string' ? record.filename : key.split('/').filter(Boolean).pop() || key,
    publicUrl: typeof record.publicUrl === 'string' ? record.publicUrl : null,
  };
};

export async function loader({ request, context }: LoaderFunctionArgs): Promise<LoaderData> {
  try {
    const backendEnv = (context as any)?.cloudflare?.env;
    const response = await backendFetch(`${API_ROOT}/library/reader/objects?limit=200`, {
      env: backendEnv,
      request,
      headers: {
        accept: 'application/json',
      },
    });
    const body = await readJson(response);

    if (!response.ok) {
      return {
        ok: false,
        items: [],
        count: 0,
        error: {
          status: response.status,
          message: body && typeof body === 'object'
            ? String((body as any)?.error?.message || (body as any)?.message || response.statusText || 'Unable to load library.')
            : String(body || response.statusText || 'Unable to load library.'),
        },
      };
    }

    const keys = Array.isArray((body as any)?.keys)
      ? (body as any).keys
      : Array.isArray((body as any)?.items)
        ? (body as any).items
        : [];

    const items = keys.map(normalizeItem).filter(Boolean) as StorageListItem[];

    return {
      ok: true,
      items,
      count: typeof (body as any)?.count === 'number' ? (body as any).count : items.length,
    };
  } catch (error) {
    return {
      ok: false,
      items: [],
      count: 0,
      error: {
        status: 503,
        message: error instanceof Error ? error.message : 'Unable to load library.',
      },
    };
  }
}

export default function AppLibraryIndexRoute() {
  const data = useLoaderData() as LoaderData;
  const [continueTarget, setContinueTarget] = useState<string | null>(null);

  useEffect(() => {
    const resolution = resolveReaderHandoffTarget('');
    setContinueTarget(resolution.bookId ? resolution.targetPath : null);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-5 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Library</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Stored books and reader artifacts</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              This page uses the live storage contract. It does not invent a separate catalog or fake book source.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200">Items</div>
            <div className="mt-1 text-3xl font-semibold text-white">{data.ok ? data.count : '-'}</div>
          </div>
        </div>
        {data.ok && continueTarget ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to={continueTarget}
              className="inline-flex min-h-11 items-center rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-200/20"
            >
              Continue reading
            </Link>
            <Link
              to="/app/reader"
              className="inline-flex min-h-11 items-center rounded-full border border-white/12 px-4 py-2.5 text-sm font-semibold text-slate-200"
            >
              Reader root
            </Link>
          </div>
        ) : null}
      </header>

      {!data.ok ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
          <h2 className="text-lg font-semibold text-white">Library unavailable</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{data.error?.message || 'The storage backend could not be reached.'}</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            Status {data.error?.status || 503}
          </p>
        </section>
      ) : data.items.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
          <h2 className="text-lg font-semibold text-white">No stored books yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Once a reader artifact exists in storage, it will show up here and open in the read route.
          </p>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <article key={item.key} className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Book</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{item.filename || item.key}</h2>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                  {item.contentType || 'artifact'}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Key</dt>
                  <dd className="mt-1 break-words text-slate-200">{item.key}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Size</dt>
                  <dd className="mt-1 text-slate-200">{formatBytes(item.size)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/app/library/${encodeURIComponent(item.key)}/read`}
                  className="inline-flex min-h-10 items-center rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Open reader
                </Link>
                {item.publicUrl ? (
                  <a
                    href={item.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 items-center rounded-full border border-white/12 px-4 py-2 text-sm font-semibold text-slate-200"
                  >
                    Public asset
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function formatBytes(size: number | null | undefined) {
  if (!Number.isFinite(size || NaN) || !size) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(size);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
