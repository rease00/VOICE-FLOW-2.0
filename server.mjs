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

const proxyToUpstream = async (req, res, pathnameWithQuery) => {
  const url = new URL(pathnameWithQuery, upstreamBase);
  const method = req.method || 'GET';
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (hopByHopHeaders.has(lower) || typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
    } else {
      headers.set(name, String(value));
    }
  }

  headers.set('host', upstreamBase.host);

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);
  const upstreamResponse = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, name) => {
    if (!hopByHopHeaders.has(name.toLowerCase())) {
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

const resolveCandidatePath = async (urlPathname, allowSpaFallback) => {
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

  if (allowSpaFallback && !path.extname(cleanPath)) {
    const rootIndex = safeJoin('index.html');
    if (rootIndex && await exists(rootIndex)) {
      return rootIndex;
    }
  }

  return null;
};

const serve = async (req, res) => {
  try {
    const requestPath = req.url || '/';
    const method = req.method || 'GET';
    const pathname = decodeURIComponent(requestPath.split('?')[0] || '/');
    const allowSpaFallback = method === 'GET' || method === 'HEAD';

    if (isApiPath(pathname)) {
      await proxyToUpstream(req, res, requestPath);
      return;
    }

    const candidate = await resolveCandidatePath(requestPath, allowSpaFallback);
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
