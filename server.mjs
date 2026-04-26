import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const rootDir = process.cwd();
const port = Number(process.env.PORT || 3000);
const upstreamOrigin = process.env.UPSTREAM_ORIGIN || 'https://v-flow-ai.1wasim9851229685.workers.dev';
const upstreamBase = new URL(upstreamOrigin);
const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const upstreamRequestHeaderBlocklist = new Set(['accept-encoding', 'content-length', 'expect']);
const upstreamResponseHeaderBlocklist = new Set(['content-encoding', 'content-length']);

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

const isApiPath = (pathname) => pathname === '/api' || pathname.startsWith('/api/');

const readRequestBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const formatErrorWithCause = (error) => {
  if (!(error instanceof Error)) return String(error);
  if (error.cause instanceof Error) return `${error.message} | cause: ${error.cause.message}`;
  return error.message;
};

const proxyToUpstream = async (req, res, pathnameWithQuery) => {
  const url = new URL(pathnameWithQuery, upstreamBase);
  const method = req.method || 'GET';
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (hopByHopHeaders.has(lower) || upstreamRequestHeaderBlocklist.has(lower) || typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
    } else {
      headers.set(name, String(value));
    }
  }

  headers.set('host', upstreamBase.host);

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
    });
  } catch (error) {
    throw new Error(`Proxy fetch failed for ${method} ${url.pathname}: ${formatErrorWithCause(error)}`);
  }

  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!hopByHopHeaders.has(lower) && !upstreamResponseHeaderBlocklist.has(lower)) {
      responseHeaders[name] = value;
    }
  });

  if (typeof upstreamResponse.headers.getSetCookie === 'function') {
    const setCookies = upstreamResponse.headers.getSetCookie();
    if (setCookies.length) responseHeaders['set-cookie'] = setCookies;
  }

  responseHeaders['cache-control'] = responseHeaders['cache-control'] || 'no-store';
  res.writeHead(upstreamResponse.status, responseHeaders);
  res.end(Buffer.from(await upstreamResponse.arrayBuffer()));
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
    const pathname = decodeURIComponent(requestPath.split('?')[0] || '/');

    if (isApiPath(pathname)) {
      await proxyToUpstream(req, res, requestPath);
      return;
    }

    if (isReaderAliasPath(requestPath)) {
      serveReaderAliasPage(req, res);
      return;
    }

    const candidate = await resolveCandidatePath(requestPath);
    if (!candidate) {
      await proxyToUpstream(req, res, requestPath);
      return;
    }

    const ext = path.extname(candidate).toLowerCase();
    const contentType = contentTypes.get(ext) || 'application/octet-stream';
    const data = await fs.readFile(candidate);
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
  console.log(`v-flow snapshot dev server: http://localhost:${port}`);
});
