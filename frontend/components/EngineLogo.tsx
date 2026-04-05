import React from 'react';
import { Crown, Zap } from 'lucide-react';
import { ActiveTtsEngineKey, GenerationSettings } from '../types';

type LogoSize = 'sm' | 'md' | 'lg';
type LogoVariant = 'filled' | 'ringed';

interface EngineLogoProps {
  engine: GenerationSettings['engine'];
  size?: LogoSize;
  variant?: LogoVariant;
  withGlow?: boolean;
  className?: string;
}

const SIZE_MAP: Record<LogoSize, { outer: string; icon: number }> = {
  sm: { outer: 'h-6 w-6', icon: 12 },
  md: { outer: 'h-10 w-10', icon: 18 },
  lg: { outer: 'h-12 w-12', icon: 22 },
};

const ENGINE_STYLE: Record<
  ActiveTtsEngineKey,
  {
    gradient: string;
    glow: string;
    ring: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
  }
> = {
  PRIME: {
    gradient: 'from-indigo-500 via-violet-500 to-fuchsia-500',
    glow: 'shadow-[0_0_18px_rgba(139,92,246,0.45)]',
    ring: 'ring-indigo-200/70',
    Icon: Crown,
  },
  VECTOR: {
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    glow: 'shadow-[0_0_18px_rgba(249,115,22,0.4)]',
    ring: 'ring-orange-200/70',
    Icon: Zap,
  },
};

const normalizeActiveEngine = (engine: GenerationSettings['engine']): ActiveTtsEngineKey =>
  engine === 'PRIME' ? 'PRIME' : 'VECTOR';

export const EngineLogo: React.FC<EngineLogoProps> = ({
  engine,
  size = 'md',
  variant = 'filled',
  withGlow = false,
  className = '',
}) => {
  const spec = ENGINE_STYLE[normalizeActiveEngine(engine)];
  const dimensions = SIZE_MAP[size];
  const ringClass = variant === 'ringed' ? `ring-1 ${spec.ring}` : '';
  const glowClass = withGlow ? spec.glow : '';

  return (
    <span className={`relative inline-flex items-center justify-center ${dimensions.outer} ${className}`}>
      <span
        className={`inline-flex ${dimensions.outer} items-center justify-center rounded-full bg-gradient-to-br text-white ${ringClass} shadow-md ${glowClass}`}
      >
        <spec.Icon size={dimensions.icon} />
      </span>
    </span>
  );
};

