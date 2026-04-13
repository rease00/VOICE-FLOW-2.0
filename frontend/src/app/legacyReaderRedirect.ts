export type LegacyReaderSearchParams = Record<string, string | string[] | undefined>;

const LEGACY_READER_MODE_TOKENS = new Set(['novel', 'book', 'comic', 'manga']);
const LEGACY_READER_STATE_KEYS = new Set([
  'vf-reader-mode',
  'vf-reader-item',
  'vf-reader-title',
]);

const normalizeSegments = (segments: string[] | undefined): string[] => (
  (segments || [])
    .map((segment) => decodeURIComponent(String(segment || '').trim()))
    .filter(Boolean)
);

const appendSearchParam = (params: URLSearchParams, key: string, value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const safeEntry = String(entry || '').trim();
      if (safeEntry) params.append(key, safeEntry);
    });
    return;
  }

  const safeValue = String(value || '').trim();
  if (safeValue) params.set(key, safeValue);
};

const resolveBookIdFromSegments = (segments: string[]): string => {
  if (segments.length >= 2 && LEGACY_READER_MODE_TOKENS.has(segments[0]!.toLowerCase())) {
    return segments[1]!;
  }

  if (segments.length >= 1 && !LEGACY_READER_MODE_TOKENS.has(segments[0]!.toLowerCase())) {
    return segments[segments.length - 1]!;
  }

  return '';
};

const resolveBookIdFromSearchParams = (searchParams: LegacyReaderSearchParams | undefined): string => {
  const fromItem = searchParams?.['vf-reader-item'];
  if (Array.isArray(fromItem)) {
    const first = String(fromItem[0] || '').trim();
    if (first) return first;
  } else {
    const single = String(fromItem || '').trim();
    if (single) return single;
  }

  const fromTitle = searchParams?.['vf-reader-title'];
  if (Array.isArray(fromTitle)) {
    const first = String(fromTitle[0] || '').trim();
    if (first) return first;
  } else {
    const single = String(fromTitle || '').trim();
    if (single) return single;
  }

  return '';
};

const serializeRetainedSearchParams = (searchParams: LegacyReaderSearchParams | undefined): string => {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (LEGACY_READER_STATE_KEYS.has(key)) return;
    appendSearchParam(params, key, value);
  });
  return params.toString();
};

export const resolveLegacyReaderRedirect = (
  slug: string[] | undefined,
  searchParams?: LegacyReaderSearchParams,
): string => {
  const normalizedSegments = normalizeSegments(slug);
  const retainedQuery = serializeRetainedSearchParams(searchParams);
  const bookId = resolveBookIdFromSegments(normalizedSegments) || resolveBookIdFromSearchParams(searchParams);
  const pathname = bookId
    ? `/app/library/${encodeURIComponent(bookId)}/read`
    : '/app/library';

  return retainedQuery ? `${pathname}?${retainedQuery}` : pathname;
};
