'use client';
import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, User } from 'lucide-react';
import { AppScreen } from '../types';
import { useUser } from '../contexts/UserContext';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, removeStorageKey } from '../src/shared/storage/localStore';
import { BrandLogo } from '../components/BrandLogo';
import { useNotifications } from '../src/shared/notifications/NotificationProvider';
import { sanitizeUiText } from '../src/shared/ui/terminology';
import { fetchAccountProfile, upsertAccountProfile } from '../services/accountService';

const readSettingsBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const toSafeMessage = (raw: unknown): string => {
  const source = sanitizeUiText(String(raw || '').trim());
  const lowered = source.toLowerCase();
  if (lowered.includes('already exists')) return 'This user ID is already taken. Try another one.';
  if (lowered.includes('immutable')) return 'User ID is already set and cannot be changed.';
  if (!source) return 'Could not save user ID. Please retry.';
  return source;
};

export const UserIdSetup: React.FC<{ setScreen: (screen: AppScreen) => void }> = ({ setScreen }) => {
  const { user, isAdmin, updateUser, signOutUser } = useUser();
  const { emit } = useNotifications();
  const [userId, setUserId] = useState('');
  const [suggestedUserId, setSuggestedUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!user.email) {
      setScreen(AppScreen.LOGIN);
      return;
    }
    if (isAdmin) {
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      setScreen(AppScreen.MAIN);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const payload = await fetchAccountProfile(readSettingsBackendUrl());
        if (!active) return;
        const resolvedUserId = String(payload.profile?.userId || '').trim().toLowerCase();
        setSuggestedUserId(String(payload.suggestedUserId || '').trim().toLowerCase());
        if (resolvedUserId) {
          updateUser({ userId: resolvedUserId });
          removeStorageKey(STORAGE_KEYS.uidSetupRequired);
          setScreen(AppScreen.MAIN);
          return;
        }
      } catch {
        // Keep user in setup flow; submit call will surface actionable errors.
      } finally {
        if (active) setIsChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, setScreen, updateUser, user.email]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = String(userId || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{4,24}$/.test(normalized)) {
      setErrorMsg('Use lowercase letters, numbers, underscore. 4-24 characters.');
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const profile = await upsertAccountProfile(
        {
          userId: normalized,
          ...(user.name?.trim() ? { displayName: user.name.trim() } : {}),
        },
        readSettingsBackendUrl()
      );
      const resolvedUserId = String(profile.userId || '').trim().toLowerCase();
      if (!resolvedUserId) {
        setErrorMsg('Could not save user ID. Please retry.');
        return;
      }
      updateUser({ userId: resolvedUserId });
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      emit('profile.userid.saved', {
        title: 'User ID Saved',
        message: 'Your account setup is complete.',
        category: 'security',
        dedupeKey: 'uid-setup-saved',
      });
      setScreen(AppScreen.MAIN);
    } catch (error) {
      const message = toSafeMessage(error instanceof Error ? error.message : error);
      setErrorMsg(message);
      emit('profile.userid.failed', {
        title: 'User ID Setup Failed',
        message,
        category: 'security',
        dedupeKey: 'uid-setup-failed',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const authControlTransitionClass = 'transition-[border-color,background-color,color,box-shadow,filter,opacity,transform]';
  const authButtonTransitionClass = 'transition-[background-color,color,box-shadow,filter,opacity,transform]';
  const authControlFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
  const authButtonFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100';

  return (
    <div className="vf-auth-shell min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_60%),radial-gradient(75%_65%_at_100%_20%,rgba(14,165,233,0.12),transparent_62%)]" />
      <div className="vf-auth-card vf-surface-card relative mx-auto my-6 w-full max-w-md rounded-3xl border border-sky-200/80 bg-slate-100/95 p-8 shadow-2xl animate-in fade-in zoom-in duration-300 md:my-10 md:p-10">
        <div className="mb-6 text-center">
          <div className="mx-auto flex justify-center">
            <BrandLogo size="lg" tone="dark" />
          </div>
          <p className="mt-3 text-sm text-slate-700">Choose your one-time User ID to finish setting up your account.</p>
        </div>

        {errorMsg && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700" role="alert" aria-live="assertive" aria-atomic="true">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isChecking || isSubmitting}>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {isChecking ? 'Checking profile...' : isSubmitting ? 'Saving user ID...' : ''}
          </p>
          <div>
            <label htmlFor="user-id-setup" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-slate-600">User ID</label>
            <div className="relative">
              <input
                id="user-id-setup"
                name="userId"
                type="text"
                value={userId}
                onChange={(event) => setUserId(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder={suggestedUserId || 'artist_01'}
                pattern="[a-z0-9_]{4,24}"
                title="Use lowercase letters, numbers, underscore. 4-24 chars."
                autoComplete="username"
                inputMode="text"
                spellCheck={false}
                aria-describedby="user-id-setup-help"
                aria-invalid={Boolean(errorMsg)}
                className={`w-full rounded-xl border border-slate-600 bg-slate-900/85 py-3 pl-10 pr-3 text-sm text-slate-100 outline-none ${authControlTransitionClass} ${authControlFocusClass} placeholder:text-slate-500 focus:border-cyan-400 focus:bg-slate-950`}
                required
                disabled={isChecking || isSubmitting}
              />
              <User size={16} className="absolute left-3 top-3.5 text-slate-500" />
            </div>
            <p id="user-id-setup-help" className="mt-1 text-[11px] text-slate-500">Lowercase only, 4-24 chars. You can choose this once.</p>
          </div>

          <button
            type="submit"
            disabled={isChecking || isSubmitting}
            aria-busy={isChecking || isSubmitting}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-sky-600 to-cyan-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 ${authButtonTransitionClass} ${authButtonFocusClass} hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70`}
          >
            {isChecking ? 'Checking profile...' : isSubmitting ? 'Saving...' : 'Continue to App'}
            {!isChecking && !isSubmitting && <ArrowRight size={16} />}
          </button>
        </form>

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
