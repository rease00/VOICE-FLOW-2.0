import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MAIN_APP_PATH = path.resolve(__dirname, '../views/MainApp.tsx');

const source = fs.readFileSync(MAIN_APP_PATH, 'utf8');

describe('MainApp dubbing 2026 pipeline wiring', () => {
  it('keeps Video Pipeline (2026) guide and Advanced panel collapsed by default', () => {
    expect(source).toContain("const [isVideoPipelineGuideOpen, setIsVideoPipelineGuideOpen] = useState(false);");
    expect(source).toContain("const [isDubbingAdvancedOpen, setIsDubbingAdvancedOpen] = useState(false);");
    expect(source).toContain('Video Pipeline (2026)');
    expect(source).toContain('Phase 1: Deep Acoustic Deconstruction (Acoustic Isolation)');
    expect(source).toContain('Phase 6: Visual Lip-Sync (Final Assembly)');
    expect(source).toContain('Pro-tip: use thinking level low');
    expect(source).toContain('<span>Advanced</span>');
    expect(source).toContain('Remove Selected');
    expect(source).toContain('Remove Completed');
    expect(source).toContain('Remove All');
  });

  it('uses backend-only v2 dubbing orchestration for queue clips and completed-only artifact downloads', () => {
    expect(source).toContain('createDubbingJobV2(mediaBackendUrl, clip.file');
    expect(source).toContain('getDubbingJob(mediaBackendUrl, jobId, {');
    expect(source).toContain('cancelDubbingJob(mediaBackendUrl, jobId)');
    expect(source).toContain('processing_profile: dubbingCpuProfile');
    expect(source).toContain('clip_window: { start_ms: Math.max(0, clip.trimInMs), end_ms: Math.max(clip.trimInMs + 240, clip.trimOutMs) }');
    expect(source).toContain('dubbingJobResultUrl && dubbingUiState.phase === \'done\'');
    expect(source).toContain('Download Output');
    expect(source).toContain('Download Report');
  });
});
