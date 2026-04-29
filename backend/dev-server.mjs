import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createBackendApp } from './src/routes.js';
import { bootstrapAuthStorage } from './src/bootstrap.js';
import { JobCoordinator } from './src/do/JobCoordinator.js';
import {
  createMemoryD1Database,
  createMemoryDurableObjectNamespace,
  createMemoryQueue,
  createMemoryR2Bucket,
} from './src/dev-bindings.js';

const port = Number(process.env.PORT || 8787);

const readWranglerVars = async () => {
  try {
    const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
    return config.vars || {};
  } catch {
    return {};
  }
};

const applyMigrations = async (database) => {
  const migrationsUrl = new URL('./migrations/', import.meta.url);
  const entries = await readdir(migrationsUrl);
  const migrationFiles = entries
    .filter((entry) => /^\d+_.+\.sql$/i.test(entry))
    .sort((a, b) => a.localeCompare(b));

  for (const migrationFile of migrationFiles) {
    await database.exec(await readFile(new URL(migrationFile, migrationsUrl), 'utf8'));
  }
};

const db = createMemoryD1Database();
const env = {
  ...(await readWranglerVars()),
  DB: db,
  ARTIFACTS_BUCKET: createMemoryR2Bucket(),
  JOB_COORDINATOR: createMemoryDurableObjectNamespace(JobCoordinator),
  JOB_QUEUE: createMemoryQueue(),
};
const app = createBackendApp({ env });

await applyMigrations(db);
await bootstrapAuthStorage(db, {
  env,
  source: 'dev-server',
  now: Date.now(),
});

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
    const response = await app.fetch(request, env, {});
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
