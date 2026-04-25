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

const serve = async (req, res) => {
  try {
    const requestPath = req.url || '/';
    const pathname = decodeURIComponent(requestPath.split('?')[0] || '/');

    if (isApiPath(pathname)) {
      await proxyToUpstream(req, res, requestPath);
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
