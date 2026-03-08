import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MAIN_APP_PATH = path.resolve(__dirname, '../views/MainApp.tsx');
const DUBBING_TAB_PATH = path.resolve(__dirname, '../src/features/dubbing/components/SimplifiedDubbingTab.tsx');

const mainAppSource = fs.readFileSync(MAIN_APP_PATH, 'utf8');
const dubbingSource = fs.readFileSync(DUBBING_TAB_PATH, 'utf8');

describe('simplified dubbing wiring', () => {
  it('mounts the simplified dubbing tab and disables the legacy tab', () => {
    expect(mainAppSource).toContain("import { SimplifiedDubbingTab } from '../src/features/dubbing/components/SimplifiedDubbingTab';");
    expect(mainAppSource).toContain('const LEGACY_DUBBING_UI_ENABLED = false;');
    expect(mainAppSource).toContain('<SimplifiedDubbingTab');
    expect(mainAppSource).toContain('{LEGACY_DUBBING_UI_ENABLED && activeTab === Tab.DUBBING && (');
  });

  it('submits adaptive route and quality defaults from the simplified dubbing tab', () => {
    expect(dubbingSource).toContain("tts_route: 'auto'");
    expect(dubbingSource).toContain('processing_profile: processingProfile');
    expect(dubbingSource).toContain('source_language_mode: sourceLanguageMode');
    expect(dubbingSource).toContain('Route: Auto voice engine.');
    expect(dubbingSource).toContain('resolveDubbingProcessingProfile');
    expect(dubbingSource).toContain('resolveDubbingSourceLanguageMode');
  });
});
