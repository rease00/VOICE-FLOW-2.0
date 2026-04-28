import http from 'node:http';
import { Readable } from 'node:stream';
import { fetch, createMockEnv } from './src/index.js';

const port = Number(process.env.PORT || 8787);
const env = createMockEnv();

const toRequest = async (req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const method = (req.method || 'GET').toUpperCase();
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
      continue;
    }
    headers.set(key, value);
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(req);

  return new Request(url, {
    method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  });
};

const server = http.createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const response = await fetch(request, env, {});
    const body = await response.arrayBuffer();

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(body));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
});

server.listen(port, () => {
  console.log(`backend dev server listening on http://127.0.0.1:${port}`);
});
