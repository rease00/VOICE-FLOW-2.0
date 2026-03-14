import React from 'react';
import { LEGAL_LINKS } from './legal/legalContent';

interface LegalLinksProps {
  className?: string;
  linkClassName?: string;
  activePath?: string;
}

const joinClasses = (...tokens: Array<string | undefined>): string =>
  tokens.filter(Boolean).join(' ');

export const LegalLinks: React.FC<LegalLinksProps> = ({
  className,
  linkClassName,
  activePath,
}) => {
  return (
    <nav className={joinClasses('flex flex-wrap items-center gap-3', className)} aria-label="Legal links">
      {LEGAL_LINKS.map((link) => {
        const isActive = activePath === link.path;
        return (
          <a
            key={link.path}
            href={link.path}
            className={joinClasses(
              'text-xs font-semibold tracking-wide transition-colors',
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
