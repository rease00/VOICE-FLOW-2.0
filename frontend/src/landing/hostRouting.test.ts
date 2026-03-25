import { describe, expect, it } from 'vitest';
import { resolvePublicSurface } from './hostRouting';
import { LEGAL_LINKS, resolveLegalDocument } from './legal/legalContent';

describe('resolvePublicSurface', () => {
  it('routes root domain to landing surface', () => {
    const result = resolvePublicSurface('v-flow-ai.com', '/');
    expect(result.surface).toBe('landing');
    expect(result.legalDocument).toBeNull();
  });

  it('routes app path on root domain to app surface', () => {
    const result = resolvePublicSurface('v-flow-ai.com', '/app');
    expect(result.surface).toBe('app');
    expect(result.legalDocument).toBeNull();
  });

  it('routes billing path on root domain to billing surface', () => {
    const result = resolvePublicSurface('v-flow-ai.com', '/billing');
    expect(result.surface).toBe('billing');
    expect(result.legalDocument).toBeNull();
  });

  it('routes billing path on app domain to billing surface', () => {
    const result = resolvePublicSurface('app.v-flow-ai.com', '/billing');
    expect(result.surface).toBe('billing');
    expect(result.legalDocument).toBeNull();
  });

  it('routes app domain to app surface', () => {
    const result = resolvePublicSurface('app.v-flow-ai.com', '/');
    expect(result.surface).toBe('app');
    expect(result.legalDocument).toBeNull();
  });

  it('routes legal paths to legal surface from any host', () => {
    const result = resolvePublicSurface('app.v-flow-ai.com', '/legal/privacy');
    expect(result.surface).toBe('legal');
    expect(result.legalDocument?.id).toBe('privacy');
  });

  it('routes legal index path to legal surface without active document', () => {
    const result = resolvePublicSurface('v-flow-ai.com', '/legal');
    expect(result.surface).toBe('legal');
    expect(result.legalDocument).toBeNull();
  });
});

describe('legal content contract', () => {
  it('exposes all required legal routes', () => {
    const requiredRoutes = [
      '/legal/terms',
      '/legal/privacy',
      '/legal/acceptable-use',
      '/legal/cookies',
      '/legal/billing-refunds',
      '/legal/copyright',
    ];

    const publishedRoutes = LEGAL_LINKS.map((item) => item.path);
    expect(publishedRoutes).toEqual(requiredRoutes);
  });

  it('resolves each legal route to a document', () => {
    LEGAL_LINKS.forEach((link) => {
      const document = resolveLegalDocument(link.path);
      expect(document).not.toBeNull();
      expect(document?.title.length).toBeGreaterThan(3);
    });
  });
});
