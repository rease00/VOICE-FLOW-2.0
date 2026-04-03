import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/errors/AppErrorBoundary', () => ({
  AppErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../src/app/providers/AppProviders', () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../src/app/providers/AppThemeBootstrap', () => ({
  AppThemeBootstrap: () => null,
}));

import AppLayout from '../app/(app)/layout';

const layoutSourcePath = fileURLToPath(new URL('../app/(app)/layout.tsx', import.meta.url));
const bootstrapSourcePath = fileURLToPath(new URL('../src/app/providers/AppThemeBootstrap.tsx', import.meta.url));
const mainAppSourcePath = fileURLToPath(new URL('../views/MainApp.tsx', import.meta.url));
const cssSourcePath = fileURLToPath(new URL('../app/(app)/app/app-shell.css', import.meta.url));

describe('app layout backdrop', () => {
  it('renders one shared wallpaper layer and the app shell contract', () => {
    const html = renderToStaticMarkup(
      <AppLayout>
        <main data-testid="app-shell-child">Studio</main>
      </AppLayout>,
    );

    const wallpaperMatches = html.match(/vf-live-wallpaper/g) ?? [];

    expect(html).toContain('data-vf-app-shell');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('data-vf-theme-mode="dark"');
    expect(html).toContain('data-vf-resolved-theme="dark"');
    expect(html).toContain('data-testid="app-shell-child"');
    expect(wallpaperMatches).toHaveLength(1);
  });

  it('keeps backdrop ownership in app layout and motion handling in shared helpers', () => {
    const layoutSource = readFileSync(layoutSourcePath, 'utf-8');
    const bootstrapSource = readFileSync(bootstrapSourcePath, 'utf-8');
    const mainAppSource = readFileSync(mainAppSourcePath, 'utf-8');
    const cssSource = readFileSync(cssSourcePath, 'utf-8');

    expect(layoutSource).toContain('AppThemeBootstrap');
    expect(layoutSource).toContain('vf-live-wallpaper');
    expect(layoutSource).toContain('data-vf-app-shell');

    expect(bootstrapSource).toContain('readUiThemeModeFromStorage');
    expect(bootstrapSource).toContain('readUiBrandThemeFromStorage');
    expect(bootstrapSource).toContain('readUiMotionLevelFromStorage');
    expect(bootstrapSource).toContain('applyMotionLevelToDocument(document, motionLevel)');

    expect(mainAppSource).toContain('applyMotionLevelToDocument(document, uiMotionLevel)');
    expect(mainAppSource).not.toContain('vf-live-wallpaper');

    expect(cssSource).toContain("body[data-vf-resolved-theme='light'] .vf-live-wallpaper");
    expect(cssSource).toContain('.vf-motion-off .vf-live-wallpaper::before');
    expect(cssSource).toContain('.vf-motion-rich .vf-live-wallpaper::after');
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
