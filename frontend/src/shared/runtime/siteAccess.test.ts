import { describe, expect, it } from 'vitest';
import { isPublicDeploymentHost, resolveRequestHost, shouldEnforcePrivateMode } from './siteAccess';

describe('isPublicDeploymentHost', () => {
  it('treats the production custom domain as public', () => {
    expect(isPublicDeploymentHost('v-flow-ai.com')).toBe(true);
    expect(isPublicDeploymentHost('www.v-flow-ai.com')).toBe(true);
  });

  it('treats Cloudflare Pages hosts as public', () => {
    expect(isPublicDeploymentHost('v-flow-ai.pages.dev')).toBe(true);
  });

  it('keeps unrelated hosts private-capable', () => {
    expect(isPublicDeploymentHost('preview.voiceflow.internal')).toBe(false);
  });
});

describe('shouldEnforcePrivateMode', () => {
  it('never locks public deployment hosts even when private mode is enabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'v-flow-ai.com')).toBe(false);
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'v-flow-ai.pages.dev')).toBe(false);
  });

  it('locks non-public hosts when private mode is enabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '1' }, 'preview.voiceflow.internal')).toBe(true);
  });

  it('stays open when private mode is disabled', () => {
    expect(shouldEnforcePrivateMode({ VF_SITE_PRIVATE: '0' }, 'preview.voiceflow.internal')).toBe(false);
  });
});

describe('resolveRequestHost', () => {
  it('prefers forwarded host headers when available', () => {
    expect(
      resolveRequestHost({
        url: 'https://deployment.example.pages.dev/',
        headers: new Headers({
          host: 'deployment.example.pages.dev',
          'x-forwarded-host': 'v-flow-ai.com',
        }),
      }),
    ).toBe('v-flow-ai.com');
  });

  it('falls back to the request URL host when headers are missing', () => {
    expect(
      resolveRequestHost({
        url: 'https://v-flow-ai.pages.dev/',
      }),
    ).toBe('v-flow-ai.pages.dev');
  });

  it('normalizes ports and casing out of the resolved host', () => {
    expect(
      resolveRequestHost({
        url: 'https://deployment.example.pages.dev/',
        headers: new Headers({
          host: 'V-FLOW-AI.COM:443',
        }),
      }),
    ).toBe('v-flow-ai.com');
  });
});
