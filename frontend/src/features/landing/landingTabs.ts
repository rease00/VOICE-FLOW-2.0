export const LANDING_DETAIL_TAB_KEYS = [
  'single-voice',
  'prime-scenes',
  'direction',
  'reader',
] as const;

export type LandingDetailTabKey = (typeof LANDING_DETAIL_TAB_KEYS)[number];
export type LandingPageVariant = 'overview' | LandingDetailTabKey;

export interface LandingTabDefinition {
  key: LandingPageVariant;
  label: string;
  href: string;
  title: string;
  description: string;
}

export const LANDING_HEADER_TABS: readonly LandingTabDefinition[] = [
  {
    key: 'overview',
    label: 'Overview',
    href: '/landing',
    title: 'Overview',
    description: 'See the full Voice Flow production tour in one compact pass.',
  },
  {
    key: 'single-voice',
    label: 'Single Voice',
    href: '/landing/single-voice',
    title: 'Single Voice',
    description: 'Audition short reads quickly before opening the full studio.',
  },
  {
    key: 'prime-scenes',
    label: 'Prime Scenes',
    href: '/landing/prime-scenes',
    title: 'Prime Scenes',
    description: 'Hear multi-speaker scenes with cast contrast and pacing already visible.',
  },
  {
    key: 'direction',
    label: 'AI Direction',
    href: '/landing/direction',
    title: 'AI Direction',
    description: 'Tighten delivery with a prompt contract that stays readable.',
  },
  {
    key: 'reader',
    label: 'Reader',
    href: '/landing/reader',
    title: 'Reader Review',
    description: 'Close the loop with a lighter reader-ready review surface.',
  },
] as const;

export const isLandingDetailTab = (value?: string | null): value is LandingDetailTabKey => (
  LANDING_DETAIL_TAB_KEYS.includes(String(value || '').trim().toLowerCase() as LandingDetailTabKey)
);

export const resolveLandingPageVariant = (value?: string | null): LandingPageVariant | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'home' || normalized === 'overview') return 'overview';
  return isLandingDetailTab(normalized) ? normalized : null;
};

export const getLandingTabDefinition = (key: LandingPageVariant): LandingTabDefinition => {
  const match = LANDING_HEADER_TABS.find((entry) => entry.key === key);
  if (!match) {
    throw new Error(`Unknown landing page variant: ${key}`);
  }
  return match;
};

export interface LandingNextAction {
  href: string;
  label: string;
  kicker: string;
}

export const resolveLandingNextAction = (key: LandingPageVariant): LandingNextAction => {
  switch (key) {
    case 'overview':
      return { href: '/landing/single-voice', label: 'Next: Single Voice', kicker: 'Start the tour' };
    case 'single-voice':
      return { href: '/landing/prime-scenes', label: 'Next: Prime Scenes', kicker: 'Move forward' };
    case 'prime-scenes':
      return { href: '/landing/direction', label: 'Next: AI Direction', kicker: 'Move forward' };
    case 'direction':
      return { href: '/landing/reader', label: 'Next: Reader Review', kicker: 'Move forward' };
    case 'reader':
      return { href: '/app/studio', label: 'Open the Studio', kicker: 'Final step' };
    default:
      return { href: '/landing', label: 'Back to Overview', kicker: 'Continue' };
  }
};
