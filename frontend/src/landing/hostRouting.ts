import { isLegalPath, resolveLegalDocument, type LegalDocument } from './legal/legalContent';

export type PublicSurface = 'app' | 'landing' | 'legal' | 'billing';

export interface PublicSurfaceResolution {
  surface: PublicSurface;
  legalDocument: LegalDocument | null;
}

const LANDING_HOSTS = new Set(['v-flow-ai.com', 'www.v-flow-ai.com']);
const LANDING_ONLY_PATHS = new Set(['/', '/landing']);
const BILLING_PATHS = new Set(['/billing']);

const normalizeHost = (hostname: string): string =>
  String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

const normalizePath = (pathname: string): string => {
  const raw = String(pathname || '/').trim();
  if (!raw) return '/';
  const safe = raw.startsWith('/') ? raw : `/${raw}`;
  if (safe !== '/' && safe.endsWith('/')) return safe.slice(0, -1);
  return safe;
};

export const resolvePublicSurface = (
  hostname: string,
  pathname: string,
): PublicSurfaceResolution => {
  const safePath = normalizePath(pathname);
  const legalDocument = resolveLegalDocument(safePath);
  if (isLegalPath(safePath)) {
    return { surface: 'legal', legalDocument };
  }
  if (BILLING_PATHS.has(safePath)) {
    return { surface: 'billing', legalDocument: null };
  }

  const safeHost = normalizeHost(hostname);
  if (LANDING_HOSTS.has(safeHost)) {
    if (LANDING_ONLY_PATHS.has(safePath)) {
      return { surface: 'landing', legalDocument: null };
    }
    return { surface: 'app', legalDocument: null };
  }

  return { surface: 'app', legalDocument: null };
};
