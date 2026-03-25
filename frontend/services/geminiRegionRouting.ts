import { STORAGE_KEYS } from "../src/shared/storage/keys";

export interface GeminiRegionSelection {
  regionHint: string;
  regionSource: string;
}

const REGION_HINT_BY_LOCALE_COUNTRY: Record<string, string> = {
  IN: 'asia',
  PK: 'asia',
  BD: 'asia',
  NP: 'asia',
  LK: 'asia',
  BT: 'asia',
  MV: 'asia',
  ID: 'asia',
  TH: 'asia',
  VN: 'asia',
  PH: 'asia',
  SG: 'asia',
  MY: 'asia',
  KH: 'asia',
  LA: 'asia',
  CN: 'asia',
  JP: 'asia',
  KR: 'asia',
  TW: 'asia',
  HK: 'asia',
  GB: 'europe',
  IE: 'europe',
  FR: 'europe',
  DE: 'europe',
  ES: 'europe',
  IT: 'europe',
  PT: 'europe',
  NL: 'europe',
  BE: 'europe',
  CH: 'europe',
  AT: 'europe',
  SE: 'europe',
  NO: 'europe',
  DK: 'europe',
  FI: 'europe',
  PL: 'europe',
  CZ: 'europe',
  HU: 'europe',
  RO: 'europe',
  GR: 'europe',
  UA: 'europe',
  TR: 'europe',
  US: 'north-america',
  CA: 'north-america',
  MX: 'north-america',
  BR: 'south-america',
  AR: 'south-america',
  CL: 'south-america',
  PE: 'south-america',
  CO: 'south-america',
  UY: 'south-america',
  PY: 'south-america',
  BO: 'south-america',
  EC: 'south-america',
  VE: 'south-america',
  AU: 'oceania',
  NZ: 'oceania',
  ZA: 'africa',
  EG: 'africa',
  NG: 'africa',
  KE: 'africa',
  GH: 'africa',
  MA: 'africa',
  DZ: 'africa',
  TN: 'africa',
  SN: 'africa',
  ET: 'africa',
};

const SOUTH_AMERICA_TIME_ZONE_HINTS = [
  'buenos_aires',
  'sao_paulo',
  'santiago',
  'lima',
  'bogota',
  'caracas',
  'montevideo',
  'asuncion',
  'riodejaneiro',
  'fortaleza',
  'recife',
  'salvador',
  'brasilia',
  'manaus',
  'porto_velho',
  'porto_alegre',
  'cuiaba',
  'mendoza',
  'argentina',
  'chile',
  'peru',
  'colombia',
  'ecuador',
  'bolivia',
  'paraguay',
  'uruguay',
  'venezuela',
];

