import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, ChevronDown, ChevronUp, Info, TriangleAlert, X } from 'lucide-react';
import { toCompactToastCopy } from './format';
import type { AppNotification } from './types';
import { useNotifications } from './NotificationProvider';

const TOAST_DURATION_MS: Record<AppNotification['severity'], number> = {
  success: 4000,
  info: 4000,
  warning: 7000,
  error: 9000,
  critical: 0,
};

const severityTone = (severity: AppNotification['severity'], isDarkUi: boolean): string => {
  if (isDarkUi) {
    if (severity === 'success') return 'border-emerald-400/45 bg-slate-950/94 text-emerald-100';
    if (severity === 'warning') return 'border-amber-400/45 bg-slate-950/94 text-amber-100';
    if (severity === 'error') return 'border-rose-400/50 bg-slate-950/95 text-rose-100';
    if (severity === 'critical') return 'border-red-400/55 bg-slate-950/96 text-red-100';
    return 'border-cyan-400/45 bg-slate-950/94 text-cyan-100';
  }
  if (severity === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (severity === 'error') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'critical') return 'border-red-300 bg-red-50 text-red-900';
  return 'border-blue-200 bg-blue-50 text-blue-800';
};

const readDarkTheme = (): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return (
    document.body.classList.contains('theme-dark') ||
    document.documentElement.classList.contains('theme-dark') ||
    document.documentElement.classList.contains('vf-theme-dark')
  );
};

const readSettingsPanelOpen = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-vf-settings-open') === 'true';
};

const resolveToastRightOffset = (): string => {
  if (typeof window === 'undefined') return '1rem';
  if (window.innerWidth < 768) return '0.5rem';
  if (!readSettingsPanelOpen()) return '1rem';
  return 'calc(min(28rem, 96vw) + 1rem)';
};

const resolveToastBottomOffset = (): string => {
  if (typeof window === 'undefined') return '1rem';
  if (window.innerWidth < 768) {
    if (typeof document !== 'undefined') {
      const fromCssVar = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--vf-toast-mobile-safe-bottom')
        .trim();
      if (fromCssVar) return fromCssVar;
    }
    return 'calc(5.25rem + env(safe-area-inset-bottom))';
  }
  return '1rem';
};

const SeverityIcon: React.FC<{ severity: AppNotification['severity']; className?: string }> = ({
  severity,
  className,
}) => {
  if (severity === 'success') return <CheckCircle2 size={16} className={className} />;
  if (severity === 'warning') return <TriangleAlert size={16} className={className} />;
  if (severity === 'error' || severity === 'critical') return <AlertCircle size={16} className={className} />;
  return <Info size={16} className={className} />;
};

