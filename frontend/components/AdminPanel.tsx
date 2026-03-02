import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Key, Loader2, RefreshCw, Shield, Ticket, UserCog, Users } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { useAdminCoupons } from '../src/features/admin/hooks/useAdminCoupons';
import { useAdminUsers } from '../src/features/admin/hooks/useAdminUsers';
import {
  type AdminPermission,
  type AdminRoleAssignment,
  type AdminRoleCatalogPayload,
  type AdminUserSummary,
  type AlertDestination,
  type AlertEvent,
  type AlertPolicy,
  type AuditEvent,
  type AuditVerifyPayload,
  type CouponAnalyticsPoint,
  type CouponAnalyticsSummary,
  type DailyUsageResetStatusPayload,
  type DailyUsageResetSummary,
  disableAdminRbacUser,
  enableAdminRbacUser,
  fetchAdminAuditEvents,
  fetchAdminIntegrationsUsage,
  fetchAdminRbacRoles,
  fetchAdminRbacUsers,
  fetchAdminTtsGatewayStatus,
  fetchAdminTtsQueueMetrics,
  fetchAlertDestinations,
  fetchAlertEvents,
  fetchAlertPolicies,
  fetchCouponAnalyticsImpact,
  fetchCouponAnalyticsSummary,
  fetchCouponAnalyticsTimeseries,
  fetchDailyUsageResetStatus,
  fetchGeminiPoolStatus,
  type GeminiPoolStatusPayload,
  patchAlertDestination,
  patchAlertPolicy,
  assignAdminRbacUser,
  createAlertDestination,
  createAlertPolicy,
  reloadGeminiPool,
  resetDailyUsageAll,
  ackAlertEvent,
  resolveAlertEvent,
  runOpsGuardianAction,
  fetchOpsGuardianApprovals,
  fetchOpsGuardianStatus,
  type OpsGuardianApprovalsPayload,
  type OpsGuardianStatusPayload,
  fetchSchedulerRuns,
  fetchSchedulerTasks,
  createSchedulerTask,
  patchSchedulerTask,
  runSchedulerTask,
  type ScheduledTask,
  type ScheduledTaskRun,
  verifyAdminAuditChain,
} from '../services/adminService';
import { sanitizeUiText } from '../src/shared/ui/terminology';

type ToastKind = 'success' | 'error' | 'info';
type OpsTab = 'usage' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics';
type CouponKind = 'wallet_credit' | 'subscription_discount';
type CouponPolicy = 'single_global' | 'single_per_user' | 'max_redemptions';
type RbacDraft = { role: string; status: string };
type CouponPlanDraftRow = {
  id: string;
  plan: string;
  percentOff: string;
  amountOffInr: string;
};

interface AdminPanelProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: ToastKind) => void;
  onRefreshEntitlements: () => Promise<void>;
}

