import React from 'react';
import { GenerationSettings } from '../types';
import { getEngineDisplayName } from '../services/engineDisplay';
import { EngineLogo } from './EngineLogo';

type EngineRuntimeState = 'checking' | 'starting' | 'online' | 'offline' | 'not_configured';

interface EngineRuntimeStatus {
  state: EngineRuntimeState;
  detail: string;
}

interface EngineRuntimeStripProps {
  engineOrder: GenerationSettings['engine'][];
  statuses: Record<GenerationSettings['engine'], EngineRuntimeStatus>;
  activeEngine: GenerationSettings['engine'];
  switchingEngine: GenerationSettings['engine'] | null;
  resolvedTheme: 'light' | 'dark';
  onActivate: (engine: GenerationSettings['engine']) => void;
}

const getRuntimeStateLabel = (state: EngineRuntimeState): string => {
  if (state === 'online') return 'Online';
  if (state === 'offline') return 'Offline';
  if (state === 'starting') return 'Starting';
  if (state === 'not_configured') return 'Not Set';
  return 'Checking';
};

const getIndicatorTone = (state: EngineRuntimeState): 'green' | 'orange' | 'red' => {
  if (state === 'online') return 'green';
  if (state === 'offline' || state === 'not_configured') return 'red';
  if (state === 'starting' || state === 'checking') return 'orange';
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

export const EngineRuntimeStrip: React.FC<EngineRuntimeStripProps> = ({
  engineOrder,
  statuses,
  activeEngine,
  switchingEngine,
  resolvedTheme,
  onActivate,
}) => {
  return (
    <div className="flex items-center gap-2 pr-1 whitespace-nowrap">
      {engineOrder.map((engine) => {
        const status = statuses[engine] ?? { state: 'checking', detail: 'Checking runtime...' };
        const isActive = activeEngine === engine;
        const pending = switchingEngine === engine;
        const switchLocked = Boolean(switchingEngine) && !pending;
        const indicatorTone = getIndicatorTone(status.state);
        const indicatorClass = getIndicatorClasses(indicatorTone, resolvedTheme);

        return (
          <button
            key={engine}
            onClick={() => onActivate(engine)}
            disabled={switchLocked || pending}
            title={`${getEngineDisplayName(engine)} - ${pending ? 'Starting' : getRuntimeStateLabel(status.state)} - ${status.detail}`}
            aria-label={`${getEngineDisplayName(engine)} runtime: ${pending ? 'Starting' : getRuntimeStateLabel(status.state)}`}
            className={`group relative inline-flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors ${
              resolvedTheme === 'dark'
                ? 'bg-slate-950/35 hover:bg-slate-900/60'
                : 'bg-white/70 hover:bg-white'
            } ${indicatorClass} ${isActive ? 'ring-2 ring-indigo-400/70' : ''} ${(switchLocked || pending) ? 'opacity-55 cursor-not-allowed' : ''} ${pending ? 'animate-pulse' : ''}`}
          >
            <EngineLogo engine={engine} size="sm" variant="filled" withGlow={isActive || pending} />
          </button>
        );
      })}
    </div>
  );
};
