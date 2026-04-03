export type UiBrandThemeId = 'neon' | 'aurora' | 'sunset' | 'emerald';

export interface UiBrandThemeModeConfig {
  glow: string;
  backdrop: string;
  surface: string;
  surfaceStrong: string;
}

export interface UiBrandThemeConfig {
  id: UiBrandThemeId;
  label: string;
  description: string;
  accent: string;
  accent2: string;
  accent3: string;
  modes: {
    dark: UiBrandThemeModeConfig;
    light: UiBrandThemeModeConfig;
  };
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
    modes: {
      dark: {
        glow: 'rgba(34, 211, 238, 0.36)',
        backdrop: 'linear-gradient(180deg, #040913 0%, #081423 48%, #03060d 100%)',
        surface: 'rgba(8, 14, 28, 0.86)',
        surfaceStrong: 'rgba(10, 20, 37, 0.94)',
      },
      light: {
        glow: 'rgba(34, 211, 238, 0.28)',
        backdrop: 'linear-gradient(160deg, #e8f5ff 0%, #dbeafe 42%, #e6ebff 72%, #f3e7f4 100%)',
        surface: 'rgba(244, 249, 255, 0.92)',
        surfaceStrong: 'rgba(255, 255, 255, 0.98)',
      },
    },
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora Drift',
    description: 'Deep navy, teal, and warm amber with a premium studio atmosphere.',
    accent: '#38e8d0',
    accent2: '#4f7cff',
    accent3: '#ffb76b',
    modes: {
      dark: {
        glow: 'rgba(56, 232, 208, 0.34)',
        backdrop: 'linear-gradient(165deg, #03131d 0%, #072349 38%, #101d40 68%, #231523 100%)',
        surface: 'rgba(7, 22, 41, 0.84)',
        surfaceStrong: 'rgba(8, 26, 46, 0.92)',
      },
      light: {
        glow: 'rgba(79, 124, 255, 0.28)',
        backdrop: 'linear-gradient(165deg, #e5f7f3 0%, #e3edfb 36%, #edf1ff 70%, #fff0d8 100%)',
        surface: 'rgba(243, 248, 252, 0.92)',
        surfaceStrong: 'rgba(255, 255, 255, 0.98)',
      },
    },
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset Ember',
    description: 'Warm coral, amber, and magenta energy for campaign-style moments.',
    accent: '#fb7185',
    accent2: '#fb923c',
    accent3: '#a78bfa',
    modes: {
      dark: {
        glow: 'rgba(251, 113, 133, 0.30)',
        backdrop: 'linear-gradient(180deg, #12080f 0%, #170b14 44%, #070912 100%)',
        surface: 'rgba(22, 10, 17, 0.84)',
        surfaceStrong: 'rgba(29, 12, 21, 0.92)',
      },
      light: {
        glow: 'rgba(251, 113, 133, 0.26)',
        backdrop: 'linear-gradient(160deg, #fff0e8 0%, #ffe5dd 38%, #f5e5f1 100%)',
        surface: 'rgba(255, 246, 243, 0.92)',
        surfaceStrong: 'rgba(255, 255, 255, 0.98)',
      },
    },
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Signal',
    description: 'Deep green and cyan interplay with a premium broadcast feel.',
    accent: '#34d399',
    accent2: '#10b981',
    accent3: '#22d3ee',
    modes: {
      dark: {
        glow: 'rgba(52, 211, 153, 0.28)',
        backdrop: 'linear-gradient(180deg, #06110f 0%, #081916 44%, #04070f 100%)',
        surface: 'rgba(8, 20, 17, 0.84)',
        surfaceStrong: 'rgba(8, 24, 20, 0.92)',
      },
      light: {
        glow: 'rgba(16, 185, 129, 0.26)',
        backdrop: 'linear-gradient(160deg, #e3f5eb 0%, #ddf0ea 42%, #e0eff8 100%)',
        surface: 'rgba(241, 248, 244, 0.92)',
        surfaceStrong: 'rgba(255, 255, 255, 0.98)',
      },
    },
  },
};

export const DEFAULT_UI_BRAND_THEME: UiBrandThemeId = 'aurora';

export const resolveUiBrandThemeId = (value: unknown): UiBrandThemeId => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'neon' || token === 'aurora' || token === 'sunset' || token === 'emerald') {
    return token;
  }
  return DEFAULT_UI_BRAND_THEME;
};

export const getUiBrandThemeLabel = (themeId: UiBrandThemeId): string => UI_BRAND_THEME_CONFIGS[themeId].label;
