/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../storage/keys';
import { readStorageJson, writeStorageJson } from '../storage/localStore';
import { sanitizeUiText } from '../ui/terminology';
import { getNotificationCatalogEntry } from './catalog';
import { toUserMessage } from './format';
import { buildEventDedupeKey, resolveNotificationPolicy } from './policy';
import {
  applyPrefsFilter,
  archiveResolved,
  clearNotificationsByIds,
  clearNonCritical,
  clearReadNotifications,
  dedupeWithCooldown,
  limitNotifications,
  markAllRead,
  markRead,
  NOTIFICATION_MAX_ITEMS,
  NOTIFICATION_TTL_MS,
  pruneExpiredNotifications,
  removeNotification,
  resolveNotificationsByEventCodes,
} from './store';
import type {
  AppNotification,
  EmitOptions,
  NotificationEmitPayload,
  NotificationEventCode,
  NotificationInput,
  NotificationPrefs,
  NotificationSeverity,
  NotifyOptions,
} from './types';
import { isNotificationEventCode } from './types';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  allowTips: true,
  allowSystemInfo: true,
  playSound: false,
};

const DEFAULT_DEDUPE_COOLDOWN_MS = 6000;
const TOAST_MIN_GAP_MS = 1200;
const TOAST_VISIBLE_LIMIT = 2;
const GENERATION_FAILURE_WINDOW_MS = 3 * 60 * 1000;
const GENERATION_FAILURE_ESCALATION_MS = 5 * 60 * 1000;
const INBOX_ONLY_MODE = true;
const NON_RUNTIME_GENERATION_FAILURE_HINTS = [
  'sign in',
  'authentication',
  'auth token',
  'unauthorized',
  'forbidden',
  'complete your user id',
  'complete your userid',
  'requireduserid',
  'profile service',
  'wallet',
  'insufficient',
  'daily generation limit',
  'quota',
  'rate limit',
];

export const shouldEscalateRepeatedGenerationFailure = (message: string): boolean => {
  const lowered = sanitizeUiText(String(message || '').trim()).toLowerCase();
  if (!lowered) return true;
  return !NON_RUNTIME_GENERATION_FAILURE_HINTS.some((token) => lowered.includes(token));
};

export const coerceNotificationPrefs = (input: unknown): NotificationPrefs => {
  const candidate = input && typeof input === 'object' ? (input as Partial<NotificationPrefs>) : {};
  return {
    allowTips: candidate.allowTips !== false,
    allowSystemInfo: candidate.allowSystemInfo !== false,
    playSound: candidate.playSound === true,
  };
};

const defaultTitleForSeverity = (severity: NotificationSeverity): string => {
  if (severity === 'success') return 'Success';
  if (severity === 'warning') return 'Warning';
  if (severity === 'error') return 'Error';
  if (severity === 'critical') return 'Critical Alert';
  return 'Info';
};

