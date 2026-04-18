#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const distDir = path.join(frontendRoot, 'dist');
const openNextDir = path.join(frontendRoot, '.open-next');
const openNextAssetsDir = path.join(frontendRoot, '.open-next', 'assets');
const publicDir = path.join(frontendRoot, 'public');

const pagesWorkerSource = `import app from './.open-next/worker.js';

const isHiddenRuntimePath = (pathname) =>
  pathname === '/_worker.js' || pathname.startsWith('/.open-next/');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isHiddenRuntimePath(url.pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    return app.fetch(request, env, ctx);
  },
};
`;

const main = async () => {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  try {
    await cp(openNextAssetsDir, distDir, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy OpenNext assets into dist: ${message}`);
  }

  try {
    await cp(publicDir, distDir, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch {
    // The public directory is optional for the Pages fallback bundle.
  }

  try {
    await cp(openNextDir, path.join(distDir, '.open-next'), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy the OpenNext runtime into dist: ${message}`);
  }

  await writeFile(path.join(distDir, '_worker.js'), pagesWorkerSource, 'utf8');

  const indexHtml = path.join(distDir, 'index.html');
  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>V FLOW AI</title>
  </head>
  <body>
    <noscript>V FLOW AI is loading.</noscript>
  </body>
</html>
`;
  await writeFile(indexHtml, fallbackHtml, 'utf8');
  console.log('[pages:dist] Prepared Cloudflare Pages advanced-mode output in dist/.');
};

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[pages:dist] Failed to prepare Cloudflare Pages output.');
  console.error(detail);
  process.exit(1);
});
