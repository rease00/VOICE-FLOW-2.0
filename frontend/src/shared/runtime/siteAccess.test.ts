import { describe, expect, it } from 'vitest';
import { isPublicDeploymentHost, shouldEnforcePrivateMode } from './siteAccess';

describe('isPublicDeploymentHost', () => {
  it('treats the production custom domain as public', () => {
    expect(isPublicDeploymentHost('v-flow-ai.com')).toBe(true);
    expect(isPublicDeploymentHost('www.v-flow-ai.com')).toBe(true);
  });

  it('treats Cloudflare Pages hosts as public', () => {
    expect(isPublicDeploymentHost('voice-flow-bl1.pages.dev')).toBe(true);
  });

  it('keeps unrelated hosts private-capable', () => {
    expect(isPublicDeploymentHost('preview.voiceflow.internal')).toBe(false);
  });
});

describe('shouldEnforcePrivateMode', () => {
  it('never locks public deployment hosts even when private mode is enabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'v-flow-ai.com')).toBe(false);
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'voice-flow-bl1.pages.dev')).toBe(false);
  });

  it('locks non-public hosts when private mode is enabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'preview.voiceflow.internal')).toBe(true);
  });

  it('stays open when private mode is disabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '0' }, 'preview.voiceflow.internal')).toBe(false);
  });
});
