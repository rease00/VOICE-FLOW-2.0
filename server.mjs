import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const rootDir = process.cwd();
const port = Number(process.env.PORT || 3000);

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

  if (!path.extname(cleanPath)) {
    const rootIndex = safeJoin('index.html');
    if (rootIndex && await exists(rootIndex)) {
      return rootIndex;
    }
  }

  return null;
};

const serve = async (req, res) => {
  try {
    const candidate = await resolveCandidatePath(req.url || '/');
    if (!candidate) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
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
