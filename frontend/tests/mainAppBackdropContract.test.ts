import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainAppSourcePath = fileURLToPath(new URL('../src/app/workspace/MainApp.tsx', import.meta.url));

describe('MainApp backdrop contract', () => {
  it('uses the shared motion helper and does not mount the wallpaper locally', () => {
    const source = readFileSync(mainAppSourcePath, 'utf-8');

    expect(source).toContain('applyMotionLevelToDocument(document, uiMotionLevel)');
    expect(source).not.toContain('vf-live-wallpaper');
    expect(source).not.toContain("document.body.classList.toggle('vf-motion-off'");
    expect(source).not.toContain('document.body.dataset.motion = uiMotionLevel');
  });
});