const planOptions = ['Free', 'Pro', 'Plus'] as const;
type AdminUserPatch = Parameters<ReturnType<typeof useAdminUsers>['patchAdminUser']>[1];
type AdminUserDraft = Partial<Pick<AdminUserPatch, 'plan' | 'disabled' | 'paidVfDelta' | 'vffDelta'>>;
const createCouponPlanDraftRow = (plan = '', percentOff = '20', amountOffInr = '100'): CouponPlanDraftRow => ({
  id: `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  plan,
  percentOff,
  amountOffInr,
});

const allPermissions: AdminPermission[] = [
  'users.read',
  'users.write',
  'coupons.read',
  'coupons.write',
  'billing.read',
  'billing.write',
  'ops.read',
  'ops.mutate',
  'guardian.read',
  'guardian.mutate',
  'analytics.read',
  'audit.read',
  'alerts.read',
  'alerts.write',
  'scheduler.read',
  'scheduler.write',
  'rbac.read',
  'rbac.write',
];

const toDateInput = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const asNumber = (value: unknown): number => {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
};

const isForbiddenError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  return Number((error as { status?: number }).status || 0) === 403;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && typeof (error as { message?: string }).message === 'string') {
    return sanitizeUiText(String((error as { message: string }).message));
  }
  return sanitizeUiText(fallback);
};

const formatDate = (value?: string | null): string => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
};

const toPercentLabel = (value: unknown): string => `${(Math.max(0, asNumber(value)) * 100).toFixed(1)}%`;

const normalizeType = (couponType?: string): CouponKind =>
  String(couponType || '').toLowerCase() === 'subscription_discount' ? 'subscription_discount' : 'wallet_credit';

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ mediaBackendUrl, onToast, onRefreshEntitlements }) => {
  const { user } = useUser();
  const {
    sortedUsers,
    isLoadingUsers,
    reloadUsers,
    patchAdminUser,
    resetAdminUserPassword,
    revokeAdminUserSessions,
    deleteAdminUser,
  } = useAdminUsers({ baseUrl: mediaBackendUrl });
  const {
    coupons,
    isLoadingCoupons,
    reloadCoupons,
    createAdminCoupon,
    generateAdminCouponCode,
    patchAdminCoupon,
  } = useAdminCoupons({ baseUrl: mediaBackendUrl });
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState('');
  const [userDrafts, setUserDrafts] = useState<Record<string, AdminUserDraft>>({});
  const [couponTab, setCouponTab] = useState<CouponKind>('wallet_credit');
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponCredit, setNewCouponCredit] = useState('1000');
  const [newCouponPolicy, setNewCouponPolicy] = useState<CouponPolicy>('single_per_user');
  const [newCouponUsageLimit, setNewCouponUsageLimit] = useState('1');
  const [newCouponExpiry, setNewCouponExpiry] = useState('');
  const [newCouponNote, setNewCouponNote] = useState('');
  const [newCouponDiscountType, setNewCouponDiscountType] = useState<'percent' | 'fixed_inr'>('percent');
  const [couponPlanRows, setCouponPlanRows] = useState<CouponPlanDraftRow[]>(() => [
    createCouponPlanDraftRow('pro', '20', '100'),
    createCouponPlanDraftRow('plus', '25', '150'),
  ]);

  const [rbacCatalog, setRbacCatalog] = useState<AdminRoleCatalogPayload | null>(null);
  const [rbacAssignments, setRbacAssignments] = useState<AdminRoleAssignment[]>([]);
  const [rbacDrafts, setRbacDrafts] = useState<Record<string, RbacDraft>>({});
  const [rbacSearch, setRbacSearch] = useState('');
  const [isLoadingRbac, setIsLoadingRbac] = useState(false);

  const [geminiPoolStatus, setGeminiPoolStatus] = useState<GeminiPoolStatusPayload | null>(null);
  const [isLoadingGeminiPool, setIsLoadingGeminiPool] = useState(false);
  const [isReloadingGeminiPool, setIsReloadingGeminiPool] = useState(false);

  const [dailyUsageResetStatus, setDailyUsageResetStatus] = useState<DailyUsageResetStatusPayload | null>(null);
  const [lastDailyDryRun, setLastDailyDryRun] = useState<DailyUsageResetSummary | null>(null);
  const [isLoadingDailyResetStatus, setIsLoadingDailyResetStatus] = useState(false);
  const [isDryRunningDailyReset, setIsDryRunningDailyReset] = useState(false);
  const [isExecutingDailyReset, setIsExecutingDailyReset] = useState(false);

  const [opsTab, setOpsTab] = useState<OpsTab>('usage');
  const [opsUsage, setOpsUsage] = useState<Record<string, unknown> | null>(null);
  const [opsGuardian, setOpsGuardian] = useState<OpsGuardianStatusPayload | null>(null);
  const [opsApprovals, setOpsApprovals] = useState<OpsGuardianApprovalsPayload | null>(null);
  const [opsGateway, setOpsGateway] = useState<Record<string, unknown> | null>(null);
  const [opsQueue, setOpsQueue] = useState<Record<string, unknown> | null>(null);
  const [isLoadingOps, setIsLoadingOps] = useState(false);

  const [alertPolicies, setAlertPolicies] = useState<AlertPolicy[]>([]);
  const [alertDestinations, setAlertDestinations] = useState<AlertDestination[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [newAlertName, setNewAlertName] = useState('');
  const [newAlertMetricKey, setNewAlertMetricKey] = useState('queue_depth');
  const [newAlertOperator, setNewAlertOperator] = useState('gte');
  const [newAlertThreshold, setNewAlertThreshold] = useState('100');
  const [newAlertWindowSec, setNewAlertWindowSec] = useState('60');
  const [newAlertCooldownSec, setNewAlertCooldownSec] = useState('300');
  const [newAlertSeverity, setNewAlertSeverity] = useState('warning');
  const [newAlertUseWebhook, setNewAlertUseWebhook] = useState(false);
  const [newDestinationName, setNewDestinationName] = useState('');
  const [newDestinationUrl, setNewDestinationUrl] = useState('');
  const [newDestinationSecretRef, setNewDestinationSecretRef] = useState('');

  const [schedulerTasks, setSchedulerTasks] = useState<ScheduledTask[]>([]);
  const [schedulerRuns, setSchedulerRuns] = useState<ScheduledTaskRun[]>([]);
  const [isLoadingScheduler, setIsLoadingScheduler] = useState(false);
  const [newTaskType, setNewTaskType] = useState('usage_reset_daily');
  const [newTaskCron, setNewTaskCron] = useState('0 2 * * *');
  const [newTaskTimezone, setNewTaskTimezone] = useState('Asia/Kolkata');
  const [newTaskDryRun, setNewTaskDryRun] = useState(true);
  const [newTaskEnabled, setNewTaskEnabled] = useState(true);
  const [newTaskConcurrencyPolicy, setNewTaskConcurrencyPolicy] = useState<'forbid' | 'replace' | 'allow'>('forbid');

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditVerify, setAuditVerify] = useState<AuditVerifyPayload | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditActorUid, setAuditActorUid] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditResourceType, setAuditResourceType] = useState('');

  const now = new Date();
  const [analyticsFrom, setAnalyticsFrom] = useState(toDateInput(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)));
  const [analyticsTo, setAnalyticsTo] = useState(toDateInput(now));
  const [analyticsPlan, setAnalyticsPlan] = useState('');
  const [analyticsCouponKind, setAnalyticsCouponKind] = useState('');
  const [analyticsImpactCode, setAnalyticsImpactCode] = useState('');
  const [analyticsSummary, setAnalyticsSummary] = useState<CouponAnalyticsSummary | null>(null);
  const [analyticsSeries, setAnalyticsSeries] = useState<CouponAnalyticsPoint[]>([]);
  const [analyticsImpact, setAnalyticsImpact] = useState<{
    couponCode: string;
    overall: CouponAnalyticsSummary;
    byPlan: CouponAnalyticsPoint[];
  } | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  const notifyError = (error: unknown, fallback: string) => {
    if (isForbiddenError(error)) return;
    onToast(sanitizeUiText(getErrorMessage(error, fallback)), 'error');
  };

  const hydrateGeneratedCouponCode = async () => {
    try {
      const code = await generateAdminCouponCode({ length: 12 });
      const normalized = String(code || '').trim().toUpperCase();
      if (normalized) setNewCouponCode(normalized);
      return normalized;
    } catch (error: unknown) {
      notifyError(error, 'Failed to generate coupon code.');
      return '';
    }
  };

  const reloadUsersSafely = async (query = search) => {
    try {
      await reloadUsers(query, 120);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load admin users.');
    }
  };

  const reloadCouponsSafely = async () => {
    try {
      await reloadCoupons(200);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load coupons.');
    }
  };

  const reloadRbacSafely = async (query = rbacSearch) => {
    setIsLoadingRbac(true);
    try {
      const [catalog, usersPayload] = await Promise.all([
        fetchAdminRbacRoles(mediaBackendUrl),
        fetchAdminRbacUsers(mediaBackendUrl, { limit: 200, ...(query.trim() ? { q: query.trim() } : {}) }),
      ]);
      setRbacCatalog(catalog);
      setRbacAssignments(usersPayload.items || []);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load access control.');
    } finally {
      setIsLoadingRbac(false);
    }
  };

  const reloadOpsSafely = async () => {
    setIsLoadingOps(true);
    try {
      const [usage, guardian, approvals, gateway, queue] = await Promise.allSettled([
        fetchAdminIntegrationsUsage(mediaBackendUrl),
        fetchOpsGuardianStatus(mediaBackendUrl, true),
        fetchOpsGuardianApprovals(mediaBackendUrl, 'pending'),
        fetchAdminTtsGatewayStatus(mediaBackendUrl),
        fetchAdminTtsQueueMetrics(mediaBackendUrl),
      ]);
      if (usage.status === 'fulfilled') setOpsUsage(usage.value as unknown as Record<string, unknown>);
      if (guardian.status === 'fulfilled') setOpsGuardian(guardian.value);
      if (approvals.status === 'fulfilled') setOpsApprovals(approvals.value);
      if (gateway.status === 'fulfilled') setOpsGateway(gateway.value as Record<string, unknown>);
      if (queue.status === 'fulfilled') setOpsQueue(queue.value as Record<string, unknown>);
      const failures = [usage, guardian, approvals, gateway, queue].filter(
        (result) => result.status === 'rejected'
      ) as PromiseRejectedResult[];
      if (failures.length > 0) {
        const fallback = failures.length === 5
          ? 'Failed to load ops telemetry.'
          : `Some ops telemetry endpoints failed (${failures.length}/5).`;
        notifyError(failures[0]?.reason, fallback);
      }
    } catch (error: unknown) {
      notifyError(error, 'Failed to load ops telemetry.');
    } finally {
      setIsLoadingOps(false);
    }
  };

  const reloadAlertsSafely = async () => {
    setIsLoadingAlerts(true);
    try {
      const [policies, destinations, events] = await Promise.all([
        fetchAlertPolicies(mediaBackendUrl, 200),
        fetchAlertDestinations(mediaBackendUrl, 200),
        fetchAlertEvents(mediaBackendUrl, { limit: 200 }),
      ]);
      setAlertPolicies(policies);
      setAlertDestinations(destinations);
      setAlertEvents(events);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load alerts.');
    } finally {
      setIsLoadingAlerts(false);
    }
  };

  const reloadSchedulerSafely = async () => {
    setIsLoadingScheduler(true);
    try {
      const [tasks, runs] = await Promise.all([
        fetchSchedulerTasks(mediaBackendUrl, 200),
        fetchSchedulerRuns(mediaBackendUrl, { limit: 200 }),
      ]);
      setSchedulerTasks(tasks);
      setSchedulerRuns(runs);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load scheduler.');
    } finally {
      setIsLoadingScheduler(false);
    }
  };

  const reloadAuditSafely = async () => {
    setIsLoadingAudit(true);
    try {
      const options: {
        actorUid?: string;
        action?: string;
        resourceType?: string;
        limit: number;
      } = { limit: 200 };
      const actorUid = auditActorUid.trim();
      const action = auditAction.trim();
      const resourceType = auditResourceType.trim();
      if (actorUid) options.actorUid = actorUid;
      if (action) options.action = action;
      if (resourceType) options.resourceType = resourceType;
      const payload = await fetchAdminAuditEvents(mediaBackendUrl, options);
      setAuditEvents(payload.items || []);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load audit events.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const reloadAnalyticsSafely = async () => {
    setIsLoadingAnalytics(true);
    try {
      const filters: { from: string; to: string; plan?: string; couponKind?: string } = {
        from: analyticsFrom,
        to: analyticsTo,
      };
      if (analyticsPlan) filters.plan = analyticsPlan;
      if (analyticsCouponKind) filters.couponKind = analyticsCouponKind;
      const [summaryPayload, seriesPayload] = await Promise.all([
        fetchCouponAnalyticsSummary(mediaBackendUrl, filters),
        fetchCouponAnalyticsTimeseries(mediaBackendUrl, {
          ...filters,
          groupBy: 'day',
        }),
      ]);
      setAnalyticsSummary(summaryPayload.summary);
      setAnalyticsSeries(seriesPayload.series || []);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load coupon analytics.');
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const reloadGeminiPoolStatusSafely = async () => {
    setIsLoadingGeminiPool(true);
    try {
      const payload = await fetchGeminiPoolStatus(mediaBackendUrl);
      setGeminiPoolStatus(payload);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load primary AI pool status.');
    } finally {
      setIsLoadingGeminiPool(false);
    }
  };

  const handleReloadGeminiPool = async () => {
    setIsReloadingGeminiPool(true);
    try {
      const payload = await reloadGeminiPool(mediaBackendUrl);
      setGeminiPoolStatus(payload);
      onToast(sanitizeUiText(payload?.detail || 'Primary AI key pool reloaded.'), 'success');
    } catch (error: unknown) {
      notifyError(error, 'Failed to reload primary AI pool.');
    } finally {
      setIsReloadingGeminiPool(false);
    }
  };

  const reloadDailyUsageResetStatusSafely = async () => {
    setIsLoadingDailyResetStatus(true);
    try {
      const payload = await fetchDailyUsageResetStatus(mediaBackendUrl);
      setDailyUsageResetStatus(payload);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load daily reset status.');
    } finally {
      setIsLoadingDailyResetStatus(false);
    }
  };

  const handleDryRunDailyReset = async () => {
    setIsDryRunningDailyReset(true);
    try {
      const summary = await resetDailyUsageAll(mediaBackendUrl, true);
      setLastDailyDryRun(summary);
      onToast(
        `Dry run: ${Number(summary.docsCleared || 0).toLocaleString()} docs, ${Number(summary.usersAffected || 0).toLocaleString()} users.`,
        'info'
      );
    } catch (error: unknown) {
      notifyError(error, 'Daily reset dry run failed.');
    } finally {
      setIsDryRunningDailyReset(false);
    }
  };

  const handleExecuteDailyReset = async () => {
    if (!window.confirm('Reset DAILY usage counters for ALL users now? This does not change monthly usage or wallet balances.')) {
      return;
    }
    setIsExecutingDailyReset(true);
    try {
      const summary = await resetDailyUsageAll(mediaBackendUrl, false);
      await reloadDailyUsageResetStatusSafely();
      await onRefreshEntitlements();
      onToast(
        `Daily usage reset complete: ${Number(summary.docsCleared || 0).toLocaleString()} docs, ${Number(summary.usersAffected || 0).toLocaleString()} users.`,
        'success'
      );
    } catch (error: unknown) {
      notifyError(error, 'Daily usage reset failed.');
    } finally {
      setIsExecutingDailyReset(false);
    }
  };

  useEffect(() => {
    void reloadUsersSafely('');
    void reloadCouponsSafely();
    void reloadRbacSafely('');
    void reloadGeminiPoolStatusSafely();
    void reloadDailyUsageResetStatusSafely();
    void reloadOpsSafely();
    void reloadAlertsSafely();
    void reloadSchedulerSafely();
    void reloadAuditSafely();
    void reloadAnalyticsSafely();
    void hydrateGeneratedCouponCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaBackendUrl]);

  const withSaving = async (key: string, action: () => Promise<void>) => {
    setIsSaving(key);
    try {
      await action();
    } finally {
      setIsSaving('');
    }
  };

  const currentActorAssignment = useMemo(() => {
    const uid = String(user?.uid || '').trim();
    if (!uid) return null;
    return rbacAssignments.find((item) => String(item.uid || '').trim() === uid) || null;
  }, [rbacAssignments, user?.uid]);

  const currentPermissions = useMemo(() => {
    const fallbackRole = user?.isAdmin ? 'super_admin' : 'read_only_ops';
    const role = String(currentActorAssignment?.role || fallbackRole);
    const next = new Set<AdminPermission>();
    const matrix = rbacCatalog?.matrix || {};
    const rolePerms = matrix[role];
    if (Array.isArray(rolePerms)) {
      for (const permission of rolePerms) next.add(permission as AdminPermission);
    } else if (role === 'super_admin') {
      for (const permission of rbacCatalog?.permissions || allPermissions) {
        next.add(permission as AdminPermission);
      }
    }
    for (const permission of currentActorAssignment?.allowOverrides || []) next.add(permission as AdminPermission);
    for (const permission of currentActorAssignment?.denyOverrides || []) next.delete(permission as AdminPermission);
    if (String(currentActorAssignment?.status || '').toLowerCase() === 'disabled') {
      next.clear();
    }
    return next;
  }, [currentActorAssignment, rbacCatalog, user?.isAdmin]);

  const can = (permission: AdminPermission): boolean => {
    if (!rbacCatalog) return Boolean(user?.isAdmin);
    const actorRole = String(currentActorAssignment?.role || (user?.isAdmin ? 'super_admin' : 'read_only_ops'));
    if (actorRole === 'super_admin') return true;
    return currentPermissions.has(permission);
  };

  const canUsersRead = can('users.read');
  const canUsersWrite = can('users.write');
  const canCouponsRead = can('coupons.read');
  const canCouponsWrite = can('coupons.write');
  const canRbacRead = can('rbac.read');
  const canRbacWrite = can('rbac.write');
  const canOpsRead = can('ops.read');
  const canOpsMutate = can('ops.mutate');
  const canGuardianRead = can('guardian.read');
  const canGuardianMutate = can('guardian.mutate');
  const canAlertsRead = can('alerts.read');
  const canAlertsWrite = can('alerts.write');
  const canSchedulerRead = can('scheduler.read');
  const canSchedulerWrite = can('scheduler.write');
  const canAuditRead = can('audit.read');
  const canAnalyticsRead = can('analytics.read');
  const sanitizePlanToken = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const updateCouponPlanRow = (rowId: string, patch: Partial<Omit<CouponPlanDraftRow, 'id'>>) => {
    setCouponPlanRows((previous) => previous.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };
  const addCouponPlanRow = (plan = '') => {
    const safePlan = sanitizePlanToken(plan);
    setCouponPlanRows((previous) => {
      if (safePlan && previous.some((row) => sanitizePlanToken(row.plan) === safePlan)) return previous;
      const defaultsByPlan: Record<string, { percentOff: string; amountOffInr: string }> = {
        pro: { percentOff: '20', amountOffInr: '100' },
        plus: { percentOff: '25', amountOffInr: '150' },
      };
      const defaults = defaultsByPlan[safePlan] || { percentOff: '20', amountOffInr: '100' };
      return [...previous, createCouponPlanDraftRow(safePlan || '', defaults.percentOff, defaults.amountOffInr)];
    });
  };
  const removeCouponPlanRow = (rowId: string) => {
    setCouponPlanRows((previous) => {
      if (previous.length <= 1) return previous;
      return previous.filter((row) => row.id !== rowId);
    });
  };

  const handleCreateCoupon = async () => {
    if (!canCouponsWrite) {
      onToast('Missing coupons.write permission.', 'info');
      return;
    }
    let code = newCouponCode.trim().toUpperCase();
    if (!code) {
      code = await hydrateGeneratedCouponCode();
    }
    if (!code) {
      onToast('Coupon code is required.', 'info');
      return;
    }

    const payload: Record<string, unknown> = {
      code,
      couponType: couponTab,
      usagePolicy: newCouponPolicy,
      usageLimit: Math.max(1, Math.floor(Number(newCouponUsageLimit) || 1)),
      expiresAt: newCouponExpiry.trim() ? newCouponExpiry.trim() : undefined,
      note: newCouponNote.trim() ? newCouponNote.trim() : undefined,
      active: true,
    };
    if (couponTab === 'wallet_credit') {
      const creditVf = Math.max(1, Math.floor(Number(newCouponCredit) || 0));
      payload.creditVf = creditVf;
    } else {
      payload.discountType = newCouponDiscountType;
      const planDiscountMap = new Map<string, { plan: string; discountType: 'percent' | 'fixed_inr'; percentOff?: number; amountOffInr?: number }>();
      couponPlanRows.forEach((row) => {
        const safePlan = sanitizePlanToken(row.plan);
        if (!safePlan) return;
        if (newCouponDiscountType === 'percent') {
          const percentOff = Math.max(0.01, Math.min(100, Number(row.percentOff) || 0));
          planDiscountMap.set(safePlan, { plan: safePlan, discountType: 'percent', percentOff });
          return;
        }
        const amountOffInr = Math.max(1, Math.floor(Number(row.amountOffInr) || 0));
        planDiscountMap.set(safePlan, { plan: safePlan, discountType: 'fixed_inr', amountOffInr });
      });
      const planDiscounts = Array.from(planDiscountMap.values());
      if (!planDiscounts.length) {
        onToast('Select at least one plan and discount.', 'info');
        return;
      }
      payload.appliesToPlans = planDiscounts.map((entry) => entry.plan);
      payload.planDiscounts = planDiscounts;
      const primaryPlanDiscount = planDiscounts.find((entry) => entry.plan === 'pro') || planDiscounts[0];
      if (!primaryPlanDiscount) {
        onToast('Add at least one plan discount.', 'info');
        return;
      }
      if (primaryPlanDiscount.discountType === 'percent') {
        payload.percentOff = Number(primaryPlanDiscount.percentOff || 0);
      } else {
        payload.amountOffInr = Math.max(1, Math.floor(Number(primaryPlanDiscount.amountOffInr || 0)));
      }
    }

    await withSaving('coupon_create', async () => {
      await createAdminCoupon(payload as Parameters<typeof createAdminCoupon>[0]);
      setNewCouponExpiry('');
      setNewCouponNote('');
      onToast('Coupon created.', 'success');
      await reloadCouponsSafely();
      await hydrateGeneratedCouponCode();
    });
  };

  const setUserDraft = (uid: string, updater: (previous: AdminUserDraft) => AdminUserDraft) => {
    setUserDrafts((previous) => {
      const nextDraft = updater(previous[uid] || {});
      const normalized: AdminUserDraft = {};
      if (nextDraft.plan) normalized.plan = nextDraft.plan;
      if (typeof nextDraft.disabled === 'boolean') normalized.disabled = nextDraft.disabled;
      const paidDelta = Math.trunc(Number(nextDraft.paidVfDelta || 0));
      const vffDelta = Math.trunc(Number(nextDraft.vffDelta || 0));
      if (paidDelta !== 0) normalized.paidVfDelta = paidDelta;
      if (vffDelta !== 0) normalized.vffDelta = vffDelta;
      if (Object.keys(normalized).length === 0) {
        if (!previous[uid]) return previous;
        const next = { ...previous };
        delete next[uid];
        return next;
      }
      return { ...previous, [uid]: normalized };
    });
  };

  const setRbacDraft = (uid: string, updater: (previous: RbacDraft) => RbacDraft) => {
    setRbacDrafts((previous) => {
      const existing = rbacAssignments.find((entry) => entry.uid === uid);
      const current = previous[uid] || {
        role: String(existing?.role || 'support_ops'),
        status: String(existing?.status || 'active'),
      };
      return { ...previous, [uid]: updater(current) };
    });
  };

  const getPendingUserPatch = (row: AdminUserSummary): AdminUserPatch | null => {
    const draft = userDrafts[row.uid];
    if (!draft) return null;
    const patch: AdminUserPatch = {};
    if (draft.plan && draft.plan !== row.plan) patch.plan = draft.plan;
    if (typeof draft.disabled === 'boolean' && draft.disabled !== row.disabled) patch.disabled = draft.disabled;
    const paidDelta = Math.trunc(Number(draft.paidVfDelta || 0));
    const vffDelta = Math.trunc(Number(draft.vffDelta || 0));
    if (paidDelta !== 0) patch.paidVfDelta = paidDelta;
    if (vffDelta !== 0) patch.vffDelta = vffDelta;
    return Object.keys(patch).length > 0 ? patch : null;
  };

  const dirtyUserUpdates = sortedUsers.reduce<Array<{ uid: string; patch: AdminUserPatch }>>((acc, row) => {
    const patch = getPendingUserPatch(row);
    if (patch) acc.push({ uid: row.uid, patch });
    return acc;
  }, []);

  const removeUserDrafts = (uids: string[]) => {
    setUserDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const uid of uids) {
        if (uid in next) {
          delete next[uid];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  };

  const handleSaveUser = async (row: AdminUserSummary) => {
    const patch = getPendingUserPatch(row);
    if (!patch) {
      onToast('No changes to save for this user.', 'info');
      return;
    }
    try {
      await withSaving(`save_user_${row.uid}`, async () => {
        await patchAdminUser(row.uid, patch);
        removeUserDrafts([row.uid]);
        await reloadUsersSafely(search);
        await onRefreshEntitlements();
        onToast(`Saved ${row.email || row.uid}.`, 'success');
      });
    } catch (error: unknown) {
      notifyError(error, 'Failed to save user.');
    }
  };

  const handleSaveAllUsers = async () => {
    if (dirtyUserUpdates.length === 0) {
      onToast('No user changes to save.', 'info');
      return;
    }
    try {
      await withSaving('save_all_users', async () => {
        for (const update of dirtyUserUpdates) {
          await patchAdminUser(update.uid, update.patch);
        }
        removeUserDrafts(dirtyUserUpdates.map((update) => update.uid));
        await reloadUsersSafely(search);
        await onRefreshEntitlements();
        onToast(`Saved ${dirtyUserUpdates.length} user${dirtyUserUpdates.length === 1 ? '' : 's'}.`, 'success');
      });
    } catch (error: unknown) {
      notifyError(error, 'Failed to save all users.');
    }
  };

  const filteredCoupons = useMemo(
    () => coupons.filter((coupon) => normalizeType(coupon.couponType) === couponTab),
    [coupons, couponTab]
  );
  const backendPool = geminiPoolStatus?.backend?.pool || {};
  const runtimePool = geminiPoolStatus?.runtime?.pool || {};
  const sourceDiag = geminiPoolStatus?.backend?.source || {};
  const lastRun = dailyUsageResetStatus?.lastRun;

  const handleExportAuditCsv = () => {
    if (!auditEvents.length) {
      onToast('No audit rows to export.', 'info');
      return;
    }
    const headers = ['sequence', 'eventId', 'ts', 'actorUid', 'actorRole', 'action', 'resourceType', 'resourceId'];
    const rows = auditEvents.map((item) => [
      item.sequence,
      item.eventId,
      item.ts,
      item.actorUid,
      item.actorRole || '',
      item.action,
      item.resourceType,
      item.resourceId,
    ]);
    const lines = [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `admin-audit-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Shield size={16} className="text-indigo-600" />
            Admin Control Plane
          </div>
          <button
            onClick={() => {
              void reloadUsersSafely(search);
              void reloadRbacSafely(rbacSearch);
              void reloadCouponsSafely();
              void reloadGeminiPoolStatusSafely();
              void reloadDailyUsageResetStatusSafely();
              void reloadOpsSafely();
              void reloadAlertsSafely();
              void reloadSchedulerSafely();
              void reloadAuditSafely();
              void reloadAnalyticsSafely();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={13} />
            Refresh All
          </button>
        </div>
        <p className="text-xs text-gray-500">Priority order: Users, Access Control, Coupons, Primary AI Pool, Ops.</p>
      </section>

      <section className="hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <UserCog size={16} className="text-indigo-600" />
            Access Control
          </div>
          <div className="flex items-center gap-2">
            <input
              value={rbacSearch}
              onChange={(event) => setRbacSearch(event.target.value)}
              placeholder="Search operator uid"
              className="h-9 w-44 rounded-lg border border-gray-200 px-2.5 text-xs"
            />
            <button
              onClick={() => {
                void reloadRbacSafely(rbacSearch);
              }}
              className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700"
            >
              Refresh
            </button>
          </div>
        </div>
        {!canRbacRead ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            Missing `rbac.read` permission.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1 text-xs font-semibold text-gray-800">Role matrix</div>
              <div className="grid gap-2 md:grid-cols-2">
                {(rbacCatalog?.roles || []).map((roleName) => (
                  <div key={roleName} className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="font-semibold text-gray-800">{roleName}</div>
                    <div className="mt-1 text-[10px] text-gray-600">
                      {(rbacCatalog?.matrix?.[roleName] || []).join(', ') || '-'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left">UID</th>
                    <th className="px-2 py-2 text-left">Role</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingRbac && (
                    <tr>
                      <td colSpan={4} className="px-2 py-4 text-center">
                        <Loader2 size={14} className="mx-auto animate-spin" />
                      </td>
                    </tr>
                  )}
                  {!isLoadingRbac && rbacAssignments.map((assignment) => {
                    const draft = rbacDrafts[assignment.uid] || {
                      role: String(assignment.role || 'support_ops'),
                      status: String(assignment.status || 'active'),
                    };
                    return (
                      <tr key={assignment.uid} className="border-t border-gray-100">
                        <td className="px-2 py-2">
                          <div className="font-semibold text-gray-800">{assignment.uid}</div>
                          <div className="text-[10px] text-gray-500">v{Number(assignment.version || 0)}</div>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={draft.role}
                            onChange={(event) => setRbacDraft(assignment.uid, (previous) => ({ ...previous, role: event.target.value }))}
                            disabled={!canRbacWrite}
                            className="h-8 rounded border border-gray-200 px-2 text-xs"
                          >
                            {(rbacCatalog?.roles || []).map((roleName) => (
                              <option key={roleName} value={roleName}>{roleName}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={draft.status}
                            onChange={(event) => setRbacDraft(assignment.uid, (previous) => ({ ...previous, status: event.target.value }))}
                            disabled={!canRbacWrite}
                            className="h-8 rounded border border-gray-200 px-2 text-xs"
                          >
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          {!canRbacWrite ? (
                            <span className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500">read-only</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <button
                                onClick={() => {
                                  void withSaving(`rbac_save_${assignment.uid}`, async () => {
                                    await assignAdminRbacUser(assignment.uid, { role: draft.role, status: draft.status }, mediaBackendUrl);
                                    await reloadRbacSafely(rbacSearch);
                                    onToast('Role updated.', 'success');
                                  });
                                }}
                                className="rounded border border-indigo-200 px-2 py-1 text-[10px] font-semibold text-indigo-700"
                              >
                                Save
                              </button>
                              {String(assignment.status || '').toLowerCase() === 'disabled' ? (
                                <button
                                  onClick={() => {
                                    const note = window.prompt('Enable note (optional)') || '';
                                    void withSaving(`rbac_enable_${assignment.uid}`, async () => {
                                      await enableAdminRbacUser(assignment.uid, note, mediaBackendUrl);
                                      await reloadRbacSafely(rbacSearch);
                                    });
                                  }}
                                  className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700"
                                >
                                  Enable
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    const note = window.prompt('Disable note (optional)') || '';
                                    void withSaving(`rbac_disable_${assignment.uid}`, async () => {
                                      await disableAdminRbacUser(assignment.uid, note, mediaBackendUrl);
                                      await reloadRbacSafely(rbacSearch);
                                    });
                                  }}
                                  className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700"
                                >
                                  Disable
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <RefreshCw size={16} className="text-indigo-600" />
            Daily Usage Reset
          </div>
          <div className="inline-flex items-center gap-2">
            <button
              onClick={() => {
                void handleDryRunDailyReset();
              }}
              disabled={isDryRunningDailyReset}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {isDryRunningDailyReset ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Dry Run
            </button>
            <button
              onClick={() => {
                void handleExecuteDailyReset();
              }}
              disabled={isExecutingDailyReset}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {isExecutingDailyReset ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Reset All Daily Usage
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Resets only daily usage counters for all users. Wallet balances and monthly usage remain unchanged.
        </p>
        {isLoadingDailyResetStatus && (
          <div className="text-xs text-gray-500 inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Loading reset status...
          </div>
        )}
        {!isLoadingDailyResetStatus && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-gray-800">Last executed reset</div>
              {lastRun ? (
                <div className="space-y-1 text-gray-600">
                  <div>Docs cleared: <strong>{Number(lastRun.docsCleared || 0).toLocaleString()}</strong></div>
                  <div>Users affected: <strong>{Number(lastRun.usersAffected || 0).toLocaleString()}</strong></div>
                  <div>Day: <strong>{String(lastRun.periodKey || '-')}</strong></div>
                  <div>Ran at: <strong>{lastRun.ranAt ? new Date(lastRun.ranAt).toLocaleString() : '-'}</strong></div>
                </div>
              ) : (
                <div className="text-gray-500">Never run.</div>
              )}
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-gray-800">Latest dry run</div>
              {lastDailyDryRun ? (
                <div className="space-y-1 text-gray-600">
                  <div>Docs matched: <strong>{Number(lastDailyDryRun.docsCleared || 0).toLocaleString()}</strong></div>
                  <div>Users matched: <strong>{Number(lastDailyDryRun.usersAffected || 0).toLocaleString()}</strong></div>
                  <div>Day: <strong>{String(lastDailyDryRun.periodKey || '-')}</strong></div>
                  <div>Generated at: <strong>{lastDailyDryRun.ranAt ? new Date(lastDailyDryRun.ranAt).toLocaleString() : '-'}</strong></div>
                </div>
              ) : (
                <div className="text-gray-500">No dry run yet.</div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Key size={16} className="text-indigo-600" />
            Primary AI Pool
          </div>
          <button
            onClick={() => {
              void handleReloadGeminiPool();
            }}
            disabled={isReloadingGeminiPool}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
          >
            {isReloadingGeminiPool ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Reload Pool
          </button>
        </div>
        {isLoadingGeminiPool && (
          <div className="text-xs text-gray-500 inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" />
            Loading primary AI pool status...
          </div>
        )}
        {!isLoadingGeminiPool && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-2 font-semibold text-gray-800">Backend allocator</div>
              <div className="space-y-1 text-gray-600">
                <div>Keys: <strong>{Number(backendPool.keyCount || 0)}</strong></div>
                <div>Healthy: <strong>{Number(backendPool.healthyKeys || 0)}</strong></div>
                <div>At limit: <strong>{Number(backendPool.atLimitKeys || 0)}</strong></div>
                <div>Unhealthy: <strong>{Number(backendPool.unhealthyKeys || 0)}</strong></div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-2 font-semibold text-gray-800">Cloud runtime</div>
              <div className="space-y-1 text-gray-600">
                <div>Keys: <strong>{Number(runtimePool.keyCount || 0)}</strong></div>
                <div>Healthy: <strong>{Number(runtimePool.healthyKeys || 0)}</strong></div>
                <div>At limit: <strong>{Number(runtimePool.atLimitKeys || 0)}</strong></div>
                <div>Unhealthy: <strong>{Number(runtimePool.unhealthyKeys || 0)}</strong></div>
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs md:col-span-2">
              <div className="mb-2 font-semibold text-gray-800">Key sources</div>
              <div className="grid gap-1 text-gray-600 md:grid-cols-3">
                <div>File exists: <strong>{sourceDiag.fileExists ? 'Yes' : 'No'}</strong></div>
                <div>File keys: <strong>{Number(sourceDiag.fileKeyCount || 0)}</strong></div>
                <div>Env pool keys: <strong>{Number(sourceDiag.envPoolKeyCount || 0)}</strong></div>
              </div>
              <div className="mt-1 truncate text-gray-500">Configured path: {sanitizeUiText(String(sourceDiag.configuredFilePath || '-'))}</div>
              <div className="mt-1 truncate text-gray-500">Resolved path: {sanitizeUiText(String(sourceDiag.filePath || '-'))}</div>
              <div className="mt-1 truncate text-gray-500">Runtime resolved path: {sanitizeUiText(String(geminiPoolStatus?.runtime?.keyFilePath || '-'))}</div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Users size={16} className="text-indigo-600" />
            Users
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search email or uid"
              className="h-9 w-56 rounded-lg border border-gray-200 px-2.5 text-xs outline-none focus:border-indigo-300"
            />
            <button
              onClick={() => {
                void reloadUsersSafely(search);
              }}
              className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Search
            </button>
            <button
              onClick={() => {
                void handleSaveAllUsers();
              }}
              disabled={!canUsersWrite || dirtyUserUpdates.length === 0 || Boolean(isSaving)}
              className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving === 'save_all_users' ? 'Saving...' : `Save all${dirtyUserUpdates.length ? ` (${dirtyUserUpdates.length})` : ''}`}
            </button>
          </div>
        </div>
        {!canUsersRead ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `users.read` permission.</div>
        ) : (
        <div className="max-h-[28rem] overflow-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">User</th>
                <th className="px-2 py-2 text-left">Plan</th>
                <th className="px-2 py-2 text-left">Wallet</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingUsers && (
                <tr>
                  <td className="px-2 py-4 text-center text-gray-500" colSpan={5}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading users
                    </span>
                  </td>
                </tr>
              )}
              {!isLoadingUsers && sortedUsers.length === 0 && (
                <tr>
                  <td className="px-2 py-4 text-center text-gray-500" colSpan={5}>
                    No users found.
                  </td>
                </tr>
              )}
              {!isLoadingUsers &&
                sortedUsers.map((row) => {
                  const rowDraft = userDrafts[row.uid] || {};
                  const pendingPatch = getPendingUserPatch(row);
                  const isRowDirty = Boolean(pendingPatch);
                  const effectivePlan = rowDraft.plan || row.plan;
                  const effectiveDisabled = typeof rowDraft.disabled === 'boolean' ? rowDraft.disabled : row.disabled;
                  const paidDelta = Math.trunc(Number(rowDraft.paidVfDelta || 0));
                  const vffDelta = Math.trunc(Number(rowDraft.vffDelta || 0));
                  const effectivePaidBalance = row.wallet.paidVfBalance + paidDelta;
                  const effectiveVffBalance = row.wallet.vffBalance + vffDelta;
                  const isActiveUser = !effectiveDisabled;
                  const statusBadgeTone = isActiveUser
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-red-200 bg-red-50 text-red-700';
                  const statusDotTone = isActiveUser ? 'bg-emerald-500' : 'bg-red-500';
                  const statusBarTone = isActiveUser ? 'border-emerald-300 bg-emerald-400/80' : 'border-red-300 bg-red-400/80';
                  const isRowSaving = isSaving.includes(row.uid) || (isSaving === 'save_all_users' && isRowDirty);
                  return (
                    <tr key={row.uid} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-2">
                        <div className="font-semibold text-gray-800">Email: {row.email || '-'}</div>
                        <div className="text-[11px] text-gray-500">UID: {row.uid}</div>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="h-8 rounded-md border border-gray-200 px-2 text-xs"
                          value={effectivePlan}
                          onChange={(event) => {
                            const nextPlan = event.target.value;
                            setUserDraft(row.uid, (previous) => {
                              const { plan, ...rest } = previous;
                              return nextPlan === row.plan ? rest : { ...rest, plan: nextPlan };
                            });
                          }}
                          disabled={!canUsersWrite}
                        >
                          {planOptions.map((plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-[11px] text-gray-700">Paid VF: {effectivePaidBalance.toLocaleString()}</div>
                        <div className="text-[11px] text-gray-700">Free VFF: {effectiveVffBalance.toLocaleString()}</div>
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            className="rounded border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                            onClick={() => {
                              setUserDraft(row.uid, (previous) => ({
                                ...previous,
                                paidVfDelta: Number(previous.paidVfDelta || 0) + 1000,
                              }));
                            }}
                            disabled={!canUsersWrite}
                          >
                            +1k paid
                          </button>
                          <button
                            className="rounded border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                            onClick={() => {
                              setUserDraft(row.uid, (previous) => ({
                                ...previous,
                                vffDelta: Number(previous.vffDelta || 0) + 1000,
                              }));
                            }}
                            disabled={!canUsersWrite}
                          >
                            +1k VFF
                          </button>
                        </div>
                        {(paidDelta !== 0 || vffDelta !== 0) && (
                          <div className="mt-1 text-[10px] text-amber-700">
                            Pending: {paidDelta !== 0 ? `${paidDelta > 0 ? '+' : ''}${paidDelta.toLocaleString()} paid` : ''}
                            {paidDelta !== 0 && vffDelta !== 0 ? ', ' : ''}
                            {vffDelta !== 0 ? `${vffDelta > 0 ? '+' : ''}${vffDelta.toLocaleString()} VFF` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeTone}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDotTone}`} />
                          {isActiveUser ? 'Active' : 'Inactive'}
                        </div>
                        <div className={`mt-1 h-1.5 w-16 rounded-full border ${statusBarTone}`} />
                        <div className="mt-1 text-[11px] text-gray-500">{row.admin ? 'Admin' : 'User'}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            onClick={() => {
                              const nextDisabled = !effectiveDisabled;
                              setUserDraft(row.uid, (previous) => {
                                const { disabled, ...rest } = previous;
                                return nextDisabled === row.disabled ? rest : { ...rest, disabled: nextDisabled };
                              });
                            }}
                            className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700"
                            disabled={!canUsersWrite}
                          >
                            {effectiveDisabled ? 'Unlock' : 'Lock'}
                          </button>
                          <button
                            onClick={() => {
                              void handleSaveUser(row);
                            }}
                            disabled={!canUsersWrite || !isRowDirty || Boolean(isSaving)}
                            className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              const password = window.prompt('Set new password (min 8 chars):');
                              if (!password) return;
                              void withSaving(`password_${row.uid}`, async () => {
                                await resetAdminUserPassword(row.uid, password);
                                onToast('Password reset.', 'success');
                              });
                            }}
                            className="rounded border border-blue-200 px-2 py-1 text-[10px] font-semibold text-blue-700"
                            disabled={!canUsersWrite}
                          >
                            Reset pass
                          </button>
                          <button
                            onClick={() => {
                              void withSaving(`revoke_${row.uid}`, async () => {
                                await revokeAdminUserSessions(row.uid);
                                onToast('Sessions revoked.', 'success');
                              });
                            }}
                            className="rounded border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-700"
                            disabled={!canUsersWrite}
                          >
                            Revoke
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm(`Delete ${row.email || row.uid}? This cannot be undone.`)) return;
                              void withSaving(`delete_${row.uid}`, async () => {
                                await deleteAdminUser(row.uid);
                                onToast('User deleted.', 'success');
                                removeUserDrafts([row.uid]);
                                await reloadUsersSafely(search);
                              });
                            }}
                            className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-700"
                            disabled={!canUsersWrite}
                          >
                            Delete
                          </button>
                        </div>
                        {isRowSaving && (
                          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-600">
                            <Loader2 size={11} className="animate-spin" />
                            Saving
                          </div>
                        )}
                        {!isRowSaving && isRowDirty && (
                          <div className="mt-1 text-[10px] text-amber-700">
                            Unsaved changes
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800"><Ticket size={16} className="text-indigo-600" />Coupons</div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
            <button onClick={() => setCouponTab('wallet_credit')} className={`rounded px-2 py-1 text-[11px] font-semibold ${couponTab === 'wallet_credit' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}>Wallet</button>
            <button onClick={() => setCouponTab('subscription_discount')} className={`rounded px-2 py-1 text-[11px] font-semibold ${couponTab === 'subscription_discount' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}>Subscription</button>
          </div>
        </div>
        {!canCouponsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `coupons.read` permission.</div> : (
          <>
            {canCouponsWrite && (
              <div className="grid gap-2">
                <div className="grid grid-cols-3 gap-2">
                  <input value={newCouponCode} onChange={(event) => setNewCouponCode(event.target.value)} placeholder="Code" className="col-span-2 h-9 rounded-lg border border-gray-200 px-2.5 text-xs" />
                  <button onClick={() => { void withSaving('coupon_generate', async () => { await hydrateGeneratedCouponCode(); }); }} className="h-9 rounded-lg border border-gray-200 px-2 text-xs font-semibold text-gray-700">Auto Code</button>
                </div>
                {couponTab === 'wallet_credit' ? (
                  <input value={newCouponCredit} onChange={(event) => setNewCouponCredit(event.target.value)} placeholder="Credit VF" className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs" />
                ) : (
                  <div className="grid gap-2">
                    <select value={newCouponDiscountType} onChange={(event) => setNewCouponDiscountType(event.target.value as 'percent' | 'fixed_inr')} className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs"><option value="percent">Percent</option><option value="fixed_inr">Fixed INR</option></select>
                    <div className="rounded-lg border border-gray-200 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-gray-700">Plan-specific discounts</div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => addCouponPlanRow('pro')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Pro</button>
                          <button type="button" onClick={() => addCouponPlanRow('plus')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Plus</button>
                          <button type="button" onClick={() => addCouponPlanRow()} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">+ Add plan</button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        {couponPlanRows.map((row) => (
                          <div key={row.id} className="grid grid-cols-12 gap-2">
                            <input
                              value={row.plan}
                              onChange={(event) => updateCouponPlanRow(row.id, { plan: event.target.value })}
                              placeholder="Plan key (pro, plus, enterprise)"
                              className="col-span-6 h-9 rounded-lg border border-gray-200 px-2.5 text-xs"
                            />
                            {newCouponDiscountType === 'percent' ? (
                              <input
                                value={row.percentOff}
                                onChange={(event) => updateCouponPlanRow(row.id, { percentOff: event.target.value })}
                                placeholder="% Off"
                                className="col-span-4 h-9 rounded-lg border border-gray-200 px-2.5 text-xs"
                              />
                            ) : (
                              <input
                                value={row.amountOffInr}
                                onChange={(event) => updateCouponPlanRow(row.id, { amountOffInr: event.target.value })}
                                placeholder="INR Off"
                                className="col-span-4 h-9 rounded-lg border border-gray-200 px-2.5 text-xs"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => removeCouponPlanRow(row.id)}
                              className="col-span-2 rounded-lg border border-gray-200 px-2 text-[10px] font-semibold text-gray-600"
                              disabled={couponPlanRows.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <select value={newCouponPolicy} onChange={(event) => setNewCouponPolicy(event.target.value as CouponPolicy)} className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs"><option value="single_global">single_global</option><option value="single_per_user">single_per_user</option><option value="max_redemptions">max_redemptions</option></select>
                  <input value={newCouponUsageLimit} onChange={(event) => setNewCouponUsageLimit(event.target.value)} placeholder="Usage limit" className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs" />
                  <input value={newCouponExpiry} onChange={(event) => setNewCouponExpiry(event.target.value)} placeholder="Expiry ISO (optional)" className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs" />
                </div>
                <input value={newCouponNote} onChange={(event) => setNewCouponNote(event.target.value)} placeholder="Note" className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs" />
                <button onClick={() => { void handleCreateCoupon(); }} className="h-9 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">{isSaving === 'coupon_create' ? <Loader2 size={13} className="mx-auto animate-spin" /> : 'Create Coupon'}</button>
              </div>
            )}
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600"><tr><th className="px-2 py-2 text-left">Code</th><th className="px-2 py-2 text-left">Value</th><th className="px-2 py-2 text-left">Usage</th><th className="px-2 py-2 text-left">Expiry</th><th className="px-2 py-2 text-left">State</th></tr></thead>
                <tbody>
                  {isLoadingCoupons && <tr><td className="px-2 py-3 text-center text-gray-500" colSpan={5}><Loader2 size={14} className="mx-auto animate-spin" /></td></tr>}
                  {!isLoadingCoupons && filteredCoupons.map((coupon) => (
                    <tr key={coupon.id} className="border-t border-gray-100">
                      <td className="px-2 py-2 font-semibold text-gray-800">{coupon.code}</td>
                      <td className="px-2 py-2">
                        {normalizeType(coupon.couponType) === 'wallet_credit'
                          ? `${asNumber(coupon.creditVf).toLocaleString()} VF`
                          : (() => {
                              const planDiscounts = coupon.planDiscounts || {};
                              const planKeys = Object.keys(planDiscounts);
                              if (planKeys.length) {
                                return planKeys
                                  .sort()
                                  .map((plan) => {
                                    const row = planDiscounts[plan] || {};
                                    if (String(row.discountType || coupon.discountType) === 'fixed_inr') {
                                      return `${plan}: INR ${asNumber(row.amountOffInr).toLocaleString()}`;
                                    }
                                    return `${plan}: ${asNumber(row.percentOff)}%`;
                                  })
                                  .join(' | ');
                              }
                              return coupon.discountType === 'fixed_inr'
                                ? `INR ${asNumber(coupon.amountOffInr).toLocaleString()}`
                                : `${asNumber(coupon.percentOff)}%`;
                            })()}
                      </td>
                      <td className="px-2 py-2">{asNumber(coupon.redeemedCount)}{asNumber(coupon.usageLimit || coupon.maxRedemptions) > 0 ? ` / ${asNumber(coupon.usageLimit || coupon.maxRedemptions)}` : ''}</td>
                      <td className="px-2 py-2">{formatDate(coupon.expiresAt)}</td>
                      <td className="px-2 py-2">
                        {canCouponsWrite ? <button onClick={() => { void withSaving(`coupon_toggle_${coupon.id}`, async () => { await patchAdminCoupon(coupon.id, { active: !coupon.active }); await reloadCouponsSafely(); }); }} className={`rounded border px-2 py-1 text-[10px] font-semibold ${coupon.active ? 'border-emerald-200 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>{coupon.active ? 'Active' : 'Inactive'}</button> : <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${coupon.active ? 'border-emerald-200 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>{coupon.active ? 'Active' : 'Inactive'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800"><Key size={16} className="text-indigo-600" />Primary AI Pool</div>
          {canOpsMutate && (
            <button onClick={() => { void handleReloadGeminiPool(); }} disabled={isReloadingGeminiPool} className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-60">
              {isReloadingGeminiPool ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Reload
            </button>
          )}
        </div>
        {!canOpsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `ops.read` permission.</div> : isLoadingGeminiPool ? <div className="text-xs text-gray-500">Loading primary AI pool status...</div> : (
          <div className="grid gap-3 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Backend</div><div>Keys: <strong>{asNumber((backendPool as Record<string, unknown>).keyCount)}</strong></div><div>Healthy: <strong>{asNumber((backendPool as Record<string, unknown>).healthyKeys)}</strong></div><div>At limit: <strong>{asNumber((backendPool as Record<string, unknown>).atLimitKeys)}</strong></div></div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Runtime</div><div>Keys: <strong>{asNumber((runtimePool as Record<string, unknown>).keyCount)}</strong></div><div>Healthy: <strong>{asNumber((runtimePool as Record<string, unknown>).healthyKeys)}</strong></div><div>At limit: <strong>{asNumber((runtimePool as Record<string, unknown>).atLimitKeys)}</strong></div></div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Sources</div><div>File exists: <strong>{(sourceDiag as Record<string, unknown>).fileExists ? 'Yes' : 'No'}</strong></div><div>File keys: <strong>{asNumber((sourceDiag as Record<string, unknown>).fileKeyCount)}</strong></div><div>Env keys: <strong>{asNumber((sourceDiag as Record<string, unknown>).envPoolKeyCount)}</strong></div></div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800"><Activity size={16} className="text-indigo-600" />Ops</div>
          <button onClick={() => { void reloadOpsSafely(); void reloadAlertsSafely(); void reloadSchedulerSafely(); void reloadAuditSafely(); void reloadAnalyticsSafely(); }} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700"><RefreshCw size={13} />Refresh</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ['usage', 'Usage'],
            ['guardian', 'Guardian'],
            ['alerts', 'Alerts'],
            ['scheduler', 'Scheduled Tasks'],
            ['audit', 'Audit Ledger'],
            ['analytics', 'Coupon Analytics'],
          ] as Array<[OpsTab, string]>).map(([tabId, label]) => (
            <button key={tabId} onClick={() => setOpsTab(tabId)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${opsTab === tabId ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>{label}</button>
          ))}
        </div>

        {opsTab === 'usage' && (!canOpsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `ops.read` permission.</div> : (
          <div className="space-y-3 text-xs">
            {isLoadingOps ? <div className="text-gray-500">Loading ops telemetry...</div> : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Requests</div><div className="text-lg font-bold text-gray-900">{asNumber((opsUsage?.windows as Record<string, Record<string, unknown>> | undefined)?.total?.requests).toLocaleString()}</div></div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Queue depth</div><div className="text-lg font-bold text-gray-900">{asNumber((opsQueue?.queue as Record<string, unknown> | undefined)?.depth).toLocaleString()}</div></div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Pending approvals</div><div className="text-lg font-bold text-gray-900">{asNumber(opsApprovals?.count || opsGuardian?.pendingApprovalCount).toLocaleString()}</div></div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Daily reset</div><div>Last run: <strong>{lastRun?.ranAt ? formatDate(lastRun.ranAt) : 'Never'}</strong></div><div>Dry run users: <strong>{asNumber(lastDailyDryRun?.usersAffected).toLocaleString()}</strong></div>{canOpsMutate && <div className="mt-2 flex gap-2"><button onClick={() => { void handleDryRunDailyReset(); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{isDryRunningDailyReset ? 'Running...' : 'Dry Run'}</button><button onClick={() => { void handleExecuteDailyReset(); }} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">{isExecutingDailyReset ? 'Running...' : 'Reset Daily'}</button></div>}</div>
              </>
            )}
          </div>
        ))}

        {opsTab === 'guardian' && (!canGuardianRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `guardian.read` permission.</div> : (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Guardian status</div><div>Pending approvals: <strong>{asNumber(opsGuardian?.pendingApprovalCount)}</strong></div><div>Issues: <strong>{Array.isArray(opsGuardian?.issues) ? opsGuardian.issues.length : 0}</strong></div></div>
            {canGuardianMutate && <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Guarded actions</div><div className="flex flex-wrap gap-2"><button onClick={() => { const token = window.prompt('Enter admin approval token'); if (!token) return; void withSaving('ops_refresh_pool', async () => { await runOpsGuardianAction('refresh_gemini_pool', { adminToken: token }, mediaBackendUrl); await reloadOpsSafely(); onToast('Action submitted.', 'success'); }); }} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">Refresh Primary AI Pool</button><button onClick={() => { const token = window.prompt('Enter admin approval token'); if (!token) return; void withSaving('ops_soft_shedding', async () => { await runOpsGuardianAction('enable_soft_shedding', { adminToken: token }, mediaBackendUrl); await reloadOpsSafely(); onToast('Action submitted.', 'success'); }); }} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Enable Soft Shedding</button></div></div>}
          </div>
        ))}

        {opsTab === 'alerts' && (!canAlertsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `alerts.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            {canAlertsWrite && <div className="grid gap-2 md:grid-cols-2"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create policy</div><div className="grid gap-2"><input value={newAlertName} onChange={(event) => setNewAlertName(event.target.value)} placeholder="name" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newAlertMetricKey} onChange={(event) => setNewAlertMetricKey(event.target.value)} placeholder="metricKey" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving('alert_create', async () => { await createAlertPolicy({ name: newAlertName || `policy-${Date.now()}`, metricKey: newAlertMetricKey, operator: newAlertOperator, threshold: asNumber(newAlertThreshold), windowSec: Math.max(10, asNumber(newAlertWindowSec)), cooldownSec: Math.max(10, asNumber(newAlertCooldownSec)), severity: newAlertSeverity || 'warning', enabled: true, channels: newAlertUseWebhook ? ['in_app', 'webhook'] : ['in_app'] }, token, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Create</button></div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create destination</div><div className="grid gap-2"><input value={newDestinationName} onChange={(event) => setNewDestinationName(event.target.value)} placeholder="name" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newDestinationUrl} onChange={(event) => setNewDestinationUrl(event.target.value)} placeholder="https://webhook" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving('dest_create', async () => { await createAlertDestination({ type: 'webhook', name: newDestinationName || `dest-${Date.now()}`, url: newDestinationUrl, ...(newDestinationSecretRef.trim() ? { secretRef: newDestinationSecretRef.trim() } : {}), enabled: true }, token, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Create</button></div></div></div>}
            <div className="grid gap-2 md:grid-cols-3"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Policies</div>{alertPolicies.slice(0, 8).map((policy) => <div key={policy.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{policy.name}</div>{canAlertsWrite && <button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving(`policy_toggle_${policy.id}`, async () => { await patchAlertPolicy(policy.id, { enabled: !policy.enabled }, token, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="mt-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{policy.enabled ? 'Disable' : 'Enable'}</button>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Destinations</div>{alertDestinations.slice(0, 8).map((destination) => <div key={destination.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{destination.name}</div><div className="truncate text-[10px] text-gray-600">{destination.url}</div>{canAlertsWrite && <button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving(`dest_toggle_${destination.id}`, async () => { await patchAlertDestination(destination.id, { enabled: !destination.enabled }, token, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="mt-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{destination.enabled ? 'Disable' : 'Enable'}</button>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Events</div>{alertEvents.slice(0, 8).map((eventItem) => <div key={eventItem.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{eventItem.policyId}</div><div className="text-[10px] text-gray-600">{eventItem.status}</div>{canAlertsWrite && eventItem.status !== 'resolved' && <div className="mt-1 flex gap-1"><button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving(`event_ack_${eventItem.id}`, async () => { await ackAlertEvent(eventItem.id, token, '', mediaBackendUrl); await reloadAlertsSafely(); }); }} className="rounded border border-blue-200 px-2 py-1 text-[10px] font-semibold text-blue-700">Ack</button><button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving(`event_resolve_${eventItem.id}`, async () => { await resolveAlertEvent(eventItem.id, token, '', mediaBackendUrl); await reloadAlertsSafely(); }); }} className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700">Resolve</button></div>}</div>)}</div></div>
          </div>
        ))}

        {opsTab === 'scheduler' && (!canSchedulerRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `scheduler.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            {canSchedulerWrite && <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create task</div><div className="grid gap-2 md:grid-cols-3"><select value={newTaskType} onChange={(event) => setNewTaskType(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="usage_reset_daily">usage_reset_daily</option><option value="guardian_scan">guardian_scan</option><option value="usage_export_daily">usage_export_daily</option><option value="coupon_abuse_scan">coupon_abuse_scan</option></select><input value={newTaskCron} onChange={(event) => setNewTaskCron(event.target.value)} placeholder="cronExpr" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newTaskTimezone} onChange={(event) => setNewTaskTimezone(event.target.value)} placeholder="timezone" className="h-8 rounded border border-gray-200 px-2 text-xs" /></div><button onClick={() => { void withSaving('task_create', async () => { await createSchedulerTask({ taskType: newTaskType, cronExpr: newTaskCron, timezone: newTaskTimezone, enabled: newTaskEnabled, dryRun: newTaskDryRun, concurrencyPolicy: newTaskConcurrencyPolicy }, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="mt-2 h-8 rounded border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700">Create</button></div>}
            <div className="grid gap-2 md:grid-cols-2"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Tasks</div>{schedulerTasks.slice(0, 10).map((task) => <div key={task.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{task.taskType}</div><div className="text-[10px] text-gray-600">{task.cronExpr} | {formatDate(task.nextRunAt || '')}</div>{canSchedulerWrite && <div className="mt-1 flex gap-1"><button onClick={() => { void withSaving(`task_toggle_${task.id}`, async () => { await patchSchedulerTask(task.id, { enabled: !task.enabled }, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{task.enabled ? 'Disable' : 'Enable'}</button><button onClick={() => { const token = window.prompt('Enter approval token'); if (!token) return; void withSaving(`task_run_${task.id}`, async () => { await runSchedulerTask(task.id, token, task.dryRun, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="rounded border border-indigo-200 px-2 py-1 text-[10px] font-semibold text-indigo-700">Run</button></div>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Runs</div>{schedulerRuns.slice(0, 12).map((run) => <div key={run.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{run.taskId}</div><div className="text-[10px] text-gray-600">{run.status} | {formatDate(run.startedAt || '')}</div></div>)}</div></div>
          </div>
        ))}

        {opsTab === 'audit' && (!canAuditRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `audit.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            <div className="grid gap-2 md:grid-cols-4"><input value={auditActorUid} onChange={(event) => setAuditActorUid(event.target.value)} placeholder="actorUid" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="action" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={auditResourceType} onChange={(event) => setAuditResourceType(event.target.value)} placeholder="resourceType" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { void reloadAuditSafely(); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Search</button></div>
            <div className="flex gap-2"><button onClick={() => { void withSaving('audit_verify', async () => { const payload = await verifyAdminAuditChain(mediaBackendUrl, { limit: 2000 }); setAuditVerify(payload); }); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">Verify</button><button onClick={handleExportAuditCsv} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">Export CSV</button>{auditVerify && <span className={`rounded px-2 py-1 text-[10px] font-semibold ${auditVerify.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{auditVerify.ok ? `healthy (${auditVerify.checked})` : `mismatch ${auditVerify.mismatchAtSequence || '-'}`}</span>}</div>
            <div className="max-h-48 overflow-auto rounded-xl border border-gray-100"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-gray-50 text-gray-600"><tr><th className="px-2 py-2 text-left">Seq</th><th className="px-2 py-2 text-left">When</th><th className="px-2 py-2 text-left">Actor</th><th className="px-2 py-2 text-left">Action</th></tr></thead><tbody>{auditEvents.map((eventItem) => <tr key={eventItem.eventId} className="border-t border-gray-100"><td className="px-2 py-2">{asNumber(eventItem.sequence)}</td><td className="px-2 py-2">{formatDate(eventItem.ts)}</td><td className="px-2 py-2">{eventItem.actorUid}</td><td className="px-2 py-2">{eventItem.action}</td></tr>)}</tbody></table></div>
          </div>
        ))}

        {opsTab === 'analytics' && (!canAnalyticsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `analytics.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            <div className="grid gap-2 md:grid-cols-5"><input type="date" value={analyticsFrom} onChange={(event) => setAnalyticsFrom(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" /><input type="date" value={analyticsTo} onChange={(event) => setAnalyticsTo(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" /><select value={analyticsPlan} onChange={(event) => setAnalyticsPlan(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="">All plans</option><option value="pro">pro</option><option value="plus">plus</option></select><select value={analyticsCouponKind} onChange={(event) => setAnalyticsCouponKind(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="">All kinds</option><option value="wallet_credit">wallet_credit</option><option value="subscription_discount">subscription_discount</option></select><button onClick={() => { void reloadAnalyticsSafely(); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Apply</button></div>
            <div className="grid gap-2 md:grid-cols-4"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Conversion</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.conversionRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Completion</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.checkoutCompletionRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">D30 churn</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.d30ChurnRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Efficiency</div><div className="text-lg font-bold text-gray-900">{asNumber(analyticsSummary?.discountEfficiency).toFixed(2)}</div></div></div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Impact</div><div className="flex gap-2"><input value={analyticsImpactCode} onChange={(event) => setAnalyticsImpactCode(event.target.value.toUpperCase())} placeholder="Coupon code" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { const code = analyticsImpactCode.trim().toUpperCase(); if (!code) return; void withSaving('impact_fetch', async () => { const payload = await fetchCouponAnalyticsImpact(code, mediaBackendUrl, { from: analyticsFrom, to: analyticsTo }); setAnalyticsImpact(payload); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700">Load</button></div>{analyticsImpact && <div className="mt-2">Coupon {analyticsImpact.couponCode}: conversion {toPercentLabel(analyticsImpact.overall.conversionRate)}, churn {toPercentLabel(analyticsImpact.overall.d30ChurnRate)}</div>}</div>
            <div className="max-h-36 overflow-auto rounded-xl border border-gray-100"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-gray-50 text-gray-600"><tr><th className="px-2 py-2 text-left">Date</th><th className="px-2 py-2 text-left">Plan</th><th className="px-2 py-2 text-left">Started</th><th className="px-2 py-2 text-left">Activated</th></tr></thead><tbody>{analyticsSeries.slice(0, 60).map((point, idx) => <tr key={`${point.bucket || point.date || 'bucket'}-${idx}`} className="border-t border-gray-100"><td className="px-2 py-2">{point.bucket || point.date || '-'}</td><td className="px-2 py-2">{point.plan || '-'}</td><td className="px-2 py-2">{asNumber(point.checkoutsStarted)}</td><td className="px-2 py-2">{asNumber(point.subscriptionsActivated)}</td></tr>)}</tbody></table></div>
          </div>
        ))}
      </section>
    </div>
  );
};

