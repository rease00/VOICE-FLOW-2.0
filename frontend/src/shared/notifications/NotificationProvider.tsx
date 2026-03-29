/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../storage/keys';
import { readStorageJson, removeStorageKey, writeStorageJson } from '../storage/localStore';
import { resolveApiBaseUrl } from '../api/config';
import { hasAdminConsoleAccess } from '../auth/adminAccess';
import { sanitizeUiText } from '../ui/terminology';
import { getNotificationCatalogEntry } from './catalog';
import { applyNotificationActionTarget } from './deepLink';
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
  NotificationAction,
  NotificationEmitPayload,
  NotificationEventCode,
  NotificationInput,
  NotificationPrefs,
  NotificationSeverity,
  NotifyOptions,
} from './types';
import { isNotificationEventCode } from './types';
import {
  dismissAccountNotification,
  dismissAllAccountNotifications,
  fetchAccountNotifications,
  fetchNotificationPreferences,
  markAccountNotificationRead,
  markAllAccountNotificationsRead,
  patchNotificationPreferences,
  type NotificationWireItem,
} from '../../../services/notificationService';
import { useUser } from '../../../contexts/UserContext';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  allowTips: true,
  allowSystemInfo: true,
  playSound: false,
  emailAsyncJobs: true,
  emailBilling: true,
  emailSupport: true,
  emailAdminAlerts: false,
};

const DEFAULT_DEDUPE_COOLDOWN_MS = 6000;
const TOAST_MIN_GAP_MS = 1200;
const TOAST_VISIBLE_LIMIT = 2;
const GENERATION_FAILURE_WINDOW_MS = 3 * 60 * 1000;
const GENERATION_FAILURE_ESCALATION_MS = 5 * 60 * 1000;
const NOTIFICATION_STORAGE_VERSION = 'v2_server_inbox';
const NOTIFICATION_POLL_MS = 60_000;
const NOTIFICATION_POLL_HIDDEN_MS = 5 * 60_000;
const NOTIFICATION_POLL_ERROR_BASE_MS = 75_000;
const NOTIFICATION_POLL_ERROR_MAX_MS = 10 * 60_000;
const NOTIFICATION_SYNC_MIN_GAP_MS = 15_000;
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

export const resolveNotificationPollDelayMs = (
  input: {
    visibilityState?: DocumentVisibilityState | string;
    errorCount?: number;
  } = {}
): number => {
  if (String(input.visibilityState || '').trim() === 'hidden') {
    return NOTIFICATION_POLL_HIDDEN_MS;
  }

  const errorCount = Math.max(0, Math.floor(Number(input.errorCount || 0)));
  if (errorCount <= 0) return NOTIFICATION_POLL_MS;

  const exponent = Math.max(0, errorCount - 1);
  return Math.min(NOTIFICATION_POLL_ERROR_MAX_MS, Math.round(NOTIFICATION_POLL_ERROR_BASE_MS * (2 ** exponent)));
};

const readSettingsBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const toTimestampMs = (value: unknown, fallback = Date.now()): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value);
  const token = String(value || '').trim();
  if (!token) return fallback;
  const numeric = Number(token);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(token);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeAction = (action: NotificationAction | undefined): NotificationAction | undefined => {
  if (!action || typeof action !== 'object') return undefined;
  const label = sanitizeUiText(String(action.label || '').trim()) || 'Open';
  const target = action.target && typeof action.target === 'object'
    ? {
        ...(action.target.screen ? { screen: String(action.target.screen).trim() } : {}),
        ...(action.target.tab ? { tab: String(action.target.tab).trim() } : {}),
        ...(action.target.adminTab ? { adminTab: String(action.target.adminTab).trim() } : {}),
        ...(action.target.conversationId ? { conversationId: String(action.target.conversationId).trim() } : {}),
        ...(action.target.jobId ? { jobId: String(action.target.jobId).trim() } : {}),
        ...(action.target.href ? { href: String(action.target.href).trim() } : {}),
      }
    : undefined;
  return {
    label,
    ...(target ? { target } : {}),
    ...(typeof action.onClick === 'function' ? { onClick: action.onClick } : {}),
  };
};

