import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PublicLandingPage } from '../../../../src/features/landing/PublicLandingPage';
import { buildLandingMetadata, landingMetadata } from '../../../../src/features/landing/landingMetadata';
import {
  LANDING_DETAIL_TAB_KEYS,
  type LandingDetailTabKey,
  type LandingPageVariant,
  resolveLandingPageVariant,
} from '../../../../src/features/landing/landingTabs';

interface LandingTabPageProps {
  params: Promise<{ tab: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const resolveTabFromParams = async (
  params: LandingTabPageProps['params'],
): Promise<string> => {
  const resolved = await params;
  return String(resolved.tab || '').trim().toLowerCase();
};

const LEGACY_LANDING_REDIRECTS: Record<string, LandingPageVariant> = {
  home: 'overview',
  overview: 'overview',
  writing: 'overview',
  studio: 'overview',
  voice: 'single-voice',
  voices: 'single-voice',
  single: 'single-voice',
  'single-speaker': 'single-voice',
  prime: 'prime-scenes',
  scenes: 'prime-scenes',
  'multi-speaker': 'prime-scenes',
  clone: 'direction',
  cloning: 'direction',
  'clone-proof': 'direction',
  'voice-cloning': 'direction',
  director: 'direction',
  'ai-director': 'direction',
  review: 'reader',
  playback: 'reader',
  'reader-review': 'reader',
};

const resolveLegacyLandingTarget = (value: string): LandingPageVariant | null => (
  LEGACY_LANDING_REDIRECTS[value] || null
);

const resolveLegacyLandingHref = (value: string): string | null => {
  const legacyTarget = resolveLegacyLandingTarget(value);
  if (!legacyTarget) return null;
  return legacyTarget === 'overview'
    ? '/landing'
    : `/landing/${legacyTarget}`;
};

const appendSearchParams = (
  href: string,
  searchParams?: Record<string, string | string[] | undefined>,
): string => {
  if (!searchParams) return href;

  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (typeof value === 'string' && value.length > 0) {
          query.append(key, value);
        }
      }
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.length > 0) {
      query.set(key, rawValue);
    }
  }

  const queryString = query.toString();
  return queryString ? `${href}?${queryString}` : href;
};

export async function generateStaticParams(): Promise<Array<{ tab: LandingDetailTabKey }>> {
  return LANDING_DETAIL_TAB_KEYS.map((tab) => ({ tab }));
}

export async function generateMetadata({ params }: LandingTabPageProps): Promise<Metadata> {
  const rawTab = await resolveTabFromParams(params);
  const legacyTarget = resolveLegacyLandingTarget(rawTab);
  if (legacyTarget === 'overview') return landingMetadata;
  if (legacyTarget) {
    return buildLandingMetadata(legacyTarget);
  }
  const page = resolveLandingPageVariant(rawTab);
  if (!page || page === 'overview') return landingMetadata;
  return buildLandingMetadata(page);
}

export default async function LandingTabPage({ params, searchParams }: LandingTabPageProps) {
  const rawTab = await resolveTabFromParams(params);
  const legacyHref = resolveLegacyLandingHref(rawTab);
  if (legacyHref) {
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    redirect(appendSearchParams(legacyHref, resolvedSearchParams));
  }

  const page = resolveLandingPageVariant(rawTab);
  if (!page || page === 'overview') notFound();
  return <PublicLandingPage activePage={page} />;
}
