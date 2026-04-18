import React from 'react';
import { LEGAL_LINKS } from './legalContent';
import type { LegalLink } from './legalContent';

interface LegalLinksProps {
  className?: string;
  linkClassName?: string;
  activePath?: string;
  extraLinks?: LegalLink[];
}

const joinClasses = (...tokens: Array<string | undefined>): string =>
  tokens.filter(Boolean).join(' ');

export const LegalLinks: React.FC<LegalLinksProps> = ({
  className,
  linkClassName,
  activePath,
  extraLinks = [],
}) => {
  const links = [...LEGAL_LINKS, ...extraLinks];

  return (
    <nav className={joinClasses('flex flex-wrap items-center gap-3', className)} aria-label="Legal links">
      {links.map((link) => {
        const isActive = activePath === link.path;
        return (
          <a
            key={link.path}
            href={link.path}
            className={joinClasses(
              'inline-flex min-h-11 items-center rounded-full px-2.5 py-2 text-xs font-semibold leading-none tracking-wide transition-colors',
              isActive ? 'text-gray-900 underline underline-offset-4' : 'text-gray-600 hover:text-gray-900',
              linkClassName
            )}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
};
