import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('kokoro asset cache headers', () => {
  it('marks kokoro asset path immutable for CDN edge caching', () => {
    const headersPath = resolve(process.cwd(), 'public/_headers');
    const headers = readFileSync(headersPath, 'utf8');
    expect(headers).toMatch(/\/kokoro-assets\/\*/);
    expect(headers).toMatch(/Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/i);
  });
});