const ToastItem: React.FC<{ item: AppNotification; isDarkUi: boolean }> = ({ item, isDarkUi }) => {
  const { hideToast, markRead, remove, setCenterOpen } = useNotifications();
  const durationMs = TOAST_DURATION_MS[item.severity];
  const compactCopy = useMemo(() => toCompactToastCopy(item.title, item.message), [item.message, item.title]);
  const isTruncated = compactCopy.message !== item.message || compactCopy.title !== item.title;

  useEffect(() => {
    if (item.sticky || durationMs <= 0) return;
    const timer = window.setTimeout(() => {
      hideToast(item.id);
      markRead(item.id);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, hideToast, item.id, item.sticky, markRead]);

  return (
    <div
      data-testid="notification-toast"
      className={`pointer-events-auto w-[min(22rem,92vw)] rounded-xl border px-3 py-3 shadow-lg backdrop-blur-sm ${severityTone(item.severity, isDarkUi)} animate-in slide-in-from-right duration-200`}
      role="status"
      aria-live={item.severity === 'critical' || item.severity === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-2">
        <SeverityIcon severity={item.severity} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold uppercase tracking-wide">{compactCopy.title}</div>
          <p className="mt-0.5 truncate text-sm leading-snug">{compactCopy.message}</p>
          {(isTruncated || item.details) && (
            <button
              type="button"
              onClick={() => setCenterOpen(true)}
              className={`mt-2 rounded-md border border-current/30 px-2.5 py-1 text-xs font-semibold transition-colors ${isDarkUi ? 'bg-black/20 hover:bg-black/35' : 'bg-white/70 hover:bg-white'}`}
            >
              View details
            </button>
          )}
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick?.();
                markRead(item.id);
              }}
              className={`mt-2 ml-2 rounded-md border border-current/30 px-2.5 py-1 text-xs font-semibold transition-colors ${isDarkUi ? 'bg-black/20 hover:bg-black/35' : 'bg-white/70 hover:bg-white'}`}
            >
              {item.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            hideToast(item.id);
            markRead(item.id);
            if (!item.sticky) remove(item.id);
          }}
          className={`rounded p-1 opacity-70 transition-colors hover:opacity-100 ${isDarkUi ? 'hover:bg-white/10' : 'hover:bg-white/60'}`}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

const CenterItem: React.FC<{ item: AppNotification; isDarkUi: boolean }> = ({ item, isDarkUi }) => {
  const { markRead, remove } = useNotifications();
  const [expanded, setExpanded] = useState(false);
  const compactCopy = useMemo(() => toCompactToastCopy(item.title, item.message), [item.message, item.title]);
  const timeLabel = useMemo(
    () => new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [item.createdAt]
  );

  return (
    <div
      className={`rounded-xl border px-2.5 py-2 ${severityTone(item.severity, isDarkUi)} ${item.readAt ? 'opacity-85' : ''} ${item.status === 'resolved' ? 'opacity-75' : ''} ${item.severity === 'critical' || item.sticky ? (isDarkUi ? 'ring-1 ring-red-400/55' : 'ring-1 ring-red-300/70') : ''}`}
    >
      <div className="flex items-center gap-2">
        <SeverityIcon severity={item.severity} className="shrink-0" />
        <button
          type="button"
          onClick={() => {
            setExpanded((prev) => !prev);
            if (!item.readAt) markRead(item.id);
          }}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
          aria-label={`Toggle notification ${item.title}`}
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-bold uppercase tracking-wide">{compactCopy.title}</span>
            <span className="truncate text-xs opacity-90">{compactCopy.message}</span>
          </div>
        </button>
        {item.status === 'resolved' && (
          <span className="shrink-0 rounded border border-current/30 px-1 py-0.5 text-[9px] font-bold uppercase">
            R
          </span>
        )}
        {!item.readAt && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-current/80" title="Unread" />
        )}
        <span className="shrink-0 text-[10px] font-semibold opacity-70">{timeLabel}</span>
        <button
          type="button"
          onClick={() => remove(item.id)}
          className={`rounded p-1 transition-colors ${isDarkUi ? 'hover:bg-white/10' : 'hover:bg-white/70'}`}
          aria-label="Remove notification"
        >
          <X size={13} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={`rounded p-1 transition-colors ${isDarkUi ? 'hover:bg-white/10' : 'hover:bg-white/70'}`}
          aria-label={expanded ? 'Collapse notification' : 'Expand notification'}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          <p className="text-xs opacity-90 whitespace-pre-wrap break-words">{item.message}</p>
          {item.details && (
            <details className="rounded-md border border-current/20 px-2 py-1 text-[11px] opacity-90">
              <summary className="cursor-pointer font-semibold">Details</summary>
              <p className="mt-1 whitespace-pre-wrap">{item.details}</p>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!item.readAt && (
              <button
                type="button"
                onClick={() => markRead(item.id)}
                className={`rounded-md border border-current/30 px-2 py-1 text-[11px] font-semibold transition-colors ${isDarkUi ? 'bg-black/20 hover:bg-black/35' : 'bg-white/70 hover:bg-white'}`}
              >
                Mark read
              </button>
            )}
            {item.action && item.action.onClick && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick?.();
                  markRead(item.id);
                }}
                className={`rounded-md border border-current/30 px-2 py-1 text-[11px] font-semibold transition-colors ${isDarkUi ? 'bg-black/20 hover:bg-black/35' : 'bg-white/70 hover:bg-white'}`}
              >
                {item.action.label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const NotificationUI: React.FC = () => {
  const [filter, setFilter] = useState<'active' | 'all' | 'unread' | 'critical' | 'resolved'>('active');
  const [isDarkUi, setIsDarkUi] = useState<boolean>(() => readDarkTheme());
  const [toastRightOffset, setToastRightOffset] = useState<string>(() => resolveToastRightOffset());
  const [toastBottomOffset, setToastBottomOffset] = useState<string>(() => resolveToastBottomOffset());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    notifications,
    unreadCount,
    isCenterOpen,
    setCenterOpen,
    clearAll,
  } = useNotifications();

  const centerItems = useMemo(() => {
    if (filter === 'active') return notifications.filter((item) => item.status === 'active');
    if (filter === 'unread') return notifications.filter((item) => !item.readAt);
    if (filter === 'critical') return notifications.filter((item) => item.severity === 'critical' || item.sticky);
    if (filter === 'resolved') return notifications.filter((item) => item.status === 'resolved');
    return notifications;
  }, [filter, notifications]);

  const toastItems = useMemo(
    () =>
      notifications
        .filter((item) => item.status === 'active' && item.channel === 'toast' && item.toastVisible)
        .slice(0, 2),
    [notifications]
  );

  useEffect(() => {
    const syncThemeAndLayout = () => {
      setIsDarkUi(readDarkTheme());
      setToastRightOffset(resolveToastRightOffset());
      setToastBottomOffset(resolveToastBottomOffset());
    };
    syncThemeAndLayout();

    if (typeof document === 'undefined') return undefined;
    const observer = new MutationObserver(syncThemeAndLayout);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-vf-settings-open'],
    });
    window.addEventListener('resize', syncThemeAndLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncThemeAndLayout);
    };
  }, []);

  useEffect(() => {
    if (!isCenterOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables[0]?.focus();
  }, [isCenterOpen]);

  useEffect(() => {
    if (!isCenterOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setCenterOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => !node.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && active === last) {
        first.focus();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCenterOpen, setCenterOpen]);

  return (
    <>
      <div data-testid="notification-root" className="pointer-events-none fixed inset-0 z-[115]">
        <div
          className="pointer-events-none fixed inset-x-2 flex max-h-[50vh] w-fit flex-col items-end gap-2 overflow-y-auto pr-1 md:inset-x-auto md:bottom-4"
          style={{
            bottom: toastBottomOffset,
            right: toastRightOffset,
          }}
        >
          {toastItems.map((item) => (
            <ToastItem key={item.id} item={item} isDarkUi={isDarkUi} />
          ))}
        </div>
      </div>

      {isCenterOpen && (
        <div className="fixed inset-0 z-[116] flex justify-end bg-black/35 backdrop-blur-[2px]">
          <button
            type="button"
            onClick={() => setCenterOpen(false)}
            className="flex-1"
            aria-label="Dismiss notifications panel"
          />
          <div
            ref={panelRef}
            data-testid="notification-center"
            className={`h-full w-full max-w-md border-l shadow-2xl ${isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Notification center"
          >
            <div className={`flex items-center justify-between border-b px-4 py-3 ${isDarkUi ? 'border-slate-800' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <Bell size={16} className={isDarkUi ? 'text-indigo-300' : 'text-indigo-600'} />
                <h2 className={`text-sm font-bold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>
                  Notifications
                </h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCenterOpen(false)}
                className={`rounded-md p-1.5 transition-colors ${isDarkUi ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                aria-label="Close notifications"
              >
                <X size={16} />
              </button>
            </div>
            <div className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 ${isDarkUi ? 'border-slate-800' : 'border-slate-100'}`}>
              <div className="mr-auto flex items-center gap-1">
                {(['active', 'all', 'unread', 'critical', 'resolved'] as const).map((nextFilter) => (
                  <button
                    key={nextFilter}
                    type="button"
                    onClick={() => setFilter(nextFilter)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                      filter === nextFilter
                        ? isDarkUi
                          ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                          : 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : isDarkUi
                          ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {nextFilter}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (notifications.length === 0) return;
                  if (!window.confirm('Clear all notifications?')) return;
                  clearAll();
                }}
                disabled={notifications.length === 0}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-45 ${isDarkUi ? 'border-rose-500/45 text-rose-200 hover:bg-rose-500/20' : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}
              >
                Clear all
              </button>
            </div>
            <div className="h-[calc(100%-6.75rem)] overflow-y-auto p-3">
              {centerItems.length === 0 ? (
                <div className={`rounded-xl border border-dashed p-6 text-center text-sm ${isDarkUi ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'}`}>
                  No notifications in this filter.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {centerItems.map((item) => (
                    <CenterItem key={item.id} item={item} isDarkUi={isDarkUi} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
