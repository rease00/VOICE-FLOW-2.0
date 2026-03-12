const DEFAULT_STUDIO_OBJECT_URL_MAX = 64;

const isBlobObjectUrl = (value: unknown): value is string => {
  const url = String(value || '').trim();
  return Boolean(url) && url.startsWith('blob:');
};

interface StudioObjectUrlRegistryOptions {
  maxTracked?: number;
  revokeObjectUrl?: (url: string) => void;
}

export interface StudioObjectUrlRegistry {
  register: (url: string | null | undefined) => void;
  revoke: (url: string | null | undefined) => void;
  replace: (currentUrl: string | null | undefined, nextUrl: string | null | undefined) => void;
  reconcile: (visibleHistoryUrls: Array<string | null | undefined>, pinnedUrls?: Array<string | null | undefined>) => void;
  clear: () => void;
  getTrackedCount: () => number;
}

export const createStudioObjectUrlRegistry = (
  options?: StudioObjectUrlRegistryOptions
): StudioObjectUrlRegistry => {
  const maxTracked = Math.max(1, Math.floor(Number(options?.maxTracked) || DEFAULT_STUDIO_OBJECT_URL_MAX));
  const revokeObjectUrl = options?.revokeObjectUrl || ((url: string) => URL.revokeObjectURL(url));
  const tracked = new Set<string>();
  const insertionOrder: string[] = [];

  const removeFromInsertionOrder = (target: string): void => {
    const index = insertionOrder.indexOf(target);
    if (index >= 0) insertionOrder.splice(index, 1);
  };

  const register = (url: string | null | undefined): void => {
    if (!isBlobObjectUrl(url)) return;
    const safeUrl = String(url);
    if (tracked.has(safeUrl)) return;
    tracked.add(safeUrl);
    insertionOrder.push(safeUrl);
  };

  const revokeTracked = (url: string): void => {
    if (!tracked.has(url)) return;
    tracked.delete(url);
    removeFromInsertionOrder(url);
    try {
      revokeObjectUrl(url);
    } catch {
      // Ignore revoke failures; object URLs can be revoked more than once safely.
    }
  };

  const revoke = (url: string | null | undefined): void => {
    if (!isBlobObjectUrl(url)) return;
    revokeTracked(String(url));
  };

  const replace = (currentUrl: string | null | undefined, nextUrl: string | null | undefined): void => {
    if (isBlobObjectUrl(nextUrl)) register(nextUrl);
    if (isBlobObjectUrl(currentUrl) && String(currentUrl) !== String(nextUrl || '')) {
      const safeCurrent = String(currentUrl);
      if (tracked.has(safeCurrent)) {
        revokeTracked(safeCurrent);
      } else {
        try {
          revokeObjectUrl(safeCurrent);
        } catch {
          // Ignore revoke failures; object URLs can be revoked more than once safely.
        }
      }
    }
  };

  const trimToMax = (keep: Set<string>): void => {
    while (tracked.size > maxTracked) {
      const candidate = insertionOrder.find((item) => tracked.has(item) && !keep.has(item));
      if (!candidate) break;
      revokeTracked(candidate);
    }
  };

  const reconcile = (
    visibleHistoryUrls: Array<string | null | undefined>,
    pinnedUrls: Array<string | null | undefined> = []
  ): void => {
    const keep = new Set<string>();
    for (const url of visibleHistoryUrls) {
      if (!isBlobObjectUrl(url)) continue;
      const safeUrl = String(url);
      register(safeUrl);
      keep.add(safeUrl);
    }
    for (const url of pinnedUrls) {
      if (!isBlobObjectUrl(url)) continue;
      const safeUrl = String(url);
      register(safeUrl);
      keep.add(safeUrl);
    }
    for (const existingUrl of [...tracked]) {
      if (keep.has(existingUrl)) continue;
      revokeTracked(existingUrl);
    }
    trimToMax(keep);
  };

  const clear = (): void => {
    for (const existingUrl of [...tracked]) {
      revokeTracked(existingUrl);
    }
  };

  const getTrackedCount = (): number => tracked.size;

  return {
    register,
    revoke,
    replace,
    reconcile,
    clear,
    getTrackedCount,
  };
};

export const __studioObjectUrlRegistryTestOnly = {
  isBlobObjectUrl,
};
