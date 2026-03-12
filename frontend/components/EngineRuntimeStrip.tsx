import React from 'react';
import { GenerationSettings } from '../types';
import { getEngineCompactLabel, getEngineDisplayName } from '../services/engineDisplay';
import { EngineLogo } from './EngineLogo';
import { sanitizeUiText } from '../src/shared/ui/terminology';

type EngineRuntimeState = 'checking' | 'starting' | 'online' | 'offline' | 'not_configured' | 'standby';

interface EngineRuntimeStatus {
  state: EngineRuntimeState;
  detail: string;
}

interface EngineRuntimeStripProps {
  engineOrder: GenerationSettings['engine'][];
  statuses: Record<GenerationSettings['engine'], EngineRuntimeStatus>;
  accessState?: { blocked: boolean; detail: string };
  activeEngine: GenerationSettings['engine'];
  switchingEngine: GenerationSettings['engine'] | null;
  compact?: boolean;
  resolvedTheme: 'light' | 'dark';
  onActivate: (engine: GenerationSettings['engine']) => void;
}

const getRuntimeStateLabel = (state: EngineRuntimeState): string => {
  if (state === 'online') return 'Online';
  if (state === 'offline') return 'Offline';
  if (state === 'starting') return 'Starting';
  if (state === 'standby') return 'Standby';
  if (state === 'not_configured') return 'Not Set';
  return 'Checking';
};

const getIndicatorTone = (state: EngineRuntimeState): 'green' | 'orange' | 'red' => {
  if (state === 'online') return 'green';
  if (state === 'offline' || state === 'not_configured') return 'red';
  if (state === 'starting' || state === 'checking' || state === 'standby') return 'orange';
  return 'red';
};

const getIndicatorClasses = (tone: 'green' | 'orange' | 'red', resolvedTheme: 'light' | 'dark'): string => {
  if (tone === 'green') {
    return resolvedTheme === 'dark'
      ? 'border-emerald-400/90 shadow-[0_0_10px_rgba(52,211,153,0.35)]'
      : 'border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
  }
  if (tone === 'orange') {
    return resolvedTheme === 'dark'
      ? 'border-amber-400/90 shadow-[0_0_10px_rgba(251,191,36,0.3)]'
      : 'border-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)]';
  }
  return resolvedTheme === 'dark'
    ? 'border-red-400/90 shadow-[0_0_10px_rgba(248,113,113,0.3)]'
    : 'border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]';
};

const getDotClasses = (tone: 'green' | 'orange' | 'red', resolvedTheme: 'light' | 'dark'): string => {
  if (tone === 'green') {
    return resolvedTheme === 'dark'
      ? 'bg-emerald-300 shadow-[0_0_0_2px_rgba(5,46,22,0.9)]'
      : 'bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]';
  }
  if (tone === 'orange') {
    return resolvedTheme === 'dark'
      ? 'bg-amber-300 shadow-[0_0_0_2px_rgba(69,26,3,0.9)]'
      : 'bg-amber-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]';
  }
  return resolvedTheme === 'dark'
    ? 'bg-red-300 shadow-[0_0_0_2px_rgba(69,10,10,0.9)]'
    : 'bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]';
};

const getEngineAbbrev = (engine: GenerationSettings['engine']): string => getEngineCompactLabel(engine);

export const EngineRuntimeStrip: React.FC<EngineRuntimeStripProps> = ({
  engineOrder,
  statuses,
  accessState,
  activeEngine,
  switchingEngine,
  compact = false,
  resolvedTheme,
  onActivate,
}) => {
  return (
    <div className={`vf-runtime-strip flex items-center whitespace-nowrap ${compact ? 'gap-1.5 pr-0.5' : 'gap-2 pr-1'}`}>
      {engineOrder.map((engine) => {
        const status = statuses[engine] ?? { state: 'checking', detail: 'Checking runtime...' };
        const isActive = activeEngine === engine;
        const pending = switchingEngine === engine;
        const switchLocked = Boolean(switchingEngine) && !pending;
        const indicatorTone = getIndicatorTone(status.state);
        const indicatorClass = getIndicatorClasses(indicatorTone, resolvedTheme);
        const dotClass = getDotClasses(indicatorTone, resolvedTheme);
        const runtimeDetail = sanitizeUiText(status.detail || '');
        const showAccessBlockedNote = status.state === 'online' && Boolean(accessState?.blocked);
        const accessBlockedDetail = sanitizeUiText(
          accessState?.detail || 'Sign in again to enable AI/TTS requests.'
        );
        const titleParts = [
          getEngineDisplayName(engine),
          pending ? 'Starting' : getRuntimeStateLabel(status.state),
          runtimeDetail,
        ];
        if (showAccessBlockedNote) {
          titleParts.push(`Access blocked: ${accessBlockedDetail}`);
        }

        return (
          <button
            key={engine}
            onClick={() => onActivate(engine)}
            disabled={switchLocked || pending}
            title={titleParts.filter(Boolean).join(' - ')}
            aria-label={`${getEngineDisplayName(engine)} runtime: ${pending ? 'Starting' : getRuntimeStateLabel(status.state)}${showAccessBlockedNote ? '. Access blocked.' : ''}`}
            className={`vf-runtime-chip group relative inline-flex h-9 items-center justify-center rounded-full border transition-all ${
              compact ? 'min-w-[3rem] gap-1 px-2' : 'min-w-[3rem] gap-1.5 px-1.5 sm:min-w-[3.8rem] sm:gap-2 sm:px-2.5'
            } ${
              resolvedTheme === 'dark'
                ? 'bg-slate-950/35 hover:bg-slate-900/60'
                : 'bg-white/70 hover:bg-white'
            } ${indicatorClass} ${isActive ? 'vf-runtime-chip--active ring-2 ring-indigo-400/65' : ''} ${(switchLocked || pending) ? 'opacity-55 cursor-not-allowed' : ''} ${pending ? 'animate-pulse' : ''}`}
          >
            <span className={`vf-runtime-chip__dot absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${dotClass}`} />
            <EngineLogo engine={engine} size="sm" variant="filled" withGlow={isActive || pending} />
            <span
              className={`vf-runtime-chip__label text-[10px] font-black uppercase tracking-[0.09em] ${
                resolvedTheme === 'dark' ? 'text-slate-100' : 'text-slate-700'
              }`}
            >
              <span className={compact ? '' : 'sm:hidden'}>{getEngineAbbrev(engine)}</span>
              <span className={compact ? 'hidden' : 'hidden sm:inline'}>{getEngineDisplayName(engine)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