export const coerceNotificationPrefs = (input: unknown): NotificationPrefs => {
  const candidate = input && typeof input === 'object' ? (input as Partial<NotificationPrefs>) : {};
  return {
    allowTips: candidate.allowTips !== false,
    allowSystemInfo: candidate.allowSystemInfo !== false,
    playSound: candidate.playSound === true,
    emailAsyncJobs: candidate.emailAsyncJobs !== false,
    emailBilling: candidate.emailBilling !== false,
    emailSupport: candidate.emailSupport !== false,
    emailAdminAlerts: candidate.emailAdminAlerts === true,
  };
};

const defaultTitleForSeverity = (severity: NotificationSeverity): string => {
  if (severity === 'success') return 'Success';
  if (severity === 'warning') return 'Warning';
  if (severity === 'error') return 'Error';
  if (severity === 'critical') return 'Critical Alert';
  return 'Info';
};

export const coercePersistedNotification = (input: NotificationWireItem, nowMs: number): AppNotification | null => {
  const id = String(input?.id || '').trim();
  const eventCandidate = String(input?.eventCode || '').trim();
  const eventCode: NotificationEventCode = isNotificationEventCode(eventCandidate) ? eventCandidate : 'custom.message';
  const message = sanitizeUiText(String(input?.message || '').trim());
  if (!id || !message) return null;
  const severity = String(input?.severity || getNotificationCatalogEntry(eventCode).severity || 'info').trim() as NotificationSeverity;
  const category = String(input?.category || getNotificationCatalogEntry(eventCode).category || 'activity').trim();
  if (!['success', 'info', 'warning', 'error', 'critical'].includes(severity)) return null;
  if (!['system', 'activity', 'security', 'tips'].includes(category)) return null;
  const createdAt = toTimestampMs(input?.createdAt, nowMs);
  const expiresAt = input?.expiresAt != null ? toTimestampMs(input.expiresAt, createdAt + (30 * 24 * 60 * 60 * 1000)) : createdAt + (30 * 24 * 60 * 60 * 1000);
  return {
    id,
    eventCode,
    entityKey: String(input?.entityKey || '').trim() || undefined,
    title: sanitizeUiText(String(input?.title || '').trim()) || getNotificationCatalogEntry(eventCode).title || defaultTitleForSeverity(severity),
    message,
    details: sanitizeUiText(String(input?.details || '').trim()) || undefined,
    severity,
    category: category as AppNotification['category'],
    audience: String(input?.audience || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user',
    scope: 'persisted',
    channel: 'inbox',
    status: String(input?.status || '').trim().toLowerCase() === 'resolved' ? 'resolved' : 'active',
    resolvedAt: input?.resolvedAt ? toTimestampMs(input.resolvedAt, createdAt) : null,
    resolvedBy: String(input?.resolvedBy || '').trim() || null,
    createdAt,
    expiresAt,
    readAt: input?.readAt ? toTimestampMs(input.readAt, createdAt) : null,
    dismissedAt: input?.dismissedAt ? toTimestampMs(input.dismissedAt, createdAt) : null,
    sticky: input?.sticky === true || severity === 'critical',
    dedupeKey: String(input?.dedupeKey || '').trim() || undefined,
    toastVisible: false,
    requiredPermission: String(input?.requiredPermission || '').trim() || undefined,
    emailEligible: input?.emailEligible === true,
    action: sanitizeAction(input?.action ? { label: String(input.action.label || '').trim(), target: input.action.target } : undefined),
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
          ...(item.action.target ? { target: item.action.target } : {}),
        }
      : undefined,
  }));

