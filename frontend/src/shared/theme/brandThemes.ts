export type UiBrandThemeId = 'neon' | 'aurora' | 'sunset' | 'emerald';

export interface UiBrandThemeConfig {
  id: UiBrandThemeId;
  label: string;
  description: string;
  accent: string;
  accent2: string;
  accent3: string;
  glow: string;
  backdrop: string;
  surface: string;
}

export const UI_BRAND_THEME_ORDER: readonly UiBrandThemeId[] = ['neon', 'aurora', 'sunset', 'emerald'] as const;

export const UI_BRAND_THEME_CONFIGS: Record<UiBrandThemeId, UiBrandThemeConfig> = {
  neon: {
    id: 'neon',
    label: 'Neon Pulse',
    description: 'High-contrast cyan and electric blue with a premium studio glow.',
    accent: '#22d3ee',
    accent2: '#8b5cf6',
    accent3: '#ec4899',
    glow: 'rgba(34, 211, 238, 0.36)',
    backdrop: 'linear-gradient(180deg, #040913 0%, #081423 48%, #03060d 100%)',
    surface: 'rgba(8, 14, 28, 0.86)',
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora Drift',
    description: 'Cool teal and violet gradients with a polished glass atmosphere.',
    accent: '#8b5cf6',
    accent2: '#22d3ee',
    accent3: '#34d399',
    glow: 'rgba(139, 92, 246, 0.30)',
    backdrop: 'linear-gradient(180deg, #06111a 0%, #091826 42%, #04070f 100%)',
    surface: 'rgba(9, 18, 33, 0.84)',
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset Ember',
    description: 'Warm coral, amber, and magenta energy for campaign-style moments.',
    accent: '#fb7185',
    accent2: '#fb923c',
    accent3: '#a78bfa',
    glow: 'rgba(251, 113, 133, 0.30)',
    backdrop: 'linear-gradient(180deg, #12080f 0%, #170b14 44%, #070912 100%)',
    surface: 'rgba(22, 10, 17, 0.84)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Signal',
    description: 'Deep green and cyan interplay with a premium broadcast feel.',
    accent: '#34d399',
    accent2: '#10b981',
    accent3: '#22d3ee',
    glow: 'rgba(52, 211, 153, 0.28)',
    backdrop: 'linear-gradient(180deg, #06110f 0%, #081916 44%, #04070f 100%)',
    surface: 'rgba(8, 20, 17, 0.84)',
  },
};

export const DEFAULT_UI_BRAND_THEME: UiBrandThemeId = 'neon';

export const resolveUiBrandThemeId = (value: unknown): UiBrandThemeId => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'neon' || token === 'aurora' || token === 'sunset' || token === 'emerald') {
    return token;
  }
  return DEFAULT_UI_BRAND_THEME;
};

export const getUiBrandThemeLabel = (themeId: UiBrandThemeId): string => UI_BRAND_THEME_CONFIGS[themeId].label;
