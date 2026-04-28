import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';

const rootDir = process.cwd();
const port = Number(process.env.PORT || 3000);
const backendOrigin = (() => {
  const candidates = [
    process.env.BACKEND_ORIGIN,
    process.env.VF_BACKEND_ORIGIN,
    process.env.UPSTREAM_ORIGIN,
    process.env.LOCAL_BACKEND_ORIGIN,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return new URL(candidate).origin;
    } catch {
      // Ignore malformed overrides and fall back to the local backend dev server.
    }
  }

  return 'http://127.0.0.1:8787';
})();

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const readerAliasPaths = new Set([
  '/app/library/library/read',
  '/app/reader/library',
]);

const readerAliasLoadingPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Loading Reader</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050816;
        --panel: rgba(10, 14, 26, 0.9);
        --border: rgba(255, 255, 255, 0.08);
        --text: #e5eefb;
        --muted: #92a4bf;
        --accent: #4dd4ff;
      }
      html, body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top, rgba(77, 212, 255, 0.16), transparent 42%),
          linear-gradient(180deg, #040713 0%, var(--bg) 100%);
        color: var(--text);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
  body {
    display: grid;
    place-items: center;
        min-height: 100vh;
        padding: 24px;
        box-sizing: border-box;
      }
      .card {
        width: min(100%, 420px);
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--panel);
        padding: 24px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(18px);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(77, 212, 255, 0.24);
        border-radius: 999px;
        padding: 6px 10px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 0 rgba(77, 212, 255, 0.55);
        animation: pulse 1.4s ease-in-out infinite;
      }
      h1 {
        margin: 18px 0 8px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .status {
        margin-top: 18px;
        font-size: 12px;
        color: #7f92b2;
        word-break: break-word;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(0.95); opacity: 0.7; }
        50% { transform: scale(1.1); opacity: 1; }
      }
    </style>
    <script>
      (function () {
        var fallbackPath = '/app/library';
        var status = document.getElementById('status');

        function clean(value) {
          return typeof value === 'string' ? value.trim() : '';
        }

        function isUsableBookId(value) {
          var id = clean(value);
          if (!id) return false;
          var lower = id.toLowerCase();
          if (lower === 'app' || lower === 'library' || lower === 'reader' || lower === 'read') return false;
          if (lower === '/app/library' || lower === '/app/reader') return false;
          return true;
        }

        function readJson(raw) {
          if (typeof raw !== 'string' || !raw) return null;
          try {
            return JSON.parse(raw);
          } catch (_error) {
            return raw;
          }
        }

        function extractBookIdFromRecord(raw) {
          var parsed = readJson(raw);
          if (!parsed) return null;
          if (typeof parsed === 'string') {
            return isUsableBookId(parsed) ? parsed.trim() : null;
          }
          if (typeof parsed !== 'object') return null;
          var candidate = parsed.id || parsed.bookId || parsed.selectedBookId || parsed.libraryBookId || parsed.entryId || parsed.value;
          if (typeof candidate === 'number') {
            candidate = String(candidate);
          }
          return isUsableBookId(candidate) ? clean(candidate) : null;
        }

        function readFromStorageKey(key) {
          try {
            return extractBookIdFromRecord(window.localStorage.getItem(key));
          } catch (_error) {
            return null;
          }
        }

        function resolveBookId() {
          var params = new URLSearchParams(window.location.search);
          var queryKeys = ['bookId', 'selectedBookId', 'libraryBookId'];
          for (var i = 0; i < queryKeys.length; i += 1) {
            var queryValue = params.get(queryKeys[i]);
            if (isUsableBookId(queryValue)) return queryValue.trim();
          }

          try {
            var lastPlayed = readFromStorageKey('vf-library-last-played');
            if (lastPlayed) return lastPlayed;

            for (var k = 0; k < window.localStorage.length; k += 1) {
              var storageKey = window.localStorage.key(k);
              if (!storageKey || !storageKey.startsWith('vf-library-selected-book:')) continue;
              var candidate = readFromStorageKey(storageKey);
              if (candidate) return candidate;
            }
          } catch (_error) {
            return null;
          }

          return null;
        }

        var bookId = resolveBookId();
        var target = bookId ? '/app/library/' + encodeURIComponent(bookId) + '/read' : fallbackPath;
        if (status) {
          status.textContent = bookId ? 'Redirecting to ' + bookId + '...' : 'Book not found. Opening the library...';
        }

        window.setTimeout(function () {
          if (window.location.pathname === target) return;
          window.location.replace(target);
        }, 0);
      }());
    </script>
  </head>
  <body>
    <main class="card" role="status" aria-live="polite">
      <div class="eyebrow"><span class="dot"></span> Reader handoff</div>
      <h1>Loading reader</h1>
      <p>Resolving the real book from your browser session and sending you to the active read view.</p>
      <p id="status" class="status">Checking local storage...</p>
    </main>
  </body>
