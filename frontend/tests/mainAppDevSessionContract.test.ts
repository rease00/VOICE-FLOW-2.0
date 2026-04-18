import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainAppSourcePath = fileURLToPath(new URL('../src/app/workspace/MainApp.tsx', import.meta.url));

describe('MainApp dev session contract', () => {
  it('keeps the dev session heartbeat disabled outside development builds', () => {
    const source = readFileSync(mainAppSourcePath, 'utf-8');

    expect(source).toContain("if (process.env.NODE_ENV !== 'development') return;");
    expect(source).toContain("const DEV_SESSION_HEARTBEAT_ENDPOINT = '/api/dev/session';");
  });
});