const coerceStoredNotification = (input: unknown, nowMs: number): AppNotification | null => {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<AppNotification>;
  const id = String(raw.id || '').trim();
  const eventCandidate = String(raw.eventCode || '').trim();
  const eventCode: NotificationEventCode = isNotificationEventCode(eventCandidate)
    ? eventCandidate
    : 'custom.message';
  const title = sanitizeUiText(String(raw.title || '').trim());
  const message = sanitizeUiText(String(raw.message || '').trim());
  const details = sanitizeUiText(String(raw.details || '').trim());
  const severity = String(raw.severity || '').trim() as NotificationSeverity;
  const category = String(raw.category || '').trim();
  const channel = String(raw.channel || '').trim();
  const status = String(raw.status || '').trim();
  const createdAt = Number(raw.createdAt || nowMs);
  const expiresAt = Number(raw.expiresAt || createdAt + NOTIFICATION_TTL_MS);
  if (!id || !message) return null;
  if (!['success', 'info', 'warning', 'error', 'critical'].includes(severity)) return null;
  if (!['system', 'activity', 'security', 'tips'].includes(category)) return null;

  const channelValues: AppNotification['channel'][] = ['toast', 'inbox', 'silent'];
  const normalizedChannel = channelValues.includes(channel as AppNotification['channel'])
    ? (channel as AppNotification['channel'])
    : raw.toastVisible === true
      ? 'toast'
      : 'inbox';
  const hydratedChannel: AppNotification['channel'] =
    INBOX_ONLY_MODE && normalizedChannel === 'toast' ? 'inbox' : normalizedChannel;
  const normalizedStatus = (['active', 'resolved'] as const).includes(status as 'active')
    ? (status as AppNotification['status'])
    : 'active';

  return {
    id,
    eventCode,
    entityKey: String(raw.entityKey || '').trim() || undefined,
    title: title || getNotificationCatalogEntry(eventCode).title || defaultTitleForSeverity(severity),
    message,
    ...(details ? { details } : {}),
    severity,
    category: category as AppNotification['category'],
    channel: hydratedChannel,
    status: normalizedStatus,
    resolvedAt: Number.isFinite(Number(raw.resolvedAt)) ? Number(raw.resolvedAt) : null,
    resolvedBy: String(raw.resolvedBy || '').trim() || null,
    createdAt: Number.isFinite(createdAt) ? createdAt : nowMs,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : nowMs + NOTIFICATION_TTL_MS,
    readAt: Number.isFinite(Number(raw.readAt)) ? Number(raw.readAt) : null,
    sticky: raw.sticky === true || severity === 'critical',
    dedupeKey: String(raw.dedupeKey || '').trim() || undefined,
    toastVisible: normalizedStatus === 'active' && hydratedChannel === 'toast' && raw.toastVisible === true,
    action:
      raw.action && typeof raw.action === 'object'
        ? {
            label:
              sanitizeUiText(String((raw.action as { label?: string }).label || '').trim()) || 'Open',
          }
        : undefined,
  };
};

export const prepareNotificationsForStorage = (notifications: AppNotification[]): AppNotification[] =>
  notifications.map((item) => ({
    ...item,
    title: sanitizeUiText(String(item.title || '').trim()) || defaultTitleForSeverity(item.severity),
    message: sanitizeUiText(String(item.message || '').trim()) || 'Notification',
    details: sanitizeUiText(String(item.details || '').trim()) || undefined,
    action: item.action
      ? {
          label: sanitizeUiText(String(item.action.label || '').trim()) || 'Open',
        }
      : undefined,
  }));