</html>`;
const installBannerChunkSuffix = path.join('_next', 'static', 'chunks', 'app', '(app)', 'app', 'layout-90172a04be9e20fc.js');
const cookieBannerChunkSuffix = path.join('_next', 'static', 'chunks', 'app', 'layout-47f86afcb4ba45c6.js');

const rewriteSnapshotAsset = (candidate, data) => {
  const source = data.toString('utf8');
  if (candidate.endsWith(installBannerChunkSuffix)) {
    const bannerStart = source.indexOf('function m(){let e=(0,l.usePathname)(),t=n(d),r=n(e=>e.install),i=n(e=>e.status);return((0,s.useEffect)(()=>{let e=e=>{n.getState().capture(e)};return window.addEventListener("beforeinstallprompt",e),()=>window.removeEventListener("beforeinstallprompt",e)},[]),!t||x(e))?null:');
    const bannerEnd = source.indexOf('function u(){', bannerStart);

    if (bannerStart === -1 || bannerEnd === -1) return data;
    return Buffer.from(`${source.slice(0, bannerStart)}function m(){return null}${source.slice(bannerEnd)}`, 'utf8');
  }

  if (candidate.endsWith(cookieBannerChunkSuffix)) {
    const compacted = source
      .replace(
        'className:"fixed inset-x-3 bottom-3 z-[10000] mx-auto max-w-3xl rounded-2xl border border-white/12 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-2xl shadow-black/35 backdrop-blur md:inset-x-auto md:right-4 md:max-w-xl"',
        'className:"fixed inset-x-3 bottom-3 z-[10000] mx-auto max-w-sm rounded-xl border border-white/12 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-lg shadow-black/25 backdrop-blur md:inset-x-auto md:right-3 md:max-w-sm"'
      )
      .replace(
        'className:"flex flex-col gap-3 md:flex-row md:items-start md:justify-between"',
        'className:"flex flex-col gap-2 md:flex-row md:items-center md:justify-between"'
      )
      .replace(
        'className:"mt-1 leading-6 text-slate-300"',
        'className:"mt-1 leading-5 text-slate-300"'
      )
      .replace(
        'className:"mt-2 inline-flex min-h-10 items-center text-xs font-semibold text-cyan-200 underline underline-offset-4"',
        'className:"mt-1 inline-flex min-h-9 items-center text-[11px] font-semibold text-cyan-200 underline underline-offset-4"'
      )
      .replace(
        'className:"flex shrink-0 flex-wrap gap-2 md:justify-end"',
        'className:"flex shrink-0 flex-wrap gap-1.5 md:justify-end"'
      )
      .replace(
        'className:"min-h-11 rounded-xl border border-white/14 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"',
        'className:"min-h-9 rounded-lg border border-white/14 px-3 py-1.5 text-[11px] font-semibold text-slate-100 hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"'
      )
      .replace(
        'className:"min-h-11 rounded-xl bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"',
        'className:"min-h-9 rounded-lg bg-cyan-300 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"'
      );

    return compacted === source ? data : Buffer.from(compacted, 'utf8');
  }

  return data;
};

const exists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const safeJoin = (...segments) => {
  const resolved = path.resolve(rootDir, ...segments);
  if (!resolved.startsWith(rootDir)) return null;
  return resolved;
};

const resolveCandidatePath = async (urlPathname) => {
  const pathname = decodeURIComponent(urlPathname.split('?')[0] || '/');
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const directCandidate = safeJoin(`.${cleanPath}`);
  if (!directCandidate) return null;

  if (await exists(directCandidate)) {
    const stat = await fs.stat(directCandidate);
    if (stat.isFile()) return directCandidate;
    if (stat.isDirectory()) {
      const indexCandidate = path.join(directCandidate, 'index.html');
      if (await exists(indexCandidate)) return indexCandidate;
    }
  }

  const asDirectoryIndex = safeJoin(`.${cleanPath}`, 'index.html');
  if (asDirectoryIndex && await exists(asDirectoryIndex)) {
    return asDirectoryIndex;
  }

  return null;
};

const isReaderAliasPath = (urlPathname) => {
  const pathname = decodeURIComponent(String(urlPathname || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';
  return readerAliasPaths.has(pathname);
};

const isApiPath = (urlPathname) => {
  const pathname = decodeURIComponent(String(urlPathname || '/').split('?')[0] || '/');
  return pathname === '/api' || pathname.startsWith('/api/');
};

const readRequestBody = async (req) => {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length ? Buffer.concat(chunks) : undefined;
};

const proxyApiRequest = async (req, res, requestPath) => {
  const method = String(req.method || 'GET').toUpperCase();
  const targetUrl = new URL(requestPath, backendOrigin);
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lowerName = name.toLowerCase();
    if (lowerName === 'host' || lowerName === 'content-length' || lowerName === 'connection' || lowerName === 'transfer-encoding' || lowerName === 'accept-encoding') {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
      continue;
    }

    headers.set(name, value);
  }

  headers.set('x-forwarded-host', String(req.headers.host || `localhost:${port}`));
  headers.set('x-forwarded-proto', 'http');
  if (req.socket?.remoteAddress) {
    headers.set('x-forwarded-for', req.socket.remoteAddress);
  }

  const body = await readRequestBody(req);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
      redirect: 'manual',
    });
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`API proxy error: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (lowerName === 'connection' || lowerName === 'transfer-encoding' || lowerName === 'keep-alive' || lowerName === 'proxy-authenticate' || lowerName === 'proxy-authorization' || lowerName === 'te' || lowerName === 'trailers' || lowerName === 'upgrade') {
      return;
    }

    if (lowerName === 'set-cookie') {
      const existing = responseHeaders['set-cookie'];
      responseHeaders['set-cookie'] = existing ? [].concat(existing, value) : [value];
      return;
    }

    responseHeaders[name] = value;
  });

  res.writeHead(upstreamResponse.status, responseHeaders);

  if (method === 'HEAD' || !upstreamResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
};

const serveReaderAliasPage = (req, res) => {
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  };
  res.writeHead(200, headers);
  if ((req.method || 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }
  res.end(readerAliasLoadingPage);
};

const serve = async (req, res) => {
  try {
    const requestPath = req.url || '/';

    if (isApiPath(requestPath)) {
      await proxyApiRequest(req, res, requestPath);
      return;
    }

    if (isReaderAliasPath(requestPath)) {
      serveReaderAliasPage(req, res);
      return;
    }

    const candidate = await resolveCandidatePath(requestPath);
    if (!candidate) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(candidate).toLowerCase();
    const contentType = contentTypes.get(ext) || 'application/octet-stream';
    const data = rewriteSnapshotAsset(candidate, await fs.readFile(candidate));
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
  }
};

http.createServer(serve).listen(port, () => {
  console.log(`v-flow cloudflare-native snapshot server: http://localhost:${port}`);
});
