import React from 'react';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { AppScreen, GenerationSettings, VfUsageWindow } from '../types';
import { useUser } from '../contexts/UserContext';
import { getEngineDisplayName } from '../services/engineDisplay';
import { VF_ENGINE_RATES } from '../services/usageMetering';
import { EngineLogo } from '../components/EngineLogo';

const ENGINE_ORDER: GenerationSettings['engine'][] = ['KOKORO', 'GEM'];

const WindowCard: React.FC<{ title: string; data: VfUsageWindow }> = ({ title, data }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
    <div className="mb-2 flex items-center justify-between">
      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h4>
      <span className="text-xs font-mono text-gray-500">{data.key}</span>
    </div>
    <div className="mb-2 flex items-center justify-between rounded-lg border border-white bg-white px-2 py-1.5">
      <span className="text-xs font-semibold text-gray-600">Total</span>
      <span className="text-xs font-bold text-indigo-700">{data.totalVf} VF</span>
    </div>
    <div className="space-y-1.5">
      {ENGINE_ORDER.map((engine) => (
        <div key={engine} className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-600">
            <EngineLogo engine={engine} size="sm" variant="ringed" />
            <span>{getEngineDisplayName(engine)}</span>
          </div>
          <span className="font-mono text-gray-700">
            {data.byEngine[engine]?.chars || 0} chars / {data.byEngine[engine]?.vf || 0} VF
          </span>
        </div>
      ))}
    </div>
  </div>
);

export const Profile: React.FC<{ setScreen: (s: AppScreen) => void }> = ({ setScreen }) => {
  const { user, stats, isAdmin, hasUnlimitedAccess, signOutUser } = useUser();
  const usage = stats.vfUsage;

  return (
    <div className="min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(80%_65%_at_10%_0%,rgba(99,102,241,0.12),transparent_58%),radial-gradient(76%_65%_at_90%_16%,rgba(56,189,248,0.12),transparent_62%)]" />
      <div className="vf-surface-card relative mx-auto my-4 w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:my-8">
        <button onClick={() => setScreen(AppScreen.MAIN)} className="absolute left-6 top-6 text-gray-400 hover:text-gray-900">
          <ArrowLeft size={20} />
        </button>
        <button
          onClick={async () => {
            await signOutUser();
            setScreen(AppScreen.LOGIN);
          }}
          className="absolute right-6 top-6 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Sign Out
        </button>

        <div className="mt-8 grid gap-5 md:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 font-bold">
                {user.avatarUrl ? <img src={user.avatarUrl} className="h-full w-full rounded-full object-cover" /> : (user.name || 'A').slice(0, 1)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-gray-900">{user.name || 'Local User'}</h2>
                <p className="truncate text-sm text-gray-500">{user.email || 'No email'}</p>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-indigo-600">Account Access</h3>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span>Role</span>
                  <span className="font-bold text-indigo-700">{isAdmin ? 'Admin' : 'User'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Limits</span>
                  <span className="font-bold text-indigo-700">{hasUnlimitedAccess ? 'Unlimited' : 'Standard'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ads</span>
                  <span className="font-bold text-indigo-700">{isAdmin ? 'Disabled' : 'Enabled'}</span>
                </div>
              </div>
              {isAdmin && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-white bg-white px-2.5 py-2 text-xs font-semibold text-gray-700">
                  <ShieldCheck size={14} className="text-emerald-600" />
                  Admin account has full access and no usage cap.
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">VF Rates</h3>
              <div className="space-y-2">
                {ENGINE_ORDER.map((engine) => (
                  <div key={engine} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 text-gray-700">
                      <EngineLogo engine={engine} size="sm" variant="ringed" />
                      <span>{getEngineDisplayName(engine)}</span>
                    </div>
                    <span className="font-mono text-indigo-700">1 char = {VF_ENGINE_RATES[engine]} VF</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-500" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600">Usage Ledger (VF)</h3>
            </div>
            <div className="space-y-3">
              <WindowCard title="Daily" data={usage.daily} />
              <WindowCard title="Monthly" data={usage.monthly} />
              <WindowCard title="Lifetime" data={usage.lifetime} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