const buildId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // no-op
  }
  return `notif_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const tryPlayNotificationSound = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.0001;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    const now = context.currentTime;
    gainNode.gain.exponentialRampToValueAtTime(0.03, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.start(now);
    oscillator.stop(now + 0.16);
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 240);
  } catch {
    // no-op
  }
};

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  prefs: NotificationPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<NotificationPrefs>>;
  isCenterOpen: boolean;
  setCenterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  emit: (eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions) => string;
  notify: (input: NotificationInput, options?: NotifyOptions) => string;
  notifySuccess: (
    message: string,
    options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
  ) => string;
  notifyInfo: (
    message: string,
    options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
  ) => string;
  notifyWarning: (
    message: string,
    options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
  ) => string;
  notifyError: (
    message: string,
    options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
  ) => string;
  notifyCritical: (
    message: string,
    options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
  ) => string;
  resolveByEvent: (eventCode: NotificationEventCode, entityKey?: string) => void;
  archiveResolved: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearNonCritical: () => void;
  clearRead: () => void;
  clearByIds: (ids: string[]) => void;
  clearAll: () => void;
  remove: (id: string) => void;
  hideToast: (id: string) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const now = Date.now();
  const initialNotifications = useMemo(() => {
    const parsed = readStorageJson<unknown[]>(STORAGE_KEYS.notifications);
    const rows = Array.isArray(parsed) ? parsed : [];
    const normalized = rows
      .map((row) => coerceStoredNotification(row, now))
      .filter((row): row is AppNotification => Boolean(row));
    return limitNotifications(pruneExpiredNotifications(normalized, now), NOTIFICATION_MAX_ITEMS);
  }, [now]);
  const initialPrefs = useMemo(
    () => coerceNotificationPrefs(readStorageJson(STORAGE_KEYS.notificationPrefs)),
    []
  );

  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications);
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [isCenterOpen, setCenterOpen] = useState(false);
  const notificationsRef = useRef<AppNotification[]>(initialNotifications);
  const prefsRef = useRef<NotificationPrefs>(initialPrefs);
  const emitRef = useRef<
    (eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions) => string
  >(() => '');
  const lastToastAtRef = useRef<number>(0);
  const generationFailuresRef = useRef<Record<string, number[]>>({});
  const generationEscalationUntilRef = useRef<Record<string, number>>({});

  useEffect(() => {
    notificationsRef.current = notifications;
    writeStorageJson(STORAGE_KEYS.notifications, prepareNotificationsForStorage(notifications));
  }, [notifications]);

  useEffect(() => {
    prefsRef.current = prefs;
    writeStorageJson(STORAGE_KEYS.notificationPrefs, prefs);
  }, [prefs]);

  const commitNotifications = useCallback((next: AppNotification[]) => {
    const normalized = limitNotifications(pruneExpiredNotifications(next), NOTIFICATION_MAX_ITEMS);
    notificationsRef.current = normalized;
    setNotifications(normalized);
  }, []);

  const canShowToast = useCallback((rows: AppNotification[], nowMs: number): boolean => {
    const visibleCount = rows.filter((item) => item.toastVisible && item.status === 'active').length;
    if (visibleCount >= TOAST_VISIBLE_LIMIT) return false;
    return nowMs - lastToastAtRef.current >= TOAST_MIN_GAP_MS;
  }, []);

  const emit = useCallback(
    (eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions): string => {
      const nowMs = Date.now();
      const safePayload: NotificationEmitPayload = payload || {};
      const policy = resolveNotificationPolicy(eventCode, safePayload);
      const entityKey = String(safePayload.entityKey || '').trim();
      const useFriendlyErrorMessage = policy.severity === 'critical' || policy.severity === 'error';
      const fallbackMessage = safePayload.message || policy.catalog.message || 'Notification';
      const message = sanitizeUiText(
        useFriendlyErrorMessage
          ? toUserMessage(safePayload.message || policy.catalog.message, fallbackMessage)
          : String(safePayload.message || policy.catalog.message || '').trim()
      );
      if (!message) return '';
      const currentRows = pruneExpiredNotifications(notificationsRef.current, nowMs);

      let channel = safePayload.channel || policy.channel;
      if (eventCode === 'generation.failed' && !options?.skipEscalation) {
        const shouldEscalate = shouldEscalateRepeatedGenerationFailure(message);
        if (shouldEscalate) {
        const failureKey = entityKey || 'global';
        const currentHistory = generationFailuresRef.current[failureKey] || [];
        const withinWindow = currentHistory.filter((timestamp) => nowMs - timestamp <= GENERATION_FAILURE_WINDOW_MS);
        withinWindow.push(nowMs);
        generationFailuresRef.current[failureKey] = withinWindow;
        const escalationUntil = generationEscalationUntilRef.current[failureKey] || 0;
        if (escalationUntil > nowMs) {
          channel = 'inbox';
        }
        if (withinWindow.length >= 2 && escalationUntil <= nowMs) {
          generationEscalationUntilRef.current[failureKey] = nowMs + GENERATION_FAILURE_ESCALATION_MS;
          channel = 'inbox';
          window.setTimeout(() => {
            const escalationPayload: NotificationEmitPayload = {
              entityKey: failureKey,
              title: 'Generation Failure',
              message: 'Generation has failed repeatedly. Review runtime/backend health and latest error details, then retry.',
              sticky: true,
              ...(safePayload.action ? { action: safePayload.action } : {}),
            };
            emitRef.current(
              'generation.failed_repeated',
              escalationPayload,
              {
                cooldownMs: GENERATION_FAILURE_ESCALATION_MS,
                resurfaceOnDedupe: false,
                skipEscalation: true,
              }
            );
          }, 0);
        }
        }
      }
      const hasActiveOutage = currentRows.some((item) => {
        if (item.status !== 'active') return false;
        if (item.eventCode !== 'runtime.offline' && item.eventCode !== 'backend.offline') return false;
        if (!entityKey) return true;
        return !item.entityKey || item.entityKey === entityKey;
      });
      if (hasActiveOutage && (eventCode === 'generation.failed' || eventCode === 'generation.failed_repeated')) {
        channel = 'inbox';
      }
      if (INBOX_ONLY_MODE && channel === 'toast') {
        channel = 'inbox';
      }

      const title =
        sanitizeUiText(String(safePayload.title || policy.catalog.title || '').trim()) ||
        defaultTitleForSeverity(policy.severity);
      const details = sanitizeUiText(String(safePayload.details || '').trim());
      const status: AppNotification['status'] = 'active';
      const dedupeKey = buildEventDedupeKey(eventCode, entityKey || undefined, safePayload.dedupeKey);
      const baseToastVisible =
        safePayload.toastVisible === false
          ? false
          : safePayload.toastVisible === true
            ? true
            : channel === 'toast';
      const toastVisible =
        baseToastVisible && status === 'active' && channel === 'toast'
          ? canShowToast(currentRows, nowMs)
          : false;

      const nextNotification: AppNotification = {
        id: buildId(),
        eventCode,
        entityKey: entityKey || undefined,
        title,
        message,
        ...(details ? { details } : {}),
        severity: policy.severity,
        category: policy.category,
        channel,
        status,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: nowMs,
        expiresAt: nowMs + NOTIFICATION_TTL_MS,
        readAt: null,
        sticky: safePayload.sticky === true || policy.sticky,
        dedupeKey,
        toastVisible,
        action: safePayload.action
          ? {
              label: sanitizeUiText(String(safePayload.action.label || '').trim()) || 'Open',
              onClick: safePayload.action.onClick,
            }
          : undefined,
      };

      if (!applyPrefsFilter(nextNotification, prefsRef.current)) return '';
      if (nextNotification.channel === 'silent') return '';

      const deduped = dedupeWithCooldown(
        currentRows,
        nextNotification,
        Math.max(1000, Number(options?.cooldownMs || policy.dedupeCooldownMs || DEFAULT_DEDUPE_COOLDOWN_MS)),
        nowMs,
        { resurfaceOnDedupe: options?.resurfaceOnDedupe === true }
      );

      let nextRows = deduped.items;
      if (!options?.suppressAutoResolve && policy.resolveEventCodes.length > 0) {
        nextRows = resolveNotificationsByEventCodes(
          nextRows,
          policy.resolveEventCodes,
          entityKey || undefined,
          deduped.notification.id,
          nowMs
        );
      }
      commitNotifications(nextRows);

      if (deduped.notification.toastVisible && deduped.notification.channel === 'toast') {
        lastToastAtRef.current = nowMs;
      }
      if (
        prefsRef.current.playSound &&
        (policy.severity === 'warning' || policy.severity === 'error' || policy.severity === 'critical') &&
        deduped.notification.toastVisible
      ) {
        tryPlayNotificationSound();
      }
      return deduped.notification.id;
    },
    [canShowToast, commitNotifications]
  );

  useEffect(() => {
    emitRef.current = emit;
  }, [emit]);

  const notify = useCallback(
    (input: NotificationInput, options?: NotifyOptions): string => {
      const message = sanitizeUiText(String(input.message || '').trim());
      if (!message) return '';
      const payload: NotificationEmitPayload = {
        message,
        ...(input.entityKey ? { entityKey: input.entityKey } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.details ? { details: input.details } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.sticky === true ? { sticky: true } : {}),
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        ...(typeof input.toastVisible === 'boolean' ? { toastVisible: input.toastVisible } : {}),
        ...(input.action ? { action: input.action } : {}),
      };
      return emit(
        input.eventCode || 'custom.message',
        payload,
        options
      );
    },
    [emit]
  );

  const notifyWithSeverity = useCallback(
    (
      severity: NotificationSeverity,
      message: string,
      options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions
    ): string => {
      const { cooldownMs, resurfaceOnDedupe, ...rest } = options || {};
      return notify(
        {
          ...rest,
          message,
          severity,
          eventCode: rest.eventCode || 'custom.message',
        },
        {
          ...(typeof cooldownMs === 'number' ? { cooldownMs } : {}),
          ...(typeof resurfaceOnDedupe === 'boolean' ? { resurfaceOnDedupe } : {}),
        }
      );
    },
    [notify]
  );

  const notifySuccess = useCallback(
    (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string =>
      notifyWithSeverity('success', message, options),
    [notifyWithSeverity]
  );
  const notifyInfo = useCallback(
    (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string =>
      notifyWithSeverity('info', message, options),
    [notifyWithSeverity]
  );
  const notifyWarning = useCallback(
    (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string =>
      notifyWithSeverity('warning', message, options),
    [notifyWithSeverity]
  );
  const notifyError = useCallback(
    (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string =>
      notifyWithSeverity('error', message, options),
    [notifyWithSeverity]
  );
  const notifyCritical = useCallback(
    (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string =>
      notifyWithSeverity('critical', message, options),
    [notifyWithSeverity]
  );

  const resolveByEvent = useCallback(
    (eventCode: NotificationEventCode, entityKey?: string) => {
      commitNotifications(
        resolveNotificationsByEventCodes(
          notificationsRef.current,
          [eventCode],
          entityKey,
          null,
          Date.now()
        )
      );
    },
    [commitNotifications]
  );

  const archiveResolvedItems = useCallback(() => {
    commitNotifications(archiveResolved(notificationsRef.current));
  }, [commitNotifications]);

  const markReadItem = useCallback(
    (id: string) => {
      commitNotifications(markRead(notificationsRef.current, id));
    },
    [commitNotifications]
  );

  const markAllReadItems = useCallback(() => {
    commitNotifications(markAllRead(notificationsRef.current));
  }, [commitNotifications]);

  const clearNonCriticalItems = useCallback(() => {
    commitNotifications(clearNonCritical(notificationsRef.current));
  }, [commitNotifications]);

  const clearReadItems = useCallback(() => {
    commitNotifications(clearReadNotifications(notificationsRef.current));
  }, [commitNotifications]);

  const clearByIdsItems = useCallback(
    (ids: string[]) => {
      commitNotifications(clearNotificationsByIds(notificationsRef.current, ids));
    },
    [commitNotifications]
  );

  const clearAllItems = useCallback(() => {
    commitNotifications([]);
  }, [commitNotifications]);

  const removeItem = useCallback(
    (id: string) => {
      commitNotifications(removeNotification(notificationsRef.current, id));
    },
    [commitNotifications]
  );

  const hideToast = useCallback(
    (id: string) => {
      commitNotifications(
        notificationsRef.current.map((item) => {
          if (item.id !== id) return item;
          return { ...item, toastVisible: false };
        })
      );
    },
    [commitNotifications]
  );

  useEffect(() => {
    const onOffline = () => {
      emit(
        'connectivity.offline',
        {
          action: {
            label: 'Reload',
            onClick: () => window.location.reload(),
          },
        },
        { cooldownMs: 15_000 }
      );
    };
    const onOnline = () => {
      emit('connectivity.online', {}, { cooldownMs: 8_000 });
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [emit]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt && item.status === 'active').length,
    [notifications]
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount,
      prefs,
      setPrefs,
      isCenterOpen,
      setCenterOpen,
      emit,
      notify,
      notifySuccess,
      notifyInfo,
      notifyWarning,
      notifyError,
      notifyCritical,
      resolveByEvent,
      archiveResolved: archiveResolvedItems,
      markRead: markReadItem,
      markAllRead: markAllReadItems,
      clearNonCritical: clearNonCriticalItems,
      clearRead: clearReadItems,
      clearByIds: clearByIdsItems,
      clearAll: clearAllItems,
      remove: removeItem,
      hideToast,
    }),
    [
      archiveResolvedItems,
      clearAllItems,
      clearByIdsItems,
      clearNonCriticalItems,
      clearReadItems,
      emit,
      hideToast,
      isCenterOpen,
      markAllReadItems,
      markReadItem,
      notifications,
      notify,
      notifyCritical,
      notifyError,
      notifyInfo,
      notifySuccess,
      notifyWarning,
      prefs,
      removeItem,
      resolveByEvent,
      unreadCount,
    ]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsContextValue => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};
