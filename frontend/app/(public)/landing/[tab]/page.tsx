import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicLandingPage } from '../../../../src/features/landing/PublicLandingPage';
import { landingMetadata } from '../../../../src/features/landing/landingMetadata';
import { LANDING_TAB_KEYS, type LandingTabKey } from '../../../../src/features/landing/MarketingLanding';

interface LandingTabPageProps {
  params: Promise<{ tab: string }>;
}

const TAB_TITLES: Record<LandingTabKey, string> = {
  home: 'Home',
  'single-voice': 'Single Voice',
  'prime-scenes': 'Prime Scenes',
  'clone-proof': 'Clone Proof',
  direction: 'Direction',
  writing: 'Writing',
};

const normalizeTab = (raw: string): LandingTabKey | null => {
  const value = String(raw || '').trim().toLowerCase();
  return LANDING_TAB_KEYS.includes(value as LandingTabKey) ? (value as LandingTabKey) : null;
};

const resolveTabFromParams = async (
  params: LandingTabPageProps['params'],
): Promise<LandingTabKey | null> => {
  const resolved = await params;
  return normalizeTab(resolved.tab);
};

export async function generateStaticParams(): Promise<Array<{ tab: LandingTabKey }>> {
  return LANDING_TAB_KEYS.map((tab) => ({ tab }));
}

export async function generateMetadata({ params }: LandingTabPageProps): Promise<Metadata> {
  const tab = await resolveTabFromParams(params);
  if (!tab) return landingMetadata;
  if (tab === 'home') {
    return {
      ...landingMetadata,
      title: 'Home | V FLOW AI',
      alternates: {
        canonical: '/landing',
      },
    };
  }

  return {
    ...landingMetadata,
    title: `${TAB_TITLES[tab]} | V FLOW AI`,
    alternates: {
      canonical: `/landing/${tab}`,
    },
  };
}

export default async function LandingTabPage({ params }: LandingTabPageProps) {
  const tab = await resolveTabFromParams(params);
  if (!tab) notFound();
  return <PublicLandingPage activeTab={tab} />;
}
