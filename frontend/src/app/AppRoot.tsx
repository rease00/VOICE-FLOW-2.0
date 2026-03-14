import React, { useEffect, useMemo } from 'react';
import { AppErrorBoundary } from './errors/AppErrorBoundary';
import { AppProviders } from './providers/AppProviders';
import { ScreenRouter } from './router/ScreenRouter';
import { MarketingLanding } from '../landing/MarketingLanding';
import { resolvePublicSurface } from '../landing/hostRouting';
import { LegalCenter } from '../landing/legal/LegalCenter';
import { applySeoMeta } from '../landing/seo';

const AppRoot: React.FC = () => {
  const resolution = useMemo(() => {
    if (typeof window === 'undefined') {
      return resolvePublicSurface('', '/');
    }
    return resolvePublicSurface(window.location.hostname, window.location.pathname);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    const previousOverflowY = document.body.style.overflowY;
    document.body.style.overflow = resolution.surface === 'app' ? 'hidden' : 'auto';
    document.body.style.overflowY = resolution.surface === 'app' ? 'hidden' : 'auto';

    if (resolution.surface === 'landing') {
      applySeoMeta({
        title: 'VoiceFlow | AI Voice Studio for Creators',
        description:
          'Create production-ready voice content with VoiceFlow. Start free, scale with your audience, and ship faster.',
        canonicalUrl: 'https://v-flow-ai.com/',
      });
    } else if (resolution.surface === 'legal') {
      const documentTitle = resolution.legalDocument
        ? `${resolution.legalDocument.title} | VoiceFlow`
        : 'Legal Center | VoiceFlow';
      const description = resolution.legalDocument?.description
        || 'VoiceFlow policy center for terms, privacy, acceptable use, cookies, and billing policies.';
      const canonicalPath = resolution.legalDocument?.path || '/legal';
      applySeoMeta({
        title: documentTitle,
        description,
        canonicalUrl: `https://v-flow-ai.com${canonicalPath}`,
      });
    } else {
      applySeoMeta({
        title: 'VoiceFlow Studio',
        description: 'VoiceFlow application workspace.',
        canonicalUrl: 'https://v-flow-ai.com/app',
        robots: 'noindex,nofollow',
      });
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overflowY = previousOverflowY;
    };
  }, [resolution]);

  if (resolution.surface === 'landing') {
    return <MarketingLanding />;
  }

  if (resolution.surface === 'legal') {
    return <LegalCenter activeDocument={resolution.legalDocument} />;
  }

  return (
    <AppProviders>
      <AppErrorBoundary>
        <ScreenRouter />
      </AppErrorBoundary>
    </AppProviders>
  );
};

export default AppRoot;