const buildId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `notif_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const tryPlayNotificationSound = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    window.setTimeout(() => { void context.close().catch(() => undefined); }, 240);
  } catch {}
};

interface NotificationsContextValue {
  notifications: AppNotification[];
  toastNotifications: AppNotification[];
  unreadCount: number;
  prefs: NotificationPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<NotificationPrefs>>;
  isCenterOpen: boolean;
  setCenterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  emit: (eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions) => string;
  notify: (input: NotificationInput, options?: NotifyOptions) => string;
  notifySuccess: (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => string;
  notifyInfo: (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => string;
  notifyWarning: (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => string;
  notifyError: (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => string;
  notifyCritical: (message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => string;
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
  runAction: (action?: NotificationAction) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user } = useUser();
  const hasSessionIdentity = Boolean(String(user.uid || '').trim());
  const canSeeAdminNotifications = hasAdminConsoleAccess(user);
  const initialPrefs = useMemo(
    () => coerceNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...(readStorageJson(STORAGE_KEYS.notificationPrefs) || {}) }),
    []
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toastNotifications, setToastNotifications] = useState<AppNotification[]>([]);
  const [prefsState, setPrefsState] = useState<NotificationPrefs>(initialPrefs);
  const [isCenterOpen, setCenterOpen] = useState(false);
  const notificationsRef = useRef<AppNotification[]>([]);
  const toastNotificationsRef = useRef<AppNotification[]>([]);
  const prefsRef = useRef<NotificationPrefs>(initialPrefs);
  const emitRef = useRef<(eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions) => string>(() => '');
  const lastToastAtRef = useRef(0);
  const lastPersistedSyncAtRef = useRef(0);
  const persistedSyncInFlightRef = useRef(false);
  const persistedSyncQueuedRef = useRef(false);
  const persistedSyncErrorCountRef = useRef(0);
  const persistedSyncTimerRef = useRef<number | null>(null);
  const generationFailuresRef = useRef<Record<string, number[]>>({});
  const generationEscalationUntilRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const version = String(readStorageJson(STORAGE_KEYS.notificationStateVersion) || '').trim();
    if (version === NOTIFICATION_STORAGE_VERSION) return;
    removeStorageKey(STORAGE_KEYS.notifications);
    writeStorageJson(STORAGE_KEYS.notificationStateVersion, NOTIFICATION_STORAGE_VERSION);
  }, []);

  useEffect(() => {
    prefsRef.current = prefsState;
    writeStorageJson(STORAGE_KEYS.notificationPrefs, prefsState);
  }, [prefsState]);

  const runAction = useCallback((action?: NotificationAction) => {
    if (!action) return;
    if (typeof action.onClick === 'function') {
      action.onClick();
      return;
    }
    if (action.target) applyNotificationActionTarget(action.target);
  }, []);

  const clearPersistedSyncTimer = useCallback(() => {
    if (persistedSyncTimerRef.current == null) return;
    window.clearTimeout(persistedSyncTimerRef.current);
    persistedSyncTimerRef.current = null;
  }, []);

  const schedulePersistedNotificationSync = useCallback((delayMs?: number) => {
    if (!hasSessionIdentity || typeof window === 'undefined') return;
    clearPersistedSyncTimer();
    const nextDelay = Math.max(
      0,
      Math.floor(
        delayMs ?? resolveNotificationPollDelayMs({
          visibilityState: document.visibilityState,
          errorCount: persistedSyncErrorCountRef.current,
        })
      )
    );
    persistedSyncTimerRef.current = window.setTimeout(() => {
      void syncPersistedNotifications({ force: true, source: 'timer' });
    }, nextDelay);
  }, [clearPersistedSyncTimer, hasSessionIdentity]);

  const syncPersistedNotifications = useCallback(async (options?: { force?: boolean; source?: string }): Promise<boolean> => {
    if (!hasSessionIdentity) {
      notificationsRef.current = [];
      setNotifications([]);
      lastPersistedSyncAtRef.current = Date.now();
      return true;
    }
    const nowMs = Date.now();
    const shouldSkipForFreshSync = options?.force !== true
      && nowMs - lastPersistedSyncAtRef.current < NOTIFICATION_SYNC_MIN_GAP_MS;
    if (shouldSkipForFreshSync) return true;
    if (persistedSyncInFlightRef.current) {
      persistedSyncQueuedRef.current = true;
      return true;
    }
    persistedSyncInFlightRef.current = true;
    try {
      const rows = await fetchAccountNotifications(readSettingsBackendUrl(), { limit: 150 });
      const normalized = rows
        .map((row) => coercePersistedNotification(row, Date.now()))
        .filter((row): row is AppNotification => Boolean(row));
      notificationsRef.current = normalized;
      setNotifications(normalized);
      persistedSyncErrorCountRef.current = 0;
      lastPersistedSyncAtRef.current = Date.now();
      return true;
    } catch {
      persistedSyncErrorCountRef.current = Math.min(persistedSyncErrorCountRef.current + 1, 10);
      return false;
    } finally {
      persistedSyncInFlightRef.current = false;
      if (persistedSyncQueuedRef.current) {
        persistedSyncQueuedRef.current = false;
      }
      schedulePersistedNotificationSync();
    }
  }, [hasSessionIdentity, schedulePersistedNotificationSync]);

  const syncPreferences = useCallback(async () => {
    if (!hasSessionIdentity) return;
    try {
      const remote = await fetchNotificationPreferences(readSettingsBackendUrl());
      setPrefsState((prev) => coerceNotificationPrefs({ ...prev, ...remote }));
    } catch {}
  }, [hasSessionIdentity]);

  useEffect(() => {
    if (!hasSessionIdentity) {
      notificationsRef.current = [];
      setNotifications([]);
      clearPersistedSyncTimer();
      persistedSyncErrorCountRef.current = 0;
      return;
    }
    void syncPersistedNotifications({ force: true, source: 'identity' });
    void syncPreferences();
  }, [clearPersistedSyncTimer, hasSessionIdentity, syncPersistedNotifications, syncPreferences, user.uid]);

  useEffect(() => {
    if (!hasSessionIdentity || !isCenterOpen) return;
    void syncPersistedNotifications({ source: 'center-open' });
  }, [hasSessionIdentity, isCenterOpen, syncPersistedNotifications]);

  useEffect(() => {
    if (!hasSessionIdentity || typeof window === 'undefined') return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        schedulePersistedNotificationSync(NOTIFICATION_POLL_HIDDEN_MS);
        return;
      }
      void syncPersistedNotifications({ force: true, source: 'visibility' });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    schedulePersistedNotificationSync();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearPersistedSyncTimer();
    };
  }, [clearPersistedSyncTimer, hasSessionIdentity, schedulePersistedNotificationSync, syncPersistedNotifications]);

  const commitToastNotifications = useCallback((next: AppNotification[]) => {
    const normalized = limitNotifications(pruneExpiredNotifications(next), NOTIFICATION_MAX_ITEMS);
    toastNotificationsRef.current = normalized;
    setToastNotifications(normalized);
  }, []);

  const canShowToast = useCallback((rows: AppNotification[], nowMs: number): boolean => {
    const visibleCount = rows.filter((item) => item.toastVisible && item.status === 'active').length;
    return visibleCount < TOAST_VISIBLE_LIMIT && nowMs - lastToastAtRef.current >= TOAST_MIN_GAP_MS;
  }, []);

  const emit = useCallback((eventCode: NotificationEventCode, payload?: NotificationEmitPayload, options?: EmitOptions): string => {
    const nowMs = Date.now();
    const safePayload = payload || {};
    const policy = resolveNotificationPolicy(eventCode, safePayload, { isAdmin: canSeeAdminNotifications });
    if (policy.channel !== 'toast') return '';
    const entityKey = String(safePayload.entityKey || '').trim();
    const fallbackMessage = safePayload.message || policy.catalog.message || 'Notification';
    const message = sanitizeUiText(
      policy.severity === 'critical' || policy.severity === 'error'
        ? toUserMessage(safePayload.message || policy.catalog.message, fallbackMessage)
        : String(safePayload.message || policy.catalog.message || '').trim()
    );
    if (!message) return '';
    const currentRows = pruneExpiredNotifications(toastNotificationsRef.current, nowMs);
    if (eventCode === 'generation.failed' && !options?.skipEscalation && shouldEscalateRepeatedGenerationFailure(message)) {
      const failureKey = entityKey || 'global';
      const history = (generationFailuresRef.current[failureKey] || []).filter((timestamp) => nowMs - timestamp <= GENERATION_FAILURE_WINDOW_MS);
      history.push(nowMs);
      generationFailuresRef.current[failureKey] = history;
      const escalationUntil = generationEscalationUntilRef.current[failureKey] || 0;
      if (history.length >= 2 && escalationUntil <= nowMs) {
        generationEscalationUntilRef.current[failureKey] = nowMs + GENERATION_FAILURE_ESCALATION_MS;
        window.setTimeout(() => {
          emitRef.current('generation.failed_repeated', {
            entityKey: failureKey,
            title: 'Generation Failure',
            message: 'Generation has failed repeatedly. Review runtime/backend health and latest error details, then retry.',
            sticky: true,
            ...(safePayload.action ? { action: safePayload.action } : {}),
          }, { cooldownMs: GENERATION_FAILURE_ESCALATION_MS, resurfaceOnDedupe: false, skipEscalation: true });
        }, 0);
      }
    }
    const nextNotification: AppNotification = {
      id: buildId(),
      eventCode,
      entityKey: entityKey || undefined,
      title: sanitizeUiText(String(safePayload.title || policy.catalog.title || '').trim()) || defaultTitleForSeverity(policy.severity),
      message,
      details: sanitizeUiText(String(safePayload.details || '').trim()) || undefined,
      severity: policy.severity,
      category: policy.category,
      audience: policy.audience,
      scope: 'ephemeral',
      channel: 'toast',
      status: 'active',
      resolvedAt: null,
      resolvedBy: null,
      createdAt: nowMs,
      expiresAt: nowMs + NOTIFICATION_TTL_MS,
      readAt: null,
      dismissedAt: null,
      sticky: safePayload.sticky === true || policy.sticky,
      dedupeKey: buildEventDedupeKey(eventCode, entityKey || undefined, safePayload.dedupeKey),
      toastVisible: canShowToast(currentRows, nowMs),
      requiredPermission: safePayload.requiredPermission,
      emailEligible: safePayload.emailEligible === true,
      action: sanitizeAction(safePayload.action),
    };
    if (!applyPrefsFilter(nextNotification, prefsRef.current)) return '';
    const deduped = dedupeWithCooldown(
      currentRows,
      nextNotification,
      Math.max(1000, Number(options?.cooldownMs || policy.dedupeCooldownMs || DEFAULT_DEDUPE_COOLDOWN_MS)),
      nowMs,
      { resurfaceOnDedupe: options?.resurfaceOnDedupe === true }
    );
    let nextRows = deduped.items;
    if (!options?.suppressAutoResolve && policy.resolveEventCodes.length > 0) {
      nextRows = resolveNotificationsByEventCodes(nextRows, policy.resolveEventCodes, entityKey || undefined, deduped.notification.id, nowMs);
    }
    commitToastNotifications(nextRows);
    if (deduped.notification.toastVisible) lastToastAtRef.current = nowMs;
    if (prefsRef.current.playSound && ['warning', 'error', 'critical'].includes(policy.severity) && deduped.notification.toastVisible) {
      tryPlayNotificationSound();
    }
    return deduped.notification.id;
  }, [canSeeAdminNotifications, canShowToast, commitToastNotifications]);

  useEffect(() => { emitRef.current = emit; }, [emit]);

  const notify = useCallback((input: NotificationInput, options?: NotifyOptions): string => {
    const message = sanitizeUiText(String(input.message || '').trim());
    if (!message) return '';
    return emit(input.eventCode || 'custom.message', {
      message,
      ...(input.entityKey ? { entityKey: input.entityKey } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.details ? { details: input.details } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.sticky === true ? { sticky: true } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(input.requiredPermission ? { requiredPermission: input.requiredPermission } : {}),
      ...(input.emailEligible === true ? { emailEligible: true } : {}),
      ...(typeof input.toastVisible === 'boolean' ? { toastVisible: input.toastVisible } : {}),
      ...(input.action ? { action: input.action } : {}),
    }, options);
  }, [emit]);

  const notifyWithSeverity = useCallback((severity: NotificationSeverity, message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions): string => {
    const { cooldownMs, resurfaceOnDedupe, ...rest } = options || {};
    return notify({ ...rest, message, severity, eventCode: rest.eventCode || 'custom.message' }, { ...(typeof cooldownMs === 'number' ? { cooldownMs } : {}), ...(typeof resurfaceOnDedupe === 'boolean' ? { resurfaceOnDedupe } : {}) });
  }, [notify]);

  const notifySuccess = useCallback((message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => notifyWithSeverity('success', message, options), [notifyWithSeverity]);
  const notifyInfo = useCallback((message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => notifyWithSeverity('info', message, options), [notifyWithSeverity]);
  const notifyWarning = useCallback((message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => notifyWithSeverity('warning', message, options), [notifyWithSeverity]);
  const notifyError = useCallback((message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => notifyWithSeverity('error', message, options), [notifyWithSeverity]);
  const notifyCritical = useCallback((message: string, options?: Omit<NotificationInput, 'message' | 'severity'> & NotifyOptions) => notifyWithSeverity('critical', message, options), [notifyWithSeverity]);

  const resolveByEvent = useCallback((eventCode: NotificationEventCode, entityKey?: string) => {
    commitToastNotifications(resolveNotificationsByEventCodes(toastNotificationsRef.current, [eventCode], entityKey, null, Date.now()));
  }, [commitToastNotifications]);

  const archiveResolvedItems = useCallback(() => commitToastNotifications(archiveResolved(toastNotificationsRef.current)), [commitToastNotifications]);

  const markReadItem = useCallback((id: string) => {
    if (notificationsRef.current.some((item) => item.id === id)) {
      const nowMs = Date.now();
      const next = notificationsRef.current.map((item) => item.id === id ? { ...item, readAt: item.readAt || nowMs } : item);
      notificationsRef.current = next;
      setNotifications(next);
      void markAccountNotificationRead(id, readSettingsBackendUrl()).catch(() => undefined);
      return;
    }
    commitToastNotifications(markRead(toastNotificationsRef.current, id));
  }, [commitToastNotifications]);

  const markAllReadItems = useCallback(() => {
    if (notificationsRef.current.length > 0) {
      const nowMs = Date.now();
      const next = notificationsRef.current.map((item) => ({ ...item, readAt: item.readAt || nowMs }));
      notificationsRef.current = next;
      setNotifications(next);
      void markAllAccountNotificationsRead(readSettingsBackendUrl()).catch(() => undefined);
    }
    commitToastNotifications(markAllRead(toastNotificationsRef.current));
  }, [commitToastNotifications]);

  const dismissPersistedIds = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    const next = notificationsRef.current.filter((item) => !idSet.has(item.id));
    notificationsRef.current = next;
    setNotifications(next);
    ids.forEach((id) => { void dismissAccountNotification(id, readSettingsBackendUrl()).catch(() => undefined); });
  }, []);

  const clearNonCriticalItems = useCallback(() => {
    dismissPersistedIds(notificationsRef.current.filter((item) => item.severity !== 'critical').map((item) => item.id));
    commitToastNotifications(clearNonCritical(toastNotificationsRef.current));
  }, [commitToastNotifications, dismissPersistedIds]);

  const clearReadItems = useCallback(() => {
    dismissPersistedIds(notificationsRef.current.filter((item) => Boolean(item.readAt)).map((item) => item.id));
    commitToastNotifications(clearReadNotifications(toastNotificationsRef.current));
  }, [commitToastNotifications, dismissPersistedIds]);

  const clearByIdsItems = useCallback((ids: string[]) => {
    dismissPersistedIds(notificationsRef.current.filter((item) => ids.includes(item.id)).map((item) => item.id));
    commitToastNotifications(clearNotificationsByIds(toastNotificationsRef.current, ids));
  }, [commitToastNotifications, dismissPersistedIds]);

  const clearAllItems = useCallback(() => {
    if (notificationsRef.current.length > 0) {
      notificationsRef.current = [];
      setNotifications([]);
      void dismissAllAccountNotifications(readSettingsBackendUrl()).catch(() => undefined);
    }
    commitToastNotifications([]);
  }, [commitToastNotifications]);

  const removeItem = useCallback((id: string) => {
    if (notificationsRef.current.some((item) => item.id === id)) {
      dismissPersistedIds([id]);
      return;
    }
    commitToastNotifications(removeNotification(toastNotificationsRef.current, id));
  }, [commitToastNotifications, dismissPersistedIds]);

  const hideToast = useCallback((id: string) => {
    commitToastNotifications(toastNotificationsRef.current.map((item) => item.id === id ? { ...item, toastVisible: false } : item));
  }, [commitToastNotifications]);

  const setPrefs = useCallback<React.Dispatch<React.SetStateAction<NotificationPrefs>>>((value) => {
    let patch: Partial<Pick<NotificationPrefs, 'emailAsyncJobs' | 'emailBilling' | 'emailSupport' | 'emailAdminAlerts'>> | null = null;
    setPrefsState((prev) => {
      const next = coerceNotificationPrefs(typeof value === 'function' ? value(prev) : value);
      const candidate: typeof patch = {};
      if (prev.emailAsyncJobs !== next.emailAsyncJobs) candidate.emailAsyncJobs = next.emailAsyncJobs;
      if (prev.emailBilling !== next.emailBilling) candidate.emailBilling = next.emailBilling;
      if (prev.emailSupport !== next.emailSupport) candidate.emailSupport = next.emailSupport;
      if (prev.emailAdminAlerts !== next.emailAdminAlerts) candidate.emailAdminAlerts = next.emailAdminAlerts;
      patch = Object.keys(candidate).length > 0 ? candidate : null;
      return next;
    });
    if (patch && hasSessionIdentity) {
      void patchNotificationPreferences(patch, readSettingsBackendUrl()).then((remote) => {
        setPrefsState((prev) => coerceNotificationPrefs({ ...prev, ...remote }));
      }).catch(() => undefined);
    }
  }, [hasSessionIdentity]);

  useEffect(() => {
    const onOffline = () => { emit('connectivity.offline', { action: { label: 'Reload', onClick: () => window.location.reload() } }, { cooldownMs: 15_000 }); };
    const onOnline = () => { emit('connectivity.online', {}, { cooldownMs: 8_000 }); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [emit]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.readAt && item.status === 'active').length, [notifications]);
  const value = useMemo<NotificationsContextValue>(() => ({
    notifications,
    toastNotifications,
    unreadCount,
    prefs: prefsState,
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
    runAction,
  }), [archiveResolvedItems, clearAllItems, clearByIdsItems, clearNonCriticalItems, clearReadItems, emit, hideToast, isCenterOpen, markAllReadItems, markReadItem, notifications, notify, notifyCritical, notifyError, notifyInfo, notifySuccess, notifyWarning, prefsState, removeItem, resolveByEvent, runAction, setPrefs, toastNotifications, unreadCount]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsContextValue => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};
