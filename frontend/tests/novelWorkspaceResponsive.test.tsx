import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NovelWorkspaceV2 } from '../components/NovelWorkspaceV2';
import type { GenerationSettings } from '../types';

const viewportMock = vi.hoisted(() => vi.fn());
const useUserMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/ui/useWorkspaceViewport', () => ({
  useWorkspaceViewport: () => viewportMock(),
}));

vi.mock('../contexts/UserContext', () => ({
  useUser: () => useUserMock(),
}));

vi.mock('../components/ui/UploadDropzone', () => ({
  UploadDropzone: () => <div data-testid="upload-dropzone" />,
}));

const settings: GenerationSettings = {
  voiceId: 'voice_1',
  speed: 1,
  pitch: 'Medium',
  language: 'English',
  engine: 'PRIME',
  helperProvider: 'LOCAL',
};

const renderWorkspace = () => renderToStaticMarkup(
  <NovelWorkspaceV2
    settings={settings}
    mediaBackendUrl="http://127.0.0.1:7800"
    onToast={vi.fn()}
    onSendToStudio={vi.fn()}
  />
);

describe('NovelWorkspaceV2 responsive layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUserMock.mockReturnValue({ user: null });
  });

  it('uses mobile Novel/Chapter tabs and keeps controls inside the selected tab on phones', () => {
    viewportMock.mockReturnValue({
      width: 390,
      mode: 'phone',
      isPhone: true,
      isTablet: false,
      isDesktop: false,
    });

    const markup = renderWorkspace();

    expect(markup).toContain('data-novel-layout="phone"');
    expect(markup).toContain('Tools');
    expect(markup).toContain('Novel');
    expect(markup).toContain('Chapter');
    expect(markup).toContain('Novel name');
    expect(markup).not.toContain('Chapter title');
    expect(markup).not.toContain('Target culture');
  });

  it('keeps the compact inline create rail on tablets', () => {
    viewportMock.mockReturnValue({
      width: 820,
      mode: 'tablet',
      isPhone: false,
      isTablet: true,
      isDesktop: false,
    });

    const markup = renderWorkspace();

    expect(markup).toContain('data-novel-layout="tablet"');
    expect(markup).toContain('Novel name');
    expect(markup).toContain('Create Novel');
    expect(markup).not.toContain('+ Novel');
  });

  it('preserves the full workspace composition on desktop', () => {
    viewportMock.mockReturnValue({
      width: 1440,
      mode: 'desktop',
      isPhone: false,
      isTablet: false,
      isDesktop: true,
    });

    const markup = renderWorkspace();

    expect(markup).toContain('data-novel-layout="desktop"');
    expect(markup).toContain('Library');
    expect(markup).toContain('novel-library-tabs');
    expect(markup).toContain('Inspector');
    expect(markup).toContain('novel-tools-tabs');
    expect(markup).toContain('novel-editor-tabs');
    expect(markup).toContain('novel-workspace-back');
    expect(markup).toContain('novel-workspace-forward');
    expect(markup).toContain('Browser cache autosave');
    expect(markup).toContain('Adaptation');
    expect(markup).toContain('Select a novel to view adaptation tools.');
    expect(markup).toContain('Novel name');
    expect(markup).toContain('Save');
    expect(markup).toContain('Source');
    expect(markup).toContain('Adapted');
    expect(markup).not.toContain('Advanced: Google Drive');
    expect(markup).not.toContain('+ Novel');
    expect(markup).not.toContain('novel-workspace-expand');
  });
});
