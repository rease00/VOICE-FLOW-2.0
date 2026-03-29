#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const distDir = path.join(frontendRoot, 'dist');
const openNextAssetsDir = path.join(frontendRoot, '.open-next', 'assets');
const publicDir = path.join(frontendRoot, 'public');

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

  const indexHtml = path.join(distDir, 'index.html');
  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>V FLOW AI</title>
    <meta http-equiv="refresh" content="0; url=/app" />
  </head>
  <body>
    <noscript>Please enable JavaScript to continue.</noscript>
  </body>
</html>
`;
  await writeFile(indexHtml, fallbackHtml, 'utf8');
  console.log('[pages:dist] Prepared Cloudflare Pages fallback output in dist/.');
};

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[pages:dist] Failed to prepare Cloudflare Pages output.');
  console.error(detail);
  process.exit(1);
});
