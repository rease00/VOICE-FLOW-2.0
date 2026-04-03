import React from 'react';
import { Mic, Sparkles, Activity } from 'lucide-react';

type BrandSize = 'sm' | 'md' | 'lg' | 'hero';
type BrandTone = 'light' | 'dark';

interface BrandLogoProps {
  size?: BrandSize;
  tone?: BrandTone;
  showWordmark?: boolean;
  className?: string;
}

const SIZE_MAP: Record<
  BrandSize,
  {
    mark: string;
    markClass: string;
    mic: number;
    badge: number;
    title: string;
    subtitle: string;
    gap: string;
  }
> = {
  sm: {
    mark: 'h-9 w-9',
    markClass: '',
    mic: 11,
    badge: 7,
    title: 'text-base',
    subtitle: 'text-[11px] tracking-[0.18em]',
    gap: 'gap-2',
  },
  md: {
    mark: 'h-11 w-11',
    markClass: '',
    mic: 12,
    badge: 8,
    title: 'text-xl',
    subtitle: 'text-[12px] tracking-[0.2em]',
    gap: 'gap-3',
  },
  lg: {
    mark: 'h-14 w-14',
    markClass: '',
    mic: 18,
    badge: 10,
    title: 'text-3xl',
    subtitle: 'text-[12px] tracking-[0.22em]',
    gap: 'gap-3.5',
  },
  hero: {
    mark: 'h-[15rem] w-[15rem]',
    markClass: 'vf-brand-mark--hero',
    mic: 64,
    badge: 24,
    title: 'text-3xl',
    subtitle: 'text-[12px] tracking-[0.22em]',
    gap: 'gap-4',
  },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  tone = 'dark',
  showWordmark = true,
  className = '',
}) => {
  const spec = SIZE_MAP[size];
  const titleToneClass = tone === 'light' ? 'text-slate-100' : 'text-slate-900';
  const subtitleToneClass = tone === 'light' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`inline-flex items-center ${spec.gap} ${className}`} data-testid="brand-logo">
      <span
        className={`vf-brand-mark vf-brand-mark--live relative inline-flex shrink-0 ${spec.mark} ${spec.markClass}`}
        aria-hidden="true"
        data-testid="brand-logo-mark"
      >
        <span className="vf-brand-mark__orb" />
        <span className="vf-brand-mark__shell">
          <span className="vf-brand-mark__core">
            <Mic size={spec.mic} strokeWidth={2.6} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />
          </span>
        </span>
        <span className="vf-brand-mark__badge vf-brand-mark__badge--spark">
          <Sparkles size={spec.badge} strokeWidth={2.7} className="text-white" />
        </span>
        <span className="vf-brand-mark__badge vf-brand-mark__badge--pulse">
          <Activity size={spec.badge} strokeWidth={2.7} className="text-white" />
        </span>
      </span>
      {showWordmark && (
        <span className="flex min-w-0 flex-col leading-none" data-testid="brand-logo-wordmark">
          <span className={`truncate ${spec.title} font-extrabold tracking-tight ${titleToneClass}`}>V FLOW AI</span>
          <span className={`mt-1 truncate font-mono font-bold uppercase ${spec.subtitle} ${subtitleToneClass}`}>AI STUDIO</span>
        </span>
      )}
    </div>
  );
};
