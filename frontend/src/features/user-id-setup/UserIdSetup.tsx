'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { AppScreen } from '../../../types';
import { useUser } from '../../../contexts/UserContext';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { removeStorageKey } from '../../shared/storage/localStore';
import { BrandLogo } from '../../../components/BrandLogo';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { bootstrapAccountProfile, fetchAccountProfile } from '../../../services/accountService';

const toSafeMessage = (raw: unknown): string => {
  const source = sanitizeUiText(String(raw || '').trim());
  if (!source) return 'Could not finish account setup. Please retry.';
  return source;
};

export const UserIdSetup: React.FC<{ setScreen: (screen: AppScreen) => void }> = ({ setScreen }) => {
  const { user, isAdmin, updateUser, signOutUser } = useUser();
  const { emit } = useNotifications();
  const [isWorking, setIsWorking] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const finishSetup = useCallback(async () => {
    if (!user.email) {
      setScreen(AppScreen.LOGIN);
      return;
    }
    if (isAdmin) {
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      setScreen(AppScreen.MAIN);
      return;
    }

    setIsWorking(true);
    setErrorMsg('');
    try {
      const existing = await fetchAccountProfile();
      let resolvedUserId = String(existing.profile?.userId || '').trim().toLowerCase();
      if (!resolvedUserId) {
        const bootstrapped = await bootstrapAccountProfile();
        resolvedUserId = String(bootstrapped?.userId || '').trim().toLowerCase();
      }
      if (!resolvedUserId) {
        throw new Error('Account profile is not ready yet. Please retry.');
      }
      updateUser({ userId: resolvedUserId });
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      emit('profile.userid.saved', {
        title: 'Account Ready',
        message: 'Account setup is complete.',
        category: 'security',
        dedupeKey: 'uid-setup-autofinish',
      });
      setScreen(AppScreen.MAIN);
    } catch (error) {
      const message = toSafeMessage(error instanceof Error ? error.message : error);
      setErrorMsg(message);
      emit('profile.userid.failed', {
        title: 'Account Setup Failed',
        message,
        category: 'security',
        dedupeKey: 'uid-setup-autofinish-failed',
      });
    } finally {
      setIsWorking(false);
    }
  }, [emit, isAdmin, setScreen, updateUser, user.email]);

  useEffect(() => {
    void finishSetup();
  }, [finishSetup]);

  const authButtonTransitionClass = 'transition-[background-color,color,box-shadow,filter,opacity,transform]';
  const authButtonFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100';

  return (
    <div className="vf-auth-shell min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_60%),radial-gradient(75%_65%_at_100%_20%,rgba(14,165,233,0.12),transparent_62%)]" />
      <div className="vf-auth-card vf-surface-card relative mx-auto my-6 w-full max-w-md rounded-3xl border border-sky-200/80 bg-slate-100/95 p-8 shadow-2xl animate-in fade-in zoom-in duration-300 md:my-10 md:p-10">
        <div className="mb-6 text-center">
          <div className="mx-auto flex justify-center">
            <BrandLogo size="lg" tone="dark" />
          </div>
          <p className="mt-3 text-sm text-slate-700">Finishing account setup and loading your workspace.</p>
        </div>

        {errorMsg ? (
          <div
            className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-sky-100 bg-white/75 p-3 text-sm text-slate-700"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <Loader2 size={16} className="animate-spin" />
            <span>{isWorking ? 'Preparing your account...' : 'Almost ready...'}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            void finishSetup();
          }}
          disabled={isWorking}
          aria-busy={isWorking}
          className={`flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-sky-600 to-cyan-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 ${authButtonTransitionClass} ${authButtonFocusClass} hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70`}
        >
          {isWorking ? 'Please wait...' : 'Retry setup'}
          {!isWorking ? <ArrowRight size={16} /> : null}
        </button>

        <button
          type="button"
          onClick={() => {
            void (async () => {
              await signOutUser().catch(() => undefined);
              setScreen(AppScreen.LOGIN);
            })();
          }}
          className={`mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-slate-100 ${authButtonTransitionClass} ${authButtonFocusClass} hover:bg-slate-800`}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};
