import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { AppScreen, GenerationSettings, VfUsageWindow } from '../types';
import { useUser } from '../contexts/UserContext';
import { getEngineDisplayName } from '../services/engineDisplay';
import { EngineLogo } from '../components/EngineLogo';
import { BrandLogo } from '../components/BrandLogo';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, readStorageString } from '../src/shared/storage/localStore';
import { useNotifications } from '../src/shared/notifications/NotificationProvider';
import { sanitizeUiText } from '../src/shared/ui/terminology';
import {
  fetchAccountProfile,
  fetchMySupportConversations,
  markSupportConversationUnresolved,
  postSupportMessage,
  type SupportConversation,
} from '../services/accountService';

const ENGINE_ORDER: GenerationSettings['engine'][] = ['KOKORO', 'GOOD', 'NEURAL2', 'GEM'];

const readSavedUiTheme = (): 'dark' | 'light' | 'system' | '' => {
  const raw = String(readStorageString(STORAGE_KEYS.uiTheme) || '').trim().toLowerCase();
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return '';
};

const detectDarkTheme = (): boolean => {
  if (typeof window === 'undefined') return false;
  const savedTheme = readSavedUiTheme();
  if (savedTheme === 'dark') return true;
  if (savedTheme === 'light') return false;
  const bodyDark = document.body.classList.contains('theme-dark');
  const rootDark = document.documentElement.classList.contains('theme-dark');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return Boolean(bodyDark || rootDark || prefersDark);
};

const readSettingsBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const WindowCard: React.FC<{ title: string; data: VfUsageWindow; isDarkUi: boolean }> = ({ title, data, isDarkUi }) => (
  <div className={`rounded-xl border p-3 ${isDarkUi ? 'border-slate-700 bg-slate-900/65' : 'border-gray-200 bg-gray-50'}`}>
    <div className="mb-2 flex items-center justify-between">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{title}</h4>
      <span className={`text-xs font-mono ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{data.key}</span>
    </div>
    <div className={`mb-2 flex items-center justify-between rounded-lg border px-2 py-1.5 ${isDarkUi ? 'border-slate-700 bg-slate-950/80' : 'border-white bg-white'}`}>
      <span className={`text-xs font-semibold ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>Total</span>
      <span className={`text-xs font-bold ${isDarkUi ? 'text-cyan-300' : 'text-indigo-700'}`}>{data.totalVf} VF</span>
    </div>
    <div className="space-y-1.5">
      {ENGINE_ORDER.map((engine) => (
        <div key={engine} className="flex items-center justify-between text-xs">
          <div className={`flex items-center gap-2 ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>
            <EngineLogo engine={engine} size="sm" variant="ringed" />
            <span>{getEngineDisplayName(engine)}</span>
          </div>
          <span className={`font-mono ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>
            {data.byEngine[engine]?.chars || 0} chars / {data.byEngine[engine]?.vf || 0} VF
          </span>
        </div>
      ))}
    </div>
  </div>
);

export const Profile: React.FC<{ setScreen: (s: AppScreen) => void }> = ({ setScreen }) => {
  const { user, stats, isAdmin, hasUnlimitedAccess, signOutUser, updateUser } = useUser();
  const { emit } = useNotifications();
  const usage = stats.vfUsage;
  const [isDarkUi, setIsDarkUi] = useState<boolean>(() => detectDarkTheme());
  const initialBodyDarkRef = useRef<boolean | null>(null);
  const [accountUserId, setAccountUserId] = useState<string>(() => String(user.userId || '').trim().toLowerCase());
  const [supportText, setSupportText] = useState('');
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [isLoadingSupport, setIsLoadingSupport] = useState(false);
  const [isSendingSupport, setIsSendingSupport] = useState(false);

  const loadAccountAndSupport = async () => {
    const baseUrl = readSettingsBackendUrl();
    try {
      const profilePayload = await fetchAccountProfile(baseUrl);
      const resolvedUserId = String(profilePayload.profile?.userId || '').trim().toLowerCase();
      setAccountUserId(resolvedUserId);
      if (resolvedUserId) updateUser({ userId: resolvedUserId });
    } catch {
      // Keep profile screen available even when backend is unavailable.
    }
    setIsLoadingSupport(true);
    try {
      const rows = await fetchMySupportConversations(baseUrl, 60);
      setSupportConversations(rows);
    } catch {
      setSupportConversations([]);
    } finally {
      setIsLoadingSupport(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncTheme = () => setIsDarkUi(detectDarkTheme());
    syncTheme();

    const bodyObserver = new MutationObserver(syncTheme);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    bodyObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const media = window.matchMedia('(prefers-color-scheme: dark)') as any;
    media?.addEventListener?.('change', syncTheme);
    media?.addListener?.(syncTheme);
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEYS.uiTheme) return;
      syncTheme();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      bodyObserver.disconnect();
      media?.removeEventListener?.('change', syncTheme);
      media?.removeListener?.(syncTheme);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (initialBodyDarkRef.current === null) {
      initialBodyDarkRef.current = document.body.classList.contains('theme-dark');
    }
    document.body.classList.toggle('theme-dark', isDarkUi);
  }, [isDarkUi]);

  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      if (initialBodyDarkRef.current === null) return;
      document.body.classList.toggle('theme-dark', initialBodyDarkRef.current);
    };
  }, []);

  useEffect(() => {
    void loadAccountAndSupport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className={`pointer-events-none fixed inset-0 ${isDarkUi ? 'bg-[radial-gradient(80%_70%_at_10%_0%,rgba(34,211,238,0.14),transparent_55%),radial-gradient(76%_65%_at_90%_16%,rgba(99,102,241,0.16),transparent_58%),linear-gradient(180deg,rgba(2,6,23,0.95),rgba(2,6,23,0.92))]' : 'bg-[radial-gradient(80%_65%_at_10%_0%,rgba(99,102,241,0.12),transparent_58%),radial-gradient(76%_65%_at_90%_16%,rgba(56,189,248,0.12),transparent_62%)]'}`} />
      <div className={`vf-surface-card relative mx-auto my-4 w-full max-w-3xl rounded-2xl border p-6 md:my-8 ${isDarkUi ? 'border-slate-700 bg-slate-900/80 shadow-[0_28px_68px_rgba(2,6,23,0.72)]' : 'border-gray-200 bg-white shadow-sm'}`}>
        <button onClick={() => setScreen(AppScreen.MAIN)} className={`${isDarkUi ? 'text-slate-400 hover:text-slate-100' : 'text-gray-400 hover:text-gray-900'} absolute left-6 top-6`}>
          <ArrowLeft size={20} />
        </button>
        <button
          onClick={async () => {
            try {
              await signOutUser();
              emit('custom.message', {
                title: 'Session',
                message: 'Signed out successfully.',
                severity: 'success',
                category: 'security',
                channel: 'toast',
              });
            } catch (error) {
              emit('custom.message', {
                title: 'Session',
                message: sanitizeUiText(error instanceof Error ? error.message : 'Sign out failed.'),
                severity: 'error',
                category: 'security',
                dedupeKey: 'profile-signout-failed',
              });
            }
            setScreen(AppScreen.LOGIN);
          }}
          className={`absolute right-6 top-6 rounded-lg border px-3 py-1.5 text-xs font-semibold ${isDarkUi ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          Sign Out
        </button>

        <div className="mt-8 mb-6 flex justify-center">
          <BrandLogo size="md" tone={isDarkUi ? 'light' : 'dark'} />
        </div>

        <div className="grid gap-5 md:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className={`flex h-14 w-14 items-center justify-center rounded-full font-bold ${isDarkUi ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-600'}`}>
                {user.avatarUrl ? <img src={user.avatarUrl} className="h-full w-full rounded-full object-cover" /> : (user.name || 'A').slice(0, 1)}
              </div>
              <div className="min-w-0">
                <h2 className={`truncate text-xl font-bold ${isDarkUi ? 'text-slate-100' : 'text-gray-900'}`}>{user.name || 'Local User'}</h2>
                <p className={`truncate text-sm ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>{user.email || 'No email'}</p>
              </div>
            </div>

            <div className={`rounded-xl border p-4 ${isDarkUi ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-100 bg-indigo-50'}`}>
              <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${isDarkUi ? 'text-indigo-300' : 'text-indigo-600'}`}>Account Access</h3>
              <div className={`space-y-2 text-sm ${isDarkUi ? 'text-slate-300' : 'text-gray-700'}`}>
                <div className="flex items-center justify-between">
                  <span>Role</span>
                  <span className={`font-bold ${isDarkUi ? 'text-indigo-200' : 'text-indigo-700'}`}>{isAdmin ? 'Admin' : 'User'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Limits</span>
                  <span className={`font-bold ${isDarkUi ? 'text-indigo-200' : 'text-indigo-700'}`}>{hasUnlimitedAccess ? 'Unlimited' : 'Standard'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ads</span>
                  <span className={`font-bold ${isDarkUi ? 'text-indigo-200' : 'text-indigo-700'}`}>{isAdmin ? 'Disabled' : 'Enabled'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>User ID</span>
                  <span className={`font-mono font-bold ${isDarkUi ? 'text-indigo-200' : 'text-indigo-700'}`}>{accountUserId || '-'}</span>
                </div>
              </div>
              {!accountUserId && (
                <div className={`mt-3 rounded-lg border px-2.5 py-2 text-xs ${isDarkUi ? 'border-slate-700 bg-slate-900/70 text-slate-300' : 'border-white bg-white text-gray-600'}`}>
                  User ID setup is pending. Finish it from the one-time setup screen shown after login.
                </div>
              )}
              {isAdmin && (
                <div className={`mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold ${isDarkUi ? 'border-slate-700 bg-slate-900/70 text-slate-200' : 'border-white bg-white text-gray-700'}`}>
                  <ShieldCheck size={14} className="text-emerald-600" />
                  Admin account has full access and no usage cap.
                </div>
              )}
            </div>

            <div className={`mt-4 rounded-xl border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/65' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Support Inbox</h3>
              <div className="space-y-2">
                <textarea
                  value={supportText}
                  onChange={(event) => setSupportText(event.target.value)}
                  placeholder="Describe your issue. AI will try first, then route to human if unresolved."
                  className={`min-h-[72px] w-full rounded-lg border px-3 py-2 text-xs ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500' : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400'}`}
                />
                <button
                  onClick={() => {
                    const text = supportText.trim();
                    if (!text) return;
                    setIsSendingSupport(true);
                    void (async () => {
                      try {
                        await postSupportMessage({ text }, readSettingsBackendUrl());
                        setSupportText('');
                        await loadAccountAndSupport();
                        emit('support.message.sent', {
                          title: 'Support',
                          message: 'Support message sent.',
                          dedupeKey: 'support-message-sent',
                        });
                      } catch (error) {
                        emit('support.message.failed', {
                          title: 'Support',
                          message: sanitizeUiText(error instanceof Error ? error.message : 'Support message failed.'),
                          dedupeKey: 'support-message-failed',
                        });
                      } finally {
                        setIsSendingSupport(false);
                      }
                    })();
                  }}
                  disabled={isSendingSupport || !supportText.trim()}
                  className={`h-8 rounded-md border px-3 text-[11px] font-semibold disabled:opacity-60 ${isDarkUi ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}
                >
                  {isSendingSupport ? 'Sending...' : 'Send Query'}
                </button>
              </div>
              <div className="mt-3 max-h-28 space-y-1 overflow-auto">
                {isLoadingSupport && <div className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>Loading conversations...</div>}
                {!isLoadingSupport && supportConversations.length === 0 && (
                  <div className={`text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>No support threads yet.</div>
                )}
                {!isLoadingSupport && supportConversations.map((item) => (
                  <div key={item.conversationId} className={`rounded-md border px-2 py-1 ${isDarkUi ? 'border-slate-700 bg-slate-950/80' : 'border-gray-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-[11px] font-semibold ${isDarkUi ? 'text-slate-200' : 'text-gray-800'}`}>
                        {item.status} • {item.priority}
                      </div>
                      {item.status !== 'resolved' && (
                        <button
                          onClick={() => {
                            void (async () => {
                              await markSupportConversationUnresolved(item.conversationId, readSettingsBackendUrl());
                              await loadAccountAndSupport();
                              emit('support.conversation.unresolved', {
                                title: 'Support',
                                message: 'Conversation marked as unresolved.',
                                dedupeKey: `support-unresolved-${item.conversationId}`,
                                channel: 'inbox',
                              });
                            })();
                          }}
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isDarkUi ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                        >
                          Still unresolved
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-4 ${isDarkUi ? 'border-slate-700 bg-slate-900/65' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>VF Rates</h3>
              <div className="space-y-2">
                {ENGINE_ORDER.map((engine) => (
                  <div key={engine} className="flex items-center justify-between text-sm">
                    <div className={`flex items-center gap-2 ${isDarkUi ? 'text-slate-200' : 'text-gray-700'}`}>
                      <EngineLogo engine={engine} size="sm" variant="ringed" />
                      <span>{getEngineDisplayName(engine)}</span>
                    </div>
                    <span className={`font-mono ${isDarkUi ? 'text-cyan-300' : 'text-indigo-700'}`}>1 char = {usage.rates[engine]} VF</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={14} className={isDarkUi ? 'text-cyan-300' : 'text-indigo-500'} />
              <h3 className={`text-sm font-bold uppercase tracking-wider ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>Usage Ledger (VF)</h3>
            </div>
            <div className="space-y-3">
              <WindowCard title="Daily" data={usage.daily} isDarkUi={isDarkUi} />
              <WindowCard title="Monthly" data={usage.monthly} isDarkUi={isDarkUi} />
              <WindowCard title="Lifetime" data={usage.lifetime} isDarkUi={isDarkUi} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