const REGION_HINT_BY_TIME_ZONE: Array<[RegExp, string]> = [
  [/^asia\//i, 'asia'],
  [/^europe\//i, 'europe'],
  [/^africa\//i, 'africa'],
  [/^(australia|pacific)\//i, 'oceania'],
  [/^atlantic\//i, 'north-america'],
  [/^america\//i, 'north-america'],
];

const REGION_HINT_BY_LOCATION_PREFIXES: Array<[RegExp, string]> = [
  [/^(?:asia|apac)(?:-|$)/i, 'asia'],
  [/^(?:europe|emea|eu)(?:-|$)/i, 'europe'],
  [/^(?:northamerica|north-america|north_america|us)(?:-|$)/i, 'north-america'],
  [/^(?:southamerica|south-america|south_america|latam)(?:-|$)/i, 'south-america'],
  [/^(?:australia|oceania|pacific|anz)(?:-|$)/i, 'oceania'],
  [/^(?:africa)(?:-|$)/i, 'africa'],
];

const normalizeRegionHint = (value: unknown): string => {
  const token = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!token) return '';
  const normalized = token.replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '');
  return normalized;
};

const normalizeRegionSource = (value: unknown): string => {
  const token = String(value || '').trim().toLowerCase();
  return token.replace(/[^a-z0-9:_-]+/g, '-');
};

const deriveAutoRegionHint = (): GeminiRegionSelection => {
  if (typeof window === 'undefined') {
    return { regionHint: '', regionSource: '' };
  }

  const localeCandidates = [
    ...((typeof navigator !== 'undefined' && Array.isArray(navigator.languages) ? navigator.languages : []) || []),
    (typeof navigator !== 'undefined' ? navigator.language : '') || '',
  ].map((item) => String(item || '').trim()).filter(Boolean);

  for (const locale of localeCandidates) {
    const countryMatch = locale.match(/-([a-z]{2}|\d{3})$/i);
    const country = countryMatch?.[1]?.toUpperCase() || '';
    if (!country) continue;
    const regionHint = REGION_HINT_BY_LOCALE_COUNTRY[country];
    if (regionHint) {
      return { regionHint, regionSource: 'client:auto' };
    }
  }

  const timeZone = String(
    Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  ).trim().toLowerCase().replace(/_/g, '-');
  if (timeZone) {
    const southAmericaMatch = SOUTH_AMERICA_TIME_ZONE_HINTS.some((needle) => timeZone.includes(needle));
    if (southAmericaMatch) {
      return { regionHint: 'south-america', regionSource: 'client:auto' };
    }
    for (const [pattern, regionHint] of REGION_HINT_BY_TIME_ZONE) {
      if (pattern.test(timeZone)) {
        return { regionHint, regionSource: 'client:auto' };
      }
    }
  }

  return { regionHint: '', regionSource: '' };
};

const safeReadStorage = (key: string): string => {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
};

const safeWriteStorage = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!value) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage failures; region selection is a best-effort hint.
  }
};

export const deriveGeminiRegionSelectionFromLocation = (
  location: unknown,
  regionSource: string = 'login_auto_nearest'
): GeminiRegionSelection => {
  const safeLocation = normalizeRegionHint(location);
  const source = normalizeRegionSource(regionSource) || 'login_auto_nearest';
  if (safeLocation) {
    for (const [pattern, regionHint] of REGION_HINT_BY_LOCATION_PREFIXES) {
      if (pattern.test(safeLocation)) {
        return { regionHint, regionSource: source };
      }
    }
  }
  const autoSelection = deriveAutoRegionHint();
  if (autoSelection.regionHint) {
    return {
      regionHint: autoSelection.regionHint,
      regionSource: source,
    };
  }
  return {
    regionHint: '',
    regionSource: source,
  };
};

export const setGeminiRegionSelection = (selection: Partial<GeminiRegionSelection> | null | undefined): void => {
  if (typeof window === 'undefined') return;
  const regionHint = normalizeRegionHint(selection?.regionHint || '');
  const regionSource = normalizeRegionSource(selection?.regionSource || '');
  safeWriteStorage(STORAGE_KEYS.regionHint, regionHint);
  safeWriteStorage(STORAGE_KEYS.regionSource, regionHint ? regionSource : '');
  try {
    (window as any).__VF_REGION_HINT = regionHint;
    (window as any).__VF_REGION_SOURCE = regionHint ? regionSource : '';
    (window as any).__vfRegionHint = regionHint;
    (window as any).__vfRegionSource = regionHint ? regionSource : '';
  } catch {
    // Keep the localStorage path authoritative.
  }
};

export const clearGeminiRegionSelection = (): void => {
  setGeminiRegionSelection({ regionHint: '', regionSource: '' });
};

export const resolveGeminiRegionSelection = (): GeminiRegionSelection => {
  const storedHint = normalizeRegionHint(safeReadStorage(STORAGE_KEYS.regionHint));
  const storedSource = normalizeRegionSource(safeReadStorage(STORAGE_KEYS.regionSource));
  if (storedHint) {
    return {
      regionHint: storedHint,
      regionSource: storedSource || 'client',
    };
  }

  if (storedSource) {
    clearGeminiRegionSelection();
  }

  if (typeof window !== 'undefined') {
    const globalHint = normalizeRegionHint((window as any).__VF_REGION_HINT || (window as any).__vfRegionHint || '');
    const globalSource = normalizeRegionSource((window as any).__VF_REGION_SOURCE || (window as any).__vfRegionSource || '');
    if (globalHint) {
      return {
        regionHint: globalHint,
        regionSource: globalSource || 'client',
      };
    }

    if (globalSource) {
      clearGeminiRegionSelection();
    }
  }

  const autoSelection = deriveAutoRegionHint();
  if (autoSelection.regionHint) {
    setGeminiRegionSelection(autoSelection);
    return autoSelection;
  }

  return {
    regionHint: 'global',
    regionSource: 'client',
  };
};
