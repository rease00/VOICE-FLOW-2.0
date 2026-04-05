import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, Key, Loader2, MessageSquareText, RefreshCw, Shield, Ticket, UserCog, Users } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { useAdminCoupons } from '../src/features/admin/hooks/useAdminCoupons';
import { useAdminUsers } from '../src/features/admin/hooks/useAdminUsers';
import { hasActiveAdminActor } from '../src/shared/auth/adminAccess';
import { getEngineDisplayName } from '../services/engineDisplay';
import {
  type AdminPermission,
  type AdminRoleAssignment,
  type AdminRoleCatalogPayload,
  type AdminUserSummary,
  clearAdminUnlockToken,
  type AlertDestination,
  type AlertEvent,
  type AlertPolicy,
  type AdminSessionUnlockStatusPayload,
  type AudioMetadataRecord,
  type AuditEvent,
  type AuditVerifyPayload,
  type CouponAnalyticsPoint,
  type CouponAnalyticsSummary,
  type AccountingRecord,
  type AccountingSummary,
  type AccountingTimeseriesPoint,
  type AccountingMonitorRun,
  type DailyUsageResetStatusPayload,
  type DailyUsageResetSummary,
  disableAdminRbacUser,
  enableAdminRbacUser,
  exportAdminAudioMetadataCsv,
  fetchAdminAudioMetadata,
  fetchAdminAudioMetadataById,
  fetchAdminAuditEvents,
  fetchAdminIntegrationsUsage,
  fetchAdminRbacRoles,
  fetchAdminSessionUnlockStatus,
  fetchAdminRbacUsers,
  fetchAdminTtsGatewayStatus,
  fetchAdminTtsQueueMetrics,
  fetchAlertDestinations,
  fetchAlertEvents,
  fetchAlertPolicies,
  fetchCouponAnalyticsImpact,
  fetchCouponAnalyticsSummary,
  fetchCouponAnalyticsTimeseries,
  fetchAdminAccountingSummary,
  fetchAdminAccountingTimeseries,
  fetchAdminAccountingRecords,
  fetchAdminAccountingMonitorRuns,
  fetchDailyUsageResetStatus,
  fetchGeminiSlotStatus,
  fetchGeminiSlotUsage,
  type GeminiSlotStatusPayload,
  type GeminiSlotUsagePayload,
  getAdminUnlockToken,
  issueAdminSessionUnlock,
  patchAlertDestination,
  patchAlertPolicy,
  assignAdminRbacUser,
  createAlertDestination,
  createAlertPolicy,
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
  runAdminAccountingMonitor,
  type ScheduledTask,
  type ScheduledTaskRun,
  verifyAdminSessionUnlock,
  verifyAdminAuditChain,
  fetchAdminSupportConversations,
  fetchAdminSupportConversationById,
  fetchAdminBroadcastNotices,
  replyAdminSupportConversation,
  resolveAdminSupportConversation,
  fetchAdminSupportAiPolicy,
  createAdminBroadcastNotice,
    deleteAdminBroadcastNotice,
    fetchAdminVoiceCloneProvider,
    patchAdminSupportAiPolicy,
  type AdminNotice,
  type SupportConversation,
  type SupportMessage,
  type SupportAiPolicy,
    type VoiceCloneProviderStatusPayload,
} from '../services/adminService';
import { sanitizeUiText } from '../src/shared/ui/terminology';
import { useManagedTabs } from '../src/shared/ui/tabs';
import {
  ADMIN_MESSAGES_TAB_ORDER,
  DEFAULT_ADMIN_MESSAGES_TAB,
  type AdminMessagesTab,
  segmentSupportConversations,
} from '../src/features/admin/model/messages';
import {
  ADMIN_MAIN_TAB_ORDER,
  DEFAULT_ADMIN_MAIN_TAB,
  type AdminMainTab,
} from '../src/features/admin/model/tabs';
import {
  ADMIN_REFRESH_ALL_SECTIONS,
  getAdminSectionsToLoad,
  resolveAdminSectionsForView,
  type AdminDataSection,
  type OpsTab,
} from '../src/features/admin/model/loadPlan';
import { AdminReaderLibraryPanel } from '../src/features/admin/components/AdminReaderLibraryPanel';
import {
  getAudioMetadataProvenanceEntries,
  isRbacGuardError,
  renderBooleanLabel,
} from './adminPanelHelpers';

type ToastKind = 'success' | 'error' | 'info';
type CouponKind = 'wallet_credit' | 'subscription_discount';
type CouponPolicy = 'single_global' | 'single_per_user' | 'max_redemptions';
type RbacDraft = { role: string; status: string };
type CouponPlanDraftRow = {
  id: string;
  plan: string;
  percentOff: string;
  amountOffInr: string;
};
type ProtectedRbacRowState = Record<string, string>;

interface AdminPanelProps {
  mediaBackendUrl: string;
  onToast: (message: string, kind?: ToastKind) => void;
  onRefreshEntitlements: () => Promise<void>;
  initialOpsTab?: OpsTab;
}

const planOptions = ['Free', 'Launcher', 'Starter', 'Creator', 'Pro', 'Scale'] as const;
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
  'support.read',
  'support.reply',
  'support.ai.review',
  'support.ai.config',
];

const toDateInput = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toLocalDateTime = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date | null => {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  const candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(candidate.getTime())) return null;
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day ||
    candidate.getHours() !== hour ||
    candidate.getMinutes() !== minute
  ) {
    return null;
  }
  return candidate;
};

const parseDateTimeInput = (value: string): Date | null => {
  const raw = String(value || '').replace(/\u00a0/g, ' ').trim();
  if (!raw) return null;

  const nativeParsed = new Date(raw);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed;
  }

  const normalized = raw.replace(/\s+/g, ' ');
  const dmy = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const hour = Number(dmy[4] || 0);
    const minute = Number(dmy[5] || 0);
    return toLocalDateTime(year, month, day, hour, minute);
  }

  const ymd = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?)?$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    const hour = Number(ymd[4] || 0);
    const minute = Number(ymd[5] || 0);
    return toLocalDateTime(year, month, day, hour, minute);
  }

  return null;
};

const asNumber = (value: unknown): number => {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
};


const isForbiddenError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  return Number((error as { status?: number }).status || 0) === 403;
};

const isAdminUnlockMutationError = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message || '').trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes('x-admin-unlock')
    || message.includes('admin unlock token')
    || message.includes('unlock session')
  );
};

const isUidAllowlistAuthorizationError = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message || "").trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes("admin authorization failed: uid_not_allowlisted")
    || message.includes("uid_not_allowlisted")
  );
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (isAdminUnlockMutationError(error)) {
    return sanitizeUiText(
      'Admin unlock required. Open Unlock tab, issue a key, verify it, then retry this action.'
    );
  }
  if (isUidAllowlistAuthorizationError(error)) {
    return sanitizeUiText(
      'Admin action blocked. Ask a workspace administrator to grant admin access for your account, then retry.'
    );
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
  return `"${text.split('"').join('""')}"`;
};

type GeminiSlotStatusTone = 'ok' | 'warn' | 'bad' | 'neutral';
type GeminiSlotDisplay = {
  slotId: string;
  label: string;
  status: string;
  healthy: boolean;
  healthReason: string;
  lastUsedAt: string;
  lastFailureAt: string;
  quarantinedUntil: string;
  requests: number;
  tokens: number;
  failures: number;
  inFlight: number;
  source: string;
};

const toGeminiSlotDisplay = (slot: Record<string, unknown> | null | undefined, index: number): GeminiSlotDisplay => {
  const health = (slot?.health && typeof slot.health === 'object') ? (slot.health as Record<string, unknown>) : {};
  const usage = (slot?.usage && typeof slot.usage === 'object') ? (slot.usage as Record<string, unknown>) : {};
  const slotId = String(slot?.slotId || slot?.id || slot?.name || `slot-${index + 1}`).trim();
  const label = String(slot?.label || slotId || `Slot ${index + 1}`).trim();
  const status = String(slot?.status || health.status || (Boolean(health.healthy) ? 'healthy' : 'unknown')).trim();
  const healthReason = String(health.reason || slot?.lastFailureReason || '').trim();
  return {
    slotId: slotId || `slot-${index + 1}`,
    label: label || `Slot ${index + 1}`,
    status: status || 'unknown',
    healthy: Boolean(health.healthy),
    healthReason,
    lastUsedAt: String(slot?.lastUsedAt || usage.lastUsedAt || '').trim(),
    lastFailureAt: String(slot?.lastFailureAt || usage.lastFailureAt || '').trim(),
    quarantinedUntil: String(slot?.quarantinedUntil || '').trim(),
    requests: asNumber(usage.requests),
    tokens: asNumber(usage.tokens),
    failures: asNumber(usage.failures),
    inFlight: asNumber(slot?.inFlight),
    source: String(slot?.source || slot?.origin || slot?.backend || '').trim(),
  };
};

const extractGeminiSlots = (
  payload: GeminiSlotStatusPayload | GeminiSlotUsagePayload | null | undefined
): GeminiSlotDisplay[] => {
  const rawSlots = [
    ...(Array.isArray(payload?.slots) ? payload.slots : []),
    ...(Array.isArray((payload?.backend as Record<string, unknown> | undefined)?.slots)
      ? ((payload?.backend as Record<string, unknown> | undefined)?.slots as Record<string, unknown>[])
      : []),
    ...(Array.isArray((payload?.runtime as Record<string, unknown> | undefined)?.slots)
      ? ((payload?.runtime as Record<string, unknown> | undefined)?.slots as Record<string, unknown>[])
      : []),
  ];
  const preferred = rawSlots.slice(0, 3).map((slot, index) => toGeminiSlotDisplay(slot, index));
  if (preferred.length > 0) {
    return preferred;
  }
  return [0, 1, 2].map((index) => ({
    slotId: `slot-${index + 1}`,
    label: `Slot ${index + 1}`,
    status: 'unknown',
    healthy: false,
    healthReason: '',
    lastUsedAt: '',
    lastFailureAt: '',
    quarantinedUntil: '',
    requests: 0,
    tokens: 0,
    failures: 0,
    inFlight: 0,
    source: '',
  }));
};

const geminiSlotTone = (slot: GeminiSlotDisplay): GeminiSlotStatusTone => {
  const status = slot.status.trim().toLowerCase();
  const reason = slot.healthReason.trim().toLowerCase();
  if (!slot.healthy || status === 'auth_issue' || status === 'error' || reason === 'auth_issue') return 'bad';
  if (status === 'rate_limited' || status === 'quarantined' || slot.failures > 0) return 'warn';
  if (status === 'healthy' || status === 'ready' || slot.requests > 0 || slot.tokens > 0) return 'ok';
  return 'neutral';
};

export const AdminPanel: React.FC<AdminPanelProps> = ({
  mediaBackendUrl,
  onToast,
  onRefreshEntitlements,
  initialOpsTab = 'usage',
}) => {
  const { user } = useUser();
  useEffect(() => {
    if (!user?.uid) {
      clearAdminUnlockToken();
    }
  }, [user?.uid]);
  useEffect(() => {
    setProtectedRbacRows({});
  }, [user?.uid]);
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
    createCouponPlanDraftRow('starter', '15', '80'),
    createCouponPlanDraftRow('pro', '20', '120'),
  ]);

  const [rbacCatalog, setRbacCatalog] = useState<AdminRoleCatalogPayload | null>(null);
  const [rbacAssignments, setRbacAssignments] = useState<AdminRoleAssignment[]>([]);
  const [rbacDrafts, setRbacDrafts] = useState<Record<string, RbacDraft>>({});
  const [protectedRbacRows, setProtectedRbacRows] = useState<ProtectedRbacRowState>({});
  const [rbacSearch, setRbacSearch] = useState('');
  const [isLoadingRbac, setIsLoadingRbac] = useState(false);

  const [geminiSlotStatus, setGeminiSlotStatus] = useState<GeminiSlotStatusPayload | null>(null);
  const [geminiSlotUsage, setGeminiSlotUsage] = useState<GeminiSlotUsagePayload | null>(null);
  const [isLoadingGeminiPool, setIsLoadingGeminiPool] = useState(false);

  const [dailyUsageResetStatus, setDailyUsageResetStatus] = useState<DailyUsageResetStatusPayload | null>(null);
  const [lastDailyDryRun, setLastDailyDryRun] = useState<DailyUsageResetSummary | null>(null);
  const [isLoadingDailyResetStatus, setIsLoadingDailyResetStatus] = useState(false);
  const [isDryRunningDailyReset, setIsDryRunningDailyReset] = useState(false);
  const [isExecutingDailyReset, setIsExecutingDailyReset] = useState(false);

  const [opsTab, setOpsTab] = useState<OpsTab>(initialOpsTab);
  const [adminMainTab, setAdminMainTab] = useState<AdminMainTab>(DEFAULT_ADMIN_MAIN_TAB);
  const [adminMessagesTab, setAdminMessagesTab] = useState<AdminMessagesTab>(DEFAULT_ADMIN_MESSAGES_TAB);
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [selectedSupportConversationId, setSelectedSupportConversationId] = useState('');
  const [selectedSupportConversation, setSelectedSupportConversation] = useState<SupportConversation | null>(null);
  const [selectedSupportMessages, setSelectedSupportMessages] = useState<SupportMessage[]>([]);
  const [supportSearch, setSupportSearch] = useState('');
  const [supportReplyText, setSupportReplyText] = useState('');
  const [supportAiPolicy, setSupportAiPolicy] = useState<SupportAiPolicy | null>(null);
  const [supportAiPolicyDraft, setSupportAiPolicyDraft] = useState<SupportAiPolicy | null>(null);
  const [adminNotices, setAdminNotices] = useState<AdminNotice[]>([]);
  const [isLoadingAdminNotices, setIsLoadingAdminNotices] = useState(false);
  const [adminNoticeTitle, setAdminNoticeTitle] = useState('');
  const [adminNoticeMessage, setAdminNoticeMessage] = useState('');
  const [adminNoticeDetails, setAdminNoticeDetails] = useState('');
  const [adminNoticeExpiresAt, setAdminNoticeExpiresAt] = useState('');
  const [isLoadingSupportConversations, setIsLoadingSupportConversations] = useState(false);
  const [isLoadingSupportDetail, setIsLoadingSupportDetail] = useState(false);
  const [isLoadingSupportAiPolicy, setIsLoadingSupportAiPolicy] = useState(false);
  const [opsUsage, setOpsUsage] = useState<Record<string, unknown> | null>(null);
  const [opsGuardian, setOpsGuardian] = useState<OpsGuardianStatusPayload | null>(null);
  const [opsApprovals, setOpsApprovals] = useState<OpsGuardianApprovalsPayload | null>(null);
  const [opsGateway, setOpsGateway] = useState<Record<string, unknown> | null>(null);
  const [opsQueue, setOpsQueue] = useState<Record<string, unknown> | null>(null);
  const [voiceCloneProvider, setVoiceCloneProvider] = useState<VoiceCloneProviderStatusPayload | null>(null);
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
  const [audioMetadataRecords, setAudioMetadataRecords] = useState<AudioMetadataRecord[]>([]);
  const [selectedAudioMetadataRecord, setSelectedAudioMetadataRecord] = useState<AudioMetadataRecord | null>(null);
  const [isLoadingAudioMetadata, setIsLoadingAudioMetadata] = useState(false);
  const [isExportingAudioMetadata, setIsExportingAudioMetadata] = useState(false);
  const [audioMetadataUid, setAudioMetadataUid] = useState('');
  const [audioMetadataUserId, setAudioMetadataUserId] = useState('');
  const [audioMetadataIdentityValue, setAudioMetadataIdentityValue] = useState('');
  const [audioMetadataPaymentRef, setAudioMetadataPaymentRef] = useState('');
  const [audioMetadataStatus, setAudioMetadataStatus] = useState('');
  const [audioMetadataEngine, setAudioMetadataEngine] = useState('');
  const [audioMetadataOutputSha256, setAudioMetadataOutputSha256] = useState('');
  const [audioMetadataWatermarkId, setAudioMetadataWatermarkId] = useState('');
  const [audioMetadataC2paStatus, setAudioMetadataC2paStatus] = useState('');
  const [audioMetadataFrom, setAudioMetadataFrom] = useState('');
  const [audioMetadataTo, setAudioMetadataTo] = useState('');
  const audioMetadataEngineOptions = useMemo(() => ([
    'VECTOR',
    'PRIME',
  ] as const).map((engine) => ({
    value: engine,
    label: getEngineDisplayName(engine),
  })), []);
  const selectedAudioMetadataProvenanceEntries = useMemo(
    () => getAudioMetadataProvenanceEntries(selectedAudioMetadataRecord),
    [selectedAudioMetadataRecord]
  );
  const selectedAudioMetadataIntegritySummary = useMemo(() => {
    if (!selectedAudioMetadataRecord) return [] as Array<{ label: string; value: string }>;
    return [
      { label: 'Output SHA-256', value: selectedAudioMetadataRecord.outputSha256 || '-' },
      { label: 'Audible label applied', value: renderBooleanLabel(selectedAudioMetadataRecord.audibleLabelApplied) || '-' },
      { label: 'Watermark mode', value: selectedAudioMetadataRecord.watermarkMode || '-' },
      { label: 'Watermark ID', value: selectedAudioMetadataRecord.watermarkId || '-' },
      { label: 'Watermark version', value: selectedAudioMetadataRecord.watermarkVersion || '-' },
      { label: 'Watermark detectable', value: renderBooleanLabel(selectedAudioMetadataRecord.watermarkDetectable) || '-' },
      { label: 'C2PA status', value: selectedAudioMetadataRecord.c2paStatus || '-' },
      { label: 'C2PA manifest ref', value: selectedAudioMetadataRecord.c2paManifestRef || '-' },
      { label: 'Provenance version', value: selectedAudioMetadataRecord.provenanceVersion || '-' },
      { label: 'Provenance error', value: selectedAudioMetadataRecord.provenanceError || '-' },
    ];
  }, [selectedAudioMetadataRecord]);

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
  const [accountingFrom, setAccountingFrom] = useState(toDateInput(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)));
  const [accountingTo, setAccountingTo] = useState(toDateInput(now));
  const [accountingGroupBy, setAccountingGroupBy] = useState<'day' | 'month' | 'year'>('day');
  const [accountingIncludeUnpaidAccrual, setAccountingIncludeUnpaidAccrual] = useState(true);
  const [accountingSummary, setAccountingSummary] = useState<AccountingSummary | null>(null);
  const [accountingSeries, setAccountingSeries] = useState<AccountingTimeseriesPoint[]>([]);
  const [accountingRecords, setAccountingRecords] = useState<AccountingRecord[]>([]);
  const [accountingWarnings, setAccountingWarnings] = useState<string[]>([]);
  const [accountingSourceStatus, setAccountingSourceStatus] = useState<Record<string, unknown>>({});
  const [accountingMonitorRuns, setAccountingMonitorRuns] = useState<AccountingMonitorRun[]>([]);
  const [isLoadingAccounting, setIsLoadingAccounting] = useState(false);
  const [isExportingAccounting, setIsExportingAccounting] = useState(false);
  const [isRunningAccountingMonitor, setIsRunningAccountingMonitor] = useState(false);
  const [adminUnlockStatusPayload, setAdminUnlockStatusPayload] = useState<AdminSessionUnlockStatusPayload | null>(null);
  const [adminUnlockKeyInput, setAdminUnlockKeyInput] = useState('');
  const [latestAdminUnlockKey, setLatestAdminUnlockKey] = useState('');
  const [isIssuingAdminUnlockKey, setIsIssuingAdminUnlockKey] = useState(false);
  const [isVerifyingAdminUnlockKey, setIsVerifyingAdminUnlockKey] = useState(false);
  const [isRefreshingAdminUnlockStatus, setIsRefreshingAdminUnlockStatus] = useState(false);
  const loadedAdminSectionsRef = useRef<Set<AdminDataSection>>(new Set());

  const markAdminSectionLoaded = (section: AdminDataSection) => {
    loadedAdminSectionsRef.current.add(section);
  };

  const couponTabIds: CouponKind[] = ['wallet_credit', 'subscription_discount'];
  const opsTabIds: OpsTab[] = ['usage', 'tokens', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics', 'accounting'];
  const opsTabLabels: Record<OpsTab, string> = {
    usage: 'Usage',
    tokens: 'Tokens',
    guardian: 'Guardian',
    alerts: 'Alerts',
    scheduler: 'Scheduled Tasks',
    audit: 'Audit Ledger',
    analytics: 'Coupon Analytics',
    accounting: 'Accounting',
  };

  const couponTabs = useManagedTabs({
    items: couponTabIds.map((id) => ({ id })),
    activeId: couponTab,
    onChange: setCouponTab,
    label: 'Coupon types',
    idBase: 'admin-coupon-types',
  });
  const opsTabs = useManagedTabs({
    items: opsTabIds.map((id) => ({ id })),
    activeId: opsTab,
    onChange: setOpsTab,
    label: 'Admin ops sections',
    idBase: 'admin-ops-sections',
  });
  const adminMainTabs = useManagedTabs({
    items: ADMIN_MAIN_TAB_ORDER.map((id) => ({ id })),
    activeId: adminMainTab,
    onChange: setAdminMainTab,
    label: 'Admin control sections',
    idBase: 'admin-main-sections',
  });
  const adminMessagesTabs = useManagedTabs({
    items: ADMIN_MESSAGES_TAB_ORDER.map((id) => ({ id })),
    activeId: adminMessagesTab,
    onChange: setAdminMessagesTab,
    label: 'Support message sections',
    idBase: 'admin-message-sections',
  });

  const notifyError = (error: unknown, fallback: string, options?: { showForbidden?: boolean }) => {
    if (isForbiddenError(error) && !isUidAllowlistAuthorizationError(error) && !options?.showForbidden) return;
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
      markAdminSectionLoaded('users');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load admin users.');
    }
  };

  const reloadCouponsSafely = async () => {
    try {
      await reloadCoupons(200);
      markAdminSectionLoaded('coupons');
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
      markAdminSectionLoaded('rbac');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load access control.');
    } finally {
      setIsLoadingRbac(false);
    }
  };

  const reloadSupportConversationsSafely = async (query = supportSearch) => {
    setIsLoadingSupportConversations(true);
    try {
      const rows = await fetchAdminSupportConversations(mediaBackendUrl, {
        ...(query.trim() ? { q: query.trim() } : {}),
        limit: 200,
      });
      setSupportConversations(rows);
      setSelectedSupportConversation((previous) => {
        if (!previous) return null;
        const next = rows.find((item) => item.conversationId === previous.conversationId);
        return next || null;
      });
      if (selectedSupportConversationId && !rows.some((item) => item.conversationId === selectedSupportConversationId)) {
        setSelectedSupportConversationId('');
        setSelectedSupportMessages([]);
      }
      markAdminSectionLoaded('supportConversations');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load support conversations.');
    } finally {
      setIsLoadingSupportConversations(false);
    }
  };

  const loadSupportConversationDetailSafely = async (conversationId: string) => {
    const safeConversationId = String(conversationId || '').trim();
    if (!safeConversationId) return;
    setIsLoadingSupportDetail(true);
    try {
      const payload = await fetchAdminSupportConversationById(safeConversationId, mediaBackendUrl);
      setSelectedSupportConversationId(safeConversationId);
      setSelectedSupportConversation(payload.conversation);
      setSelectedSupportMessages(Array.isArray(payload.messages) ? payload.messages : []);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load support conversation detail.');
    } finally {
      setIsLoadingSupportDetail(false);
    }
  };

  const reloadSupportAiPolicySafely = async () => {
    setIsLoadingSupportAiPolicy(true);
    try {
      const policy = await fetchAdminSupportAiPolicy(mediaBackendUrl);
      setSupportAiPolicy(policy);
      setSupportAiPolicyDraft(policy);
      markAdminSectionLoaded('supportAiPolicy');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load support AI policy.');
    } finally {
      setIsLoadingSupportAiPolicy(false);
    }
  };

  const reloadAdminNoticesSafely = async (): Promise<boolean> => {
    setIsLoadingAdminNotices(true);
    try {
      const notices = await fetchAdminBroadcastNotices(mediaBackendUrl, { status: 'all', limit: 300 });
      setAdminNotices(Array.isArray(notices) ? notices : []);
      markAdminSectionLoaded('adminNotices');
      return true;
    } catch (error: unknown) {
      notifyError(error, 'Failed to load broadcast notices.', { showForbidden: true });
      return false;
    } finally {
      setIsLoadingAdminNotices(false);
    }
  };

  const reloadOpsSafely = async () => {
    setIsLoadingOps(true);
    try {
      const [usage, guardian, approvals, gateway, queue, provider] = await Promise.allSettled([
        fetchAdminIntegrationsUsage(mediaBackendUrl),
        fetchOpsGuardianStatus(mediaBackendUrl, true),
        fetchOpsGuardianApprovals(mediaBackendUrl, 'pending'),
        fetchAdminTtsGatewayStatus(mediaBackendUrl),
        fetchAdminTtsQueueMetrics(mediaBackendUrl),
        fetchAdminVoiceCloneProvider(mediaBackendUrl),
      ]);
      if (usage.status === 'fulfilled') setOpsUsage(usage.value as unknown as Record<string, unknown>);
      if (guardian.status === 'fulfilled') setOpsGuardian(guardian.value);
      if (approvals.status === 'fulfilled') setOpsApprovals(approvals.value);
      if (gateway.status === 'fulfilled') setOpsGateway(gateway.value as Record<string, unknown>);
      if (queue.status === 'fulfilled') setOpsQueue(queue.value as Record<string, unknown>);
      if (provider.status === 'fulfilled') {
        setVoiceCloneProvider(provider.value);
      }
      const failures = [usage, guardian, approvals, gateway, queue, provider].filter(
        (result) => result.status === 'rejected'
      ) as PromiseRejectedResult[];
      if (failures.length > 0) {
        const fallback = failures.length === 6
          ? 'Failed to load ops telemetry.'
          : `Some ops telemetry endpoints failed (${failures.length}/6).`;
        notifyError(failures[0]?.reason, fallback);
      }
      if ([usage, guardian, approvals, gateway, queue, provider].some((result) => result.status === 'fulfilled')) {
        markAdminSectionLoaded('ops');
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
      markAdminSectionLoaded('alerts');
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
      markAdminSectionLoaded('scheduler');
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
      markAdminSectionLoaded('audit');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load audit events.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const reloadAudioMetadataSafely = async () => {
    setIsLoadingAudioMetadata(true);
    try {
      const options: {
        uid?: string;
        userId?: string;
        identityValue?: string;
        paymentRef?: string;
        status?: string;
        engine?: string;
        outputSha256?: string;
        watermarkId?: string;
        c2paStatus?: string;
        from?: string;
        to?: string;
        limit: number;
      } = { limit: 200 };
      if (audioMetadataUid.trim()) options.uid = audioMetadataUid.trim();
      if (audioMetadataUserId.trim()) options.userId = audioMetadataUserId.trim();
      if (audioMetadataIdentityValue.trim()) options.identityValue = audioMetadataIdentityValue.trim();
      if (audioMetadataPaymentRef.trim()) options.paymentRef = audioMetadataPaymentRef.trim();
      if (audioMetadataStatus.trim()) options.status = audioMetadataStatus.trim();
      if (audioMetadataEngine.trim()) options.engine = audioMetadataEngine.trim();
      if (audioMetadataOutputSha256.trim()) options.outputSha256 = audioMetadataOutputSha256.trim();
      if (audioMetadataWatermarkId.trim()) options.watermarkId = audioMetadataWatermarkId.trim();
      if (audioMetadataC2paStatus.trim()) options.c2paStatus = audioMetadataC2paStatus.trim();
      if (audioMetadataFrom.trim()) options.from = audioMetadataFrom.trim();
      if (audioMetadataTo.trim()) options.to = audioMetadataTo.trim();
      const payload = await fetchAdminAudioMetadata(mediaBackendUrl, options);
      setAudioMetadataRecords(payload.items || []);
      setSelectedAudioMetadataRecord((previous) => {
        if (!previous) return null;
        const next = (payload.items || []).find((item) => item.auditId === previous.auditId);
        if (!next) return null;
        return {
          ...next,
          ...(previous.inputText ? { inputText: previous.inputText } : {}),
        };
      });
      markAdminSectionLoaded('audioMetadata');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load audio metadata records.');
    } finally {
      setIsLoadingAudioMetadata(false);
    }
  };

  const handleLoadAudioMetadataRecord = async (auditId: string) => {
    const safeAuditId = String(auditId || '').trim();
    if (!safeAuditId) return;
    try {
      const record = await fetchAdminAudioMetadataById(safeAuditId, mediaBackendUrl);
      setSelectedAudioMetadataRecord(record);
    } catch (error: unknown) {
      notifyError(error, 'Failed to load audio metadata detail.');
    }
  };

  const handleExportAudioMetadataCsv = async () => {
    setIsExportingAudioMetadata(true);
    try {
      const blob = await exportAdminAudioMetadataCsv(mediaBackendUrl, {
        ...(audioMetadataUid.trim() ? { uid: audioMetadataUid.trim() } : {}),
        ...(audioMetadataUserId.trim() ? { userId: audioMetadataUserId.trim() } : {}),
        ...(audioMetadataIdentityValue.trim() ? { identityValue: audioMetadataIdentityValue.trim() } : {}),
        ...(audioMetadataPaymentRef.trim() ? { paymentRef: audioMetadataPaymentRef.trim() } : {}),
        ...(audioMetadataStatus.trim() ? { status: audioMetadataStatus.trim() } : {}),
        ...(audioMetadataEngine.trim() ? { engine: audioMetadataEngine.trim() } : {}),
        ...(audioMetadataOutputSha256.trim() ? { outputSha256: audioMetadataOutputSha256.trim() } : {}),
        ...(audioMetadataWatermarkId.trim() ? { watermarkId: audioMetadataWatermarkId.trim() } : {}),
        ...(audioMetadataC2paStatus.trim() ? { c2paStatus: audioMetadataC2paStatus.trim() } : {}),
        ...(audioMetadataFrom.trim() ? { from: audioMetadataFrom.trim() } : {}),
        ...(audioMetadataTo.trim() ? { to: audioMetadataTo.trim() } : {}),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audio-metadata-${Date.now()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      notifyError(error, 'Failed to export audio metadata CSV.');
    } finally {
      setIsExportingAudioMetadata(false);
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
      markAdminSectionLoaded('analytics');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load coupon analytics.');
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  const reloadAccountingSafely = async () => {
    setIsLoadingAccounting(true);
    try {
      const [summaryPayload, seriesPayload, recordsPayload, monitorPayload] = await Promise.all([
        fetchAdminAccountingSummary(mediaBackendUrl, {
          from: accountingFrom,
          to: accountingTo,
          includeUnpaidAccrual: accountingIncludeUnpaidAccrual,
        }),
        fetchAdminAccountingTimeseries(mediaBackendUrl, {
          from: accountingFrom,
          to: accountingTo,
          groupBy: accountingGroupBy,
          includeUnpaidAccrual: accountingIncludeUnpaidAccrual,
        }),
        fetchAdminAccountingRecords(mediaBackendUrl, {
          from: accountingFrom,
          to: accountingTo,
          limit: 250,
          includeUnpaidAccrual: accountingIncludeUnpaidAccrual,
        }),
        fetchAdminAccountingMonitorRuns(mediaBackendUrl, 25),
      ]);
      setAccountingSummary((summaryPayload?.summary || null) as AccountingSummary | null);
      setAccountingSeries(Array.isArray(seriesPayload?.series) ? seriesPayload.series : []);
      setAccountingRecords(Array.isArray(recordsPayload?.items) ? recordsPayload.items : []);
      setAccountingMonitorRuns(Array.isArray(monitorPayload?.items) ? monitorPayload.items : []);
      const warningTokens = [
        ...(Array.isArray(summaryPayload?.warnings) ? summaryPayload.warnings : []),
        ...(Array.isArray(seriesPayload?.warnings) ? seriesPayload.warnings : []),
        ...(Array.isArray(recordsPayload?.warnings) ? recordsPayload.warnings : []),
      ].map((item) => String(item || '').trim()).filter(Boolean);
      setAccountingWarnings(Array.from(new Set(warningTokens)));
      setAccountingSourceStatus({
        ...(summaryPayload?.sourceStatus || {}),
        ...(seriesPayload?.sourceStatus || {}),
        ...(recordsPayload?.sourceStatus || {}),
      });
      markAdminSectionLoaded('accounting');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load accounting data.');
    } finally {
      setIsLoadingAccounting(false);
    }
  };

  const handleRunAccountingMonitor = async (dryRun = false) => {
    if (!canBillingWrite) {
      onToast('Missing `billing.write` permission.', 'info');
      return;
    }
    setIsRunningAccountingMonitor(true);
    try {
      const payload = await runAdminAccountingMonitor(mediaBackendUrl, { dryRun });
      onToast(
        dryRun
          ? `Accounting monitor dry-run completed (${Number(payload?.anomalyCount || 0)} anomalies).`
          : `Accounting monitor run queued (${Number(payload?.anomalyCount || 0)} anomalies).`,
        'success'
      );
      await reloadAccountingSafely();
    } catch (error: unknown) {
      notifyError(error, 'Failed to run accounting monitor.');
    } finally {
      setIsRunningAccountingMonitor(false);
    }
  };

  const handleExportAccountingCsv = async () => {
    if (!canBillingRead) {
      onToast('Missing `billing.read` permission.', 'info');
      return;
    }
    setIsExportingAccounting(true);
    try {
      const payload = await fetchAdminAccountingRecords(mediaBackendUrl, {
        from: accountingFrom,
        to: accountingTo,
        limit: 2000,
        includeUnpaidAccrual: accountingIncludeUnpaidAccrual,
      });
      const items = Array.isArray(payload?.items) ? payload.items : accountingRecords;
      if (!items.length) {
        onToast('No accounting rows to export.', 'info');
        return;
      }
      const headers = [
        'timestamp',
        'day',
        'type',
        'status',
        'amountInr',
        'paidInr',
        'unpaidInr',
        'taxInr',
        'currency',
        'amountOriginal',
        'source',
        'id',
        'metadata',
      ];
      const rows = items.map((record) => ([
        record.timestamp,
        record.day,
        record.type,
        record.status,
        asNumber(record.amountInr),
        asNumber(record.paidInr),
        asNumber(record.unpaidInr),
        asNumber(record.taxInr),
        record.currency || '',
        asNumber(record.amountOriginal),
        record.source || '',
        record.id,
        record.metadata ? JSON.stringify(record.metadata) : '',
      ]));
      const lines = [
        ['from', accountingFrom],
        ['to', accountingTo],
        ['group_by', accountingGroupBy],
        ['include_unpaid_accrual', accountingIncludeUnpaidAccrual ? '1' : '0'],
        ['generated_at_utc', new Date().toISOString()],
        [],
        headers,
        ...rows,
      ].map((row) => row.map(csvEscape).join(','));
      const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `admin-accounting-${accountingFrom || 'from'}-${accountingTo || 'to'}-${Date.now()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      notifyError(error, 'Failed to export accounting CSV.');
    } finally {
      setIsExportingAccounting(false);
    }
  };

  const reloadGeminiSlotStatusSafely = async () => {
    setIsLoadingGeminiPool(true);
    try {
      const [payload, usagePayload] = await Promise.all([
        fetchGeminiSlotStatus(mediaBackendUrl),
        fetchGeminiSlotUsage(mediaBackendUrl),
      ]);
      setGeminiSlotStatus(payload);
      setGeminiSlotUsage(usagePayload);
      markAdminSectionLoaded('geminiPools');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load service-account slot status.');
    } finally {
      setIsLoadingGeminiPool(false);
    }
  };

  const reloadDailyUsageResetStatusSafely = async () => {
    setIsLoadingDailyResetStatus(true);
    try {
      const payload = await fetchDailyUsageResetStatus(mediaBackendUrl);
      setDailyUsageResetStatus(payload);
      markAdminSectionLoaded('dailyReset');
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

  const reloadAdminUnlockStatusSafely = async () => {
    setIsRefreshingAdminUnlockStatus(true);
    try {
      const payload = await fetchAdminSessionUnlockStatus(mediaBackendUrl);
      setAdminUnlockStatusPayload(payload);
      const unlockExpiresAtMs = Number(payload?.status?.unlockExpiresAtMs || 0);
      if (unlockExpiresAtMs > 0 && unlockExpiresAtMs <= Date.now()) {
        clearAdminUnlockToken();
      }
      markAdminSectionLoaded('adminUnlockStatus');
    } catch (error: unknown) {
      notifyError(error, 'Failed to load admin unlock status.');
    } finally {
      setIsRefreshingAdminUnlockStatus(false);
    }
  };

  const ensureAdminSectionsLoaded = async (
    requiredSections: readonly AdminDataSection[],
    force = false
  ) => {
    const sectionsToLoad = getAdminSectionsToLoad(
      loadedAdminSectionsRef.current,
      requiredSections,
      force
    );
    if (sectionsToLoad.length === 0) return;
    await Promise.all(
      sectionsToLoad.map(async (section) => {
        switch (section) {
          case 'users':
            await reloadUsersSafely(search);
            break;
          case 'coupons':
            await reloadCouponsSafely();
            break;
          case 'rbac':
            await reloadRbacSafely(rbacSearch);
            break;
          case 'geminiPools':
            await reloadGeminiSlotStatusSafely();
            break;
          case 'dailyReset':
            await reloadDailyUsageResetStatusSafely();
            break;
          case 'ops':
            await reloadOpsSafely();
            break;
          case 'alerts':
            await reloadAlertsSafely();
            break;
          case 'scheduler':
            await reloadSchedulerSafely();
            break;
          case 'audit':
            await reloadAuditSafely();
            break;
          case 'audioMetadata':
            await reloadAudioMetadataSafely();
            break;
          case 'analytics':
            await reloadAnalyticsSafely();
            break;
          case 'accounting':
            await reloadAccountingSafely();
            break;
          case 'supportConversations':
            await reloadSupportConversationsSafely(supportSearch);
            break;
          case 'supportAiPolicy':
            await reloadSupportAiPolicySafely();
            break;
          case 'adminNotices':
            await reloadAdminNoticesSafely();
            break;
          case 'adminUnlockStatus':
            await reloadAdminUnlockStatusSafely();
            break;
        }
      })
    );
  };

  const handleIssueAdminUnlockKey = async () => {
    setIsIssuingAdminUnlockKey(true);
    try {
      clearAdminUnlockToken();
      const payload = await issueAdminSessionUnlock(mediaBackendUrl);
      const key = String(payload?.unlockKey || '').trim().toUpperCase();
      setLatestAdminUnlockKey(key);
      setAdminUnlockKeyInput(key);
      if (payload?.status) {
        setAdminUnlockStatusPayload({
          ok: Boolean(payload.ok),
          ...(payload.uid ? { uid: payload.uid } : {}),
          status: payload.status,
        });
      } else {
        await reloadAdminUnlockStatusSafely();
      }
      onToast('Admin unlock key issued.', 'success');
    } catch (error: unknown) {
      notifyError(error, 'Failed to issue admin unlock key.');
    } finally {
      setIsIssuingAdminUnlockKey(false);
    }
  };

  const handleVerifyAdminUnlockKey = async () => {
    const unlockKey = String(adminUnlockKeyInput || '').trim();
    if (!unlockKey) {
      onToast('Enter unlock key first.', 'info');
      return;
    }
    setIsVerifyingAdminUnlockKey(true);
    try {
      const payload = await verifyAdminSessionUnlock(unlockKey, mediaBackendUrl);
      if (payload?.status) {
        setAdminUnlockStatusPayload({
          ok: Boolean(payload.ok),
          ...(payload.uid ? { uid: payload.uid } : {}),
          status: payload.status,
        });
      } else {
        await reloadAdminUnlockStatusSafely();
      }
      setAdminUnlockKeyInput('');
      onToast('Admin session unlocked for 15 minutes.', 'success');
    } catch (error: unknown) {
      notifyError(error, 'Invalid unlock key.');
    } finally {
      setIsVerifyingAdminUnlockKey(false);
    }
  };

  const handleClearAdminUnlockToken = () => {
    clearAdminUnlockToken();
    onToast('Admin unlock token cleared from this tab.', 'info');
  };

  useEffect(() => {
    loadedAdminSectionsRef.current.clear();
  }, [mediaBackendUrl]);

  useEffect(() => {
    void ensureAdminSectionsLoaded(resolveAdminSectionsForView(adminMainTab, opsTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMainTab, mediaBackendUrl, opsTab]);

  const withSaving = async (key: string, action: () => Promise<void>, fallback = 'Admin action failed.') => {
    setIsSaving(key);
    try {
      await action();
    } catch (error: unknown) {
      notifyError(error, fallback, { showForbidden: true });
    } finally {
      setIsSaving('');
    }
  };

  useEffect(() => {
    setOpsTab(initialOpsTab);
  }, [initialOpsTab]);

  const currentActorAssignment = useMemo(() => {
    const uid = String(user?.uid || '').trim();
    if (!uid) return null;
    const serverAssignment = rbacAssignments.find((item) => String(item.uid || '').trim() === uid) || null;
    if (serverAssignment) return serverAssignment;
    const adminActor = user?.adminActor;
    if (adminActor && String(adminActor.source || '').trim().toLowerCase() === 'server' && hasActiveAdminActor(adminActor)) {
      return {
        uid: String(adminActor.uid || uid).trim() || uid,
        userId: adminActor.userId,
        role: String(adminActor.role || 'super_admin'),
        status: String(adminActor.status || 'active'),
        allowOverrides: [],
        denyOverrides: [],
      } as AdminRoleAssignment;
    }
    return null;
  }, [rbacAssignments, user?.adminActor, user?.uid]);

  const currentPermissions = useMemo(() => {
    const role = String(currentActorAssignment?.role || 'read_only_ops');
    const next = new Set<AdminPermission>();
    if (!currentActorAssignment) return next;
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
    const serverActor = user?.adminActor;
    if (serverActor && String(serverActor.source || '').trim().toLowerCase() === 'server' && hasActiveAdminActor(serverActor)) {
      for (const permission of serverActor.permissions || []) {
        if (allPermissions.includes(permission as AdminPermission)) {
          next.add(permission as AdminPermission);
        }
      }
    }
    return next;
  }, [currentActorAssignment, rbacCatalog, user?.adminActor]);

  const can = (permission: AdminPermission): boolean => {
    const actorRole = String(currentActorAssignment?.role || 'read_only_ops');
    const actorResolved = Boolean(currentActorAssignment);
    const actorStatus = String(currentActorAssignment?.status || '').trim().toLowerCase();
    if (actorStatus === 'disabled') {
      return false;
    }
    if (!actorResolved) return currentPermissions.has(permission);
    if (actorRole === 'super_admin') return true;
    return currentPermissions.has(permission);
  };

  const canUsersRead = can('users.read');
  const canUsersWrite = can('users.write');
  const canCouponsRead = can('coupons.read');
  const canCouponsWrite = can('coupons.write');
  const canBillingRead = can('billing.read');
  const canBillingWrite = can('billing.write');
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
  const canSupportRead = can('support.read');
  const canSupportReply = can('support.reply');
  const canSupportAiReview = can('support.ai.review');
  const canSupportAiConfig = can('support.ai.config');
  const canUseAdminUnlock = canUsersWrite || canCouponsWrite || canBillingWrite || canRbacWrite || canOpsMutate || canGuardianMutate || canAlertsWrite || canSchedulerWrite || canSupportReply || canSupportAiConfig;
  const voiceCloneProviderActive = String(
    voiceCloneProvider?.provider ||
    voiceCloneProvider?.activeProvider ||
    'modal'
  ).trim() || 'modal';
  const voiceCloneProviderDefault = String(voiceCloneProvider?.defaultProvider || 'modal').trim() || 'modal';
  const voiceCloneProviderInfo = voiceCloneProvider?.providerStatus || null;
  const voiceCloneProviderReady = Boolean(
    voiceCloneProvider?.ready ??
    voiceCloneProviderInfo?.ready
  );

  const handleReplySupportConversation = async () => {
    const safeConversationId = String(selectedSupportConversationId || '').trim();
    const safeReply = String(supportReplyText || '').trim();
    if (!safeConversationId) {
      onToast('Select a conversation first.', 'info');
      return;
    }
    if (!safeReply) {
      onToast('Reply text is required.', 'info');
      return;
    }
    await withSaving('support_reply', async () => {
      const payload = await replyAdminSupportConversation(safeConversationId, safeReply, mediaBackendUrl);
      setSupportReplyText('');
      setSelectedSupportConversation(payload.conversation);
      await reloadSupportConversationsSafely(supportSearch);
      await loadSupportConversationDetailSafely(safeConversationId);
      onToast('Support reply sent.', 'success');
    }, 'Failed to send support reply.');
  };

  const handleResolveSupportConversation = async () => {
    const safeConversationId = String(selectedSupportConversationId || '').trim();
    if (!safeConversationId) {
      onToast('Select a conversation first.', 'info');
      return;
    }
    await withSaving('support_resolve', async () => {
      const conversation = await resolveAdminSupportConversation(safeConversationId, mediaBackendUrl);
      setSelectedSupportConversation(conversation);
      await reloadSupportConversationsSafely(supportSearch);
      await loadSupportConversationDetailSafely(safeConversationId);
      onToast('Support conversation resolved.', 'success');
    }, 'Failed to resolve support conversation.');
  };

  const handleSaveSupportAiPolicy = async () => {
    if (!supportAiPolicyDraft) return;
    if (!canSupportAiConfig) {
      onToast('Missing support.ai.config permission.', 'info');
      return;
    }
    await withSaving('support_ai_policy', async () => {
      const next = await patchAdminSupportAiPolicy(
        {
          enabled: Boolean(supportAiPolicyDraft.enabled),
          confidenceThreshold: Math.max(0, Math.min(1, Number(supportAiPolicyDraft.confidenceThreshold || 0))),
          maxAutoRepliesPerConversation: Math.max(0, Math.floor(Number(supportAiPolicyDraft.maxAutoRepliesPerConversation || 0))),
          allowedActions: Array.isArray(supportAiPolicyDraft.allowedActions)
            ? supportAiPolicyDraft.allowedActions.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
          blockedTopics: Array.isArray(supportAiPolicyDraft.blockedTopics)
            ? supportAiPolicyDraft.blockedTopics.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
            : [],
          requireHumanForTags: Array.isArray(supportAiPolicyDraft.requireHumanForTags)
            ? supportAiPolicyDraft.requireHumanForTags.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
            : [],
        },
        mediaBackendUrl
      );
      setSupportAiPolicy(next);
      setSupportAiPolicyDraft(next);
      onToast('Support AI policy updated.', 'success');
    }, 'Failed to save support AI policy.');
  };

  const handleCreateAdminNotice = async () => {
    if (!canSupportReply) {
      onToast('Missing support.reply permission.', 'info');
      return;
    }
    if (adminUnlockRequired && !adminUnlockTokenPresent) {
      onToast('Unlock required before creating broadcast notices.', 'info');
      setAdminMainTab('unlock');
      return;
    }
    const title = sanitizeUiText(String(adminNoticeTitle || '').trim());
    const message = sanitizeUiText(String(adminNoticeMessage || '').trim());
    if (!message) {
      onToast('Broadcast message is required.', 'info');
      return;
    }
    const details = sanitizeUiText(String(adminNoticeDetails || '').trim());
    const expiresAtInput = String(adminNoticeExpiresAt || '').trim();
    if (!expiresAtInput) {
      onToast('Expiry date/time is required.', 'info');
      return;
    }
    const parsedExpiry = parseDateTimeInput(expiresAtInput);
    if (!parsedExpiry) {
      onToast('Enter a valid expiry date and time.', 'info');
      return;
    }
    if (parsedExpiry.getTime() <= Date.now()) {
      onToast('Expiry must be in the future.', 'info');
      return;
    }
    const expiresAt = parsedExpiry.toISOString();
    await withSaving('admin_notice_create', async () => {
      await createAdminBroadcastNotice({
        ...(title ? { title } : {}),
        message,
        ...(details ? { details } : {}),
        expiresAt,
      }, mediaBackendUrl);
      setAdminNoticeTitle('');
      setAdminNoticeMessage('');
      setAdminNoticeDetails('');
      setAdminNoticeExpiresAt('');
      const reloaded = await reloadAdminNoticesSafely();
      if (reloaded) {
        onToast('Broadcast notice created.', 'success');
      } else {
        onToast('Broadcast notice created, but reloading the list failed.', 'info');
      }
    }, 'Failed to create broadcast notice.');
  };

  const handleDeleteAdminNotice = async (notice: AdminNotice) => {
    if (!canSupportReply) {
      onToast('Missing support.reply permission.', 'info');
      return;
    }
    if (adminUnlockRequired && !adminUnlockTokenPresent) {
      onToast('Unlock required before deleting broadcast notices.', 'info');
      setAdminMainTab('unlock');
      return;
    }
    const noticeId = String(notice.id || '').trim();
    if (!noticeId) return;
    if (!window.confirm(`Delete broadcast notice "${notice.title || noticeId}"? This cannot be undone.`)) return;
    await withSaving(`admin_notice_delete_${noticeId}`, async () => {
      await deleteAdminBroadcastNotice(noticeId, mediaBackendUrl);
      const reloaded = await reloadAdminNoticesSafely();
      if (reloaded) {
        onToast('Broadcast notice deleted.', 'success');
      } else {
        onToast('Broadcast notice deleted, but reloading the list failed.', 'info');
      }
    }, 'Failed to delete broadcast notice.');
  };

  const updateSupportAiPolicyDraft = (patch: Partial<SupportAiPolicy>) => {
    setSupportAiPolicyDraft((previous) => {
      const fallback: SupportAiPolicy = {
        enabled: true,
        confidenceThreshold: 0.78,
        maxAutoRepliesPerConversation: 2,
        allowedActions: ['classify_message', 'retrieve_kb_snippets', 'emit_support_reply'],
        blockedTopics: ['legal_notice', 'fraud', 'chargeback'],
        requireHumanForTags: ['billing_dispute', 'account_lock', 'security'],
      };
      return {
        ...(previous || supportAiPolicy || fallback),
        ...patch,
      };
    });
  };

  const adminUnlockStatus = adminUnlockStatusPayload?.status || null;
  const adminUnlockRequired = Boolean(adminUnlockStatus?.unlockRequired);
  const adminUnlockTokenPresent = Boolean(getAdminUnlockToken());
  const adminUnlockActive = Boolean(adminUnlockStatus?.isUnlocked) && adminUnlockTokenPresent;
  const canMutateBroadcastNotices = canSupportReply && (!adminUnlockRequired || adminUnlockTokenPresent);
  const canManageReaderLibrary = canUseAdminUnlock && (!adminUnlockRequired || adminUnlockTokenPresent);
  const currentActorUid = String(currentActorAssignment?.uid || user?.uid || '').trim();
  const activeSuperAdminCount = useMemo(
    () => rbacAssignments.filter((assignment) => String(assignment.role || '').trim().toLowerCase() === 'super_admin' && String(assignment.status || '').trim().toLowerCase() === 'active').length,
    [rbacAssignments]
  );
  const isProtectedRbacAssignment = (assignment: AdminRoleAssignment): boolean => {
    const uid = String(assignment.uid || '').trim();
    if (!uid) return false;
    if (protectedRbacRows[uid]) return true;
    const role = String(assignment.role || '').trim().toLowerCase();
    const status = String(assignment.status || '').trim().toLowerCase();
    if (role === 'super_admin') return true;
    if (uid === currentActorUid && String(currentActorAssignment?.role || '').trim().toLowerCase() === 'super_admin') return true;
    if (role === 'super_admin' && status === 'active' && activeSuperAdminCount <= 1) return true;
    return false;
  };
  const markProtectedRbacAssignment = (uid: string, error: unknown): void => {
    if (!isRbacGuardError(error)) return;
    const safeUid = String(uid || '').trim();
    if (!safeUid) return;
    const reason = getErrorMessage(
      error,
      'This RBAC row is protected by server policy.'
    );
    setProtectedRbacRows((previous) => (previous[safeUid] === reason ? previous : { ...previous, [safeUid]: reason }));
  };
  const sanitizePlanToken = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const updateCouponPlanRow = (rowId: string, patch: Partial<Omit<CouponPlanDraftRow, 'id'>>) => {
    setCouponPlanRows((previous) => previous.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };
  const addCouponPlanRow = (plan = '') => {
    const safePlan = sanitizePlanToken(plan);
    setCouponPlanRows((previous) => {
      if (safePlan && previous.some((row) => sanitizePlanToken(row.plan) === safePlan)) return previous;
      const defaultsByPlan: Record<string, { percentOff: string; amountOffInr: string }> = {
        starter: { percentOff: '15', amountOffInr: '80' },
        creator: { percentOff: '18', amountOffInr: '100' },
        pro: { percentOff: '20', amountOffInr: '120' },
        scale: { percentOff: '25', amountOffInr: '150' },
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
  const geminiSlotRows = useMemo(() => {
    const statusSlots = extractGeminiSlots(geminiSlotStatus);
    const usageSlots = extractGeminiSlots(geminiSlotUsage);
    const fallbackSlot: GeminiSlotDisplay = {
      slotId: 'slot-1',
      label: 'Slot 1',
      status: 'unknown',
      healthy: false,
      healthReason: '',
      lastUsedAt: '',
      lastFailureAt: '',
      quarantinedUntil: '',
      requests: 0,
      tokens: 0,
      failures: 0,
      inFlight: 0,
      source: '',
    };
    return Array.from({ length: 3 }, (_, index) => {
      const statusSlot = statusSlots[index] || statusSlots[0] || fallbackSlot;
      const usageSlot = usageSlots[index] || usageSlots[0] || statusSlot;
      return {
        ...statusSlot,
        label: statusSlot.label || `Slot ${index + 1}`,
        slotId: statusSlot.slotId || `slot-${index + 1}`,
        status: statusSlot.status || usageSlot.status || 'unknown',
        healthy: statusSlot.healthy || usageSlot.healthy || false,
        healthReason: statusSlot.healthReason || usageSlot.healthReason || '',
        lastUsedAt: usageSlot.lastUsedAt || statusSlot.lastUsedAt || '',
        lastFailureAt: usageSlot.lastFailureAt || statusSlot.lastFailureAt || '',
        quarantinedUntil: statusSlot.quarantinedUntil || usageSlot.quarantinedUntil || '',
        requests: Math.max(statusSlot.requests || 0, usageSlot.requests || 0),
        tokens: Math.max(statusSlot.tokens || 0, usageSlot.tokens || 0),
        failures: Math.max(statusSlot.failures || 0, usageSlot.failures || 0),
        inFlight: Math.max(statusSlot.inFlight || 0, usageSlot.inFlight || 0),
        source: statusSlot.source || usageSlot.source || '',
      } as GeminiSlotDisplay;
    });
  }, [geminiSlotStatus, geminiSlotUsage]);
  const geminiWarnings = [
    ...(Array.isArray(geminiSlotStatus?.warnings) ? geminiSlotStatus.warnings : []),
  ];
  const geminiSlotSummary = geminiSlotRows.reduce(
    (summary, slot) => {
      const tone = geminiSlotTone(slot);
      summary.total += 1;
      summary.healthy += slot.healthy ? 1 : 0;
      summary.warnings += tone === 'warn' ? 1 : 0;
      summary.bad += tone === 'bad' ? 1 : 0;
      return summary;
    },
    { total: 0, healthy: 0, warnings: 0, bad: 0 }
  );
  const filteredSupportConversations = useMemo(() => {
    const needle = supportSearch.trim().toLowerCase();
    if (!needle) return supportConversations;
    return supportConversations.filter((conversation) => (
      String(conversation.conversationId || '').toLowerCase().includes(needle)
      || String(conversation.uid || '').toLowerCase().includes(needle)
      || String(conversation.userId || '').toLowerCase().includes(needle)
      || String(conversation.status || '').toLowerCase().includes(needle)
      || String(conversation.priority || '').toLowerCase().includes(needle)
    ));
  }, [supportConversations, supportSearch]);
  const segmentedSupportConversations = useMemo(
    () => segmentSupportConversations(filteredSupportConversations),
    [filteredSupportConversations]
  );
  const criticalSupportConversations = segmentedSupportConversations.critical;
  const userSupportConversations = segmentedSupportConversations.users;
  const activeSupportConversations = adminMessagesTab === 'critical'
    ? criticalSupportConversations
    : adminMessagesTab === 'users'
      ? userSupportConversations
      : [];
  const sortedAdminNotices = useMemo(
    () => [...adminNotices].sort((left, right) => {
      const leftTime = Number(new Date(String(left.createdAt || left.updatedAt || 0)).getTime() || 0);
      const rightTime = Number(new Date(String(right.createdAt || right.updatedAt || 0)).getTime() || 0);
      return rightTime - leftTime;
    }),
    [adminNotices]
  );
  const supportPriorityToneClass = (priority: string): string => {
    const token = String(priority || '').trim().toLowerCase();
    if (token === 'red') return 'border-red-200 bg-red-50 text-red-700';
    if (token === 'yellow') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  };
  const supportStatusToneClass = (status: string): string => {
    const token = String(status || '').trim().toLowerCase();
    if (token === 'resolved') return 'border-gray-200 bg-gray-100 text-gray-600';
    if (token === 'needs_human') return 'border-red-200 bg-red-50 text-red-700';
    if (token === 'ai_answered') return 'border-blue-200 bg-blue-50 text-blue-700';
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  };
  useEffect(() => {
    if (adminMainTab !== 'messages' || !canSupportRead) return;
    if (adminMessagesTab === 'broadcast') return;
    if (activeSupportConversations.length === 0) {
      setSelectedSupportConversationId('');
      setSelectedSupportConversation(null);
      setSelectedSupportMessages([]);
      return;
    }
    if (activeSupportConversations.some((conversation) => conversation.conversationId === selectedSupportConversationId)) {
      return;
    }
    const nextConversation = activeSupportConversations[0];
    if (!nextConversation) return;
    void loadSupportConversationDetailSafely(nextConversation.conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMainTab, adminMessagesTab, canSupportRead, activeSupportConversations, selectedSupportConversationId]);
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
    <div className="flex h-[calc(100dvh-10.25rem)] min-h-[30rem] flex-col gap-4 overflow-hidden">
      <section className="shrink-0 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Shield size={16} className="text-indigo-600" />
            Admin Control Plane
          </div>
          <button
            onClick={() => {
              void ensureAdminSectionsLoaded(ADMIN_REFRESH_ALL_SECTIONS, true);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw size={13} />
            Refresh All
          </button>
        </div>
        <p className="text-xs text-gray-500">Use section tabs to keep controls in one page view on all display sizes.</p>
      </section>

      <div
        {...adminMainTabs.listProps}
        className="vf-scrollbar-invisible shrink-0 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1"
      >
        <div className="flex min-w-max gap-2">
          {([
            ['unlock', 'Unlock', <Key size={13} key="unlock-icon" />],
            ['users', 'Users', <Users size={13} key="users-icon" />],
            ['messages', 'Messages', <MessageSquareText size={13} key="messages-icon" />],
            ['readerLibrary', 'Reader Library', <BookOpen size={13} key="reader-library-icon" />],
            ['pools', 'Primary AI Pool', <Key size={13} key="pools-icon" />],
            ['ops', 'Ops', <Activity size={13} key="ops-icon" />],
          ] as Array<[AdminMainTab, string, React.ReactNode]>).map(([tabId, label, icon]) => (
            <button
              key={tabId}
              {...adminMainTabs.getTabProps(tabId)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                adminMainTab === tabId ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      <section
        {...adminMainTabs.getPanelProps(adminMainTab)}
        className="min-h-0 flex-1 overflow-hidden"
      >
      <div className="h-full min-h-0 space-y-4 overflow-y-auto pr-1">
      <section className={`${adminMainTab === 'unlock' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Key size={16} className="text-indigo-600" />
            Admin Mutation Unlock
          </div>
          <div className={`rounded px-2 py-1 text-[11px] font-semibold ${
            adminUnlockActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {adminUnlockActive ? 'Unlocked' : 'Locked'}
          </div>
        </div>
        {!canUseAdminUnlock ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            Unlock not required for your current read-only permissions.
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div>Issued key: <strong>{latestAdminUnlockKey || '-'}</strong></div>
                <div>Key expires: <strong>{formatDate(adminUnlockStatus?.keyExpiresAt || '')}</strong></div>
                <div>Attempts left: <strong>{asNumber(adminUnlockStatus?.attemptsRemaining || 0)}</strong></div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div>Unlocked until: <strong>{formatDate(adminUnlockStatus?.unlockExpiresAt || '')}</strong></div>
                <div>Locked until: <strong>{formatDate(adminUnlockStatus?.lockedUntil || '')}</strong></div>
                <div>Tab token: <strong>{adminUnlockTokenPresent ? 'present' : 'missing'}</strong></div>
                <div className="mt-1 text-[10px] text-gray-500">Token stays in memory only and clears on refresh.</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { void handleIssueAdminUnlockKey(); }}
                disabled={isIssuingAdminUnlockKey}
                className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 disabled:opacity-60"
              >
                {isIssuingAdminUnlockKey ? 'Issuing...' : 'Issue Key'}
              </button>
              <input
                value={adminUnlockKeyInput}
                onChange={(event) => setAdminUnlockKeyInput(event.target.value.toUpperCase())}
                placeholder="Enter unlock key"
                className="h-8 min-w-[14rem] rounded border border-gray-200 px-2 font-mono text-[11px]"
              />
              <button
                onClick={() => { void handleVerifyAdminUnlockKey(); }}
                disabled={isVerifyingAdminUnlockKey}
                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
              >
                {isVerifyingAdminUnlockKey ? 'Verifying...' : 'Verify & Unlock'}
              </button>
              <button
                onClick={handleClearAdminUnlockToken}
                className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700"
              >
                Clear Local Token
              </button>
              <button
                onClick={() => { void reloadAdminUnlockStatusSafely(); }}
                disabled={isRefreshingAdminUnlockStatus}
                className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 disabled:opacity-60"
              >
                {isRefreshingAdminUnlockStatus ? 'Refreshing...' : 'Refresh Status'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={`${adminMainTab === 'messages' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <MessageSquareText size={16} className="text-indigo-600" />
            Messages
          </div>
          {adminMessagesTab === 'broadcast' ? (
            <div className="text-xs text-gray-500">Broadcast notices are managed below.</div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={supportSearch}
                onChange={(event) => setSupportSearch(event.target.value)}
                placeholder="Search uid, userId, status"
                className="h-8 w-52 rounded border border-gray-200 px-2 text-xs"
              />
              <button
                onClick={() => { void reloadSupportConversationsSafely(supportSearch); }}
                className="h-8 rounded border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700"
              >
                Search
              </button>
              <button
                onClick={() => {
                  void reloadSupportConversationsSafely(supportSearch);
                  void reloadSupportAiPolicySafely();
                }}
                className="h-8 rounded border border-gray-200 px-2.5 text-xs font-semibold text-gray-700"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700">
            Critical: {criticalSupportConversations.length}
          </span>
          <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700">
            Users: {userSupportConversations.length}
          </span>
          <span className="rounded border border-violet-200 bg-violet-50 px-2 py-1 font-semibold text-violet-700">
            Broadcast: {adminNotices.length}
          </span>
          <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600">
            Total: {filteredSupportConversations.length}
          </span>
        </div>

        <div className="mb-3 inline-flex rounded-lg border border-gray-200 p-0.5" {...adminMessagesTabs.listProps}>
          <button
            {...adminMessagesTabs.getTabProps('critical')}
            className={`rounded px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              adminMessagesTab === 'critical' ? 'bg-indigo-600 text-white' : 'text-gray-600'
            }`}
          >
            Critical
          </button>
          <button
            {...adminMessagesTabs.getTabProps('users')}
            className={`rounded px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              adminMessagesTab === 'users' ? 'bg-indigo-600 text-white' : 'text-gray-600'
            }`}
          >
            Users
          </button>
          <button
            {...adminMessagesTabs.getTabProps('broadcast')}
            className={`rounded px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              adminMessagesTab === 'broadcast' ? 'bg-indigo-600 text-white' : 'text-gray-600'
            }`}
          >
            Broadcast
          </button>
        </div>

        <div
          {...adminMessagesTabs.getPanelProps(adminMessagesTab)}
          className={!canSupportRead ? '' : adminMessagesTab === 'broadcast' ? 'space-y-3' : 'grid gap-3 lg:grid-cols-[minmax(18rem,22rem)_1fr]'}
        >
          {!canSupportRead ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `support.read` permission.</div>
          ) : adminMessagesTab === 'broadcast' ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(20rem,24rem)_1fr]">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">Create broadcast notice</div>
                <div className="grid gap-2 text-xs">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Title</span>
                    <input
                      value={adminNoticeTitle}
                      onChange={(event) => setAdminNoticeTitle(event.target.value)}
                      placeholder="Service maintenance tonight"
                      className="h-8 rounded border border-gray-200 px-2 text-xs"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Message</span>
                    <textarea
                      value={adminNoticeMessage}
                      onChange={(event) => setAdminNoticeMessage(event.target.value)}
                      rows={5}
                      placeholder="Tell users what changed and what they should expect."
                      className="rounded border border-gray-200 px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Details (optional)</span>
                    <textarea
                      value={adminNoticeDetails}
                      onChange={(event) => setAdminNoticeDetails(event.target.value)}
                      rows={3}
                      placeholder="Optional additional context for users."
                      className="rounded border border-gray-200 px-2 py-1.5 text-xs"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Expires at</span>
                    <input
                      type="datetime-local"
                      value={adminNoticeExpiresAt}
                      onChange={(event) => setAdminNoticeExpiresAt(event.target.value)}
                      required
                      className="h-8 rounded border border-gray-200 px-2 text-xs"
                    />
                  </label>
                  <button
                    onClick={() => { void handleCreateAdminNotice(); }}
                    disabled={!canMutateBroadcastNotices || Boolean(isSaving)}
                    className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 disabled:opacity-60"
                  >
                    {isSaving === 'admin_notice_create' ? 'Creating...' : 'Create Broadcast'}
                  </button>
                  <div className="text-[11px] leading-4 text-gray-500">
                    Expiry is required before creating. Use picker, `YYYY-MM-DDTHH:mm`, or `DD-MM-YYYY HH:mm`.
                  </div>
                  {adminUnlockRequired && !adminUnlockTokenPresent ? (
                    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                      Unlock is required for broadcast create/delete. Open the Unlock tab first.
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-gray-700">Broadcast notices</div>
                  <button
                    onClick={() => { void reloadAdminNoticesSafely(); }}
                    className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700"
                  >
                    {isLoadingAdminNotices ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                {isLoadingAdminNotices ? (
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={13} className="animate-spin" />
                    Loading broadcast notices...
                  </div>
                ) : sortedAdminNotices.length === 0 ? (
                  <div className="text-xs text-gray-500">No broadcast notices yet.</div>
                ) : (
                  <div className="space-y-2">
                    {sortedAdminNotices.map((notice) => {
                      const noticeId = String(notice.id || '').trim();
                      const statusToken = String(notice.status || '').trim().toLowerCase();
                      const statusClass = statusToken === 'deleted'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700';
                      return (
                        <div key={noticeId || `${notice.title}-${notice.createdAt || notice.updatedAt || ''}`} className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="break-words text-xs font-semibold text-gray-800">{notice.title || '-'}</div>
                              <div className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-700">{notice.message || '-'}</div>
                              {notice.details ? (
                                <div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-gray-500">{String(notice.details)}</div>
                              ) : null}
                            </div>
                            <button
                              onClick={() => { void handleDeleteAdminNotice(notice); }}
                              disabled={!canMutateBroadcastNotices || statusToken === 'deleted' || Boolean(isSaving)}
                              className="rounded border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 disabled:opacity-60"
                            >
                              {isSaving === `admin_notice_delete_${noticeId}` ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                            <span className={`rounded border px-1.5 py-0.5 font-semibold ${statusClass}`}>{statusToken || 'active'}</span>
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-600">
                              created {formatDate(notice.createdAt || notice.updatedAt || '')}
                            </span>
                            <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-600">
                              expires {formatDate(notice.expiresAt || '')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">
                {adminMessagesTab === 'critical' ? 'Critical queue' : 'Users queue'}
              </div>
              <div className="space-y-2">
                {isLoadingSupportConversations ? (
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={13} className="animate-spin" />
                    Loading conversations...
                  </div>
                ) : activeSupportConversations.length === 0 ? (
                  <div className="text-xs text-gray-500">No conversations in this queue.</div>
                ) : (
                  activeSupportConversations.map((conversation) => {
                    const isSelected = conversation.conversationId === selectedSupportConversationId;
                    return (
                      <button
                        key={conversation.conversationId}
                        type="button"
                        onClick={() => { void loadSupportConversationDetailSafely(conversation.conversationId); }}
                        className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                          isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-200'
                        }`}
                      >
                        <div className="font-semibold text-gray-800">{conversation.userId || conversation.uid || conversation.conversationId}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${supportStatusToneClass(conversation.status || '')}`}>
                            {String(conversation.status || 'open')}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${supportPriorityToneClass(conversation.priority || '')}`}>
                            {String(conversation.priority || 'green')}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-gray-500">
                          uid: {conversation.uid || '-'} | {formatDate(conversation.lastMessageAt)}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                {!selectedSupportConversationId ? (
                  <div className="text-xs text-gray-500">Select a conversation to view details.</div>
                ) : isLoadingSupportDetail ? (
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={13} className="animate-spin" />
                    Loading conversation...
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-gray-800">
                        Conversation {selectedSupportConversationId}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${supportStatusToneClass(selectedSupportConversation?.status || '')}`}>
                          {String(selectedSupportConversation?.status || '-')}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${supportPriorityToneClass(selectedSupportConversation?.priority || '')}`}>
                          {String(selectedSupportConversation?.priority || '-')}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2 rounded border border-gray-200 bg-white p-2">
                      {selectedSupportMessages.length === 0 ? (
                        <div className="text-xs text-gray-500">No messages found.</div>
                      ) : (
                        selectedSupportMessages.map((message) => (
                          <div key={message.messageId} className="rounded border border-gray-100 bg-gray-50 p-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">
                              {message.fromType} | {formatDate(message.createdAt)}
                            </div>
                            <div className="whitespace-pre-wrap break-words text-xs text-gray-800">{message.text || '-'}</div>
                          </div>
                        ))
                      )}
                    </div>
                    <textarea
                      value={supportReplyText}
                      onChange={(event) => setSupportReplyText(event.target.value)}
                      rows={3}
                      placeholder="Reply to this conversation"
                      className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => { void handleReplySupportConversation(); }}
                        disabled={!canSupportReply || !selectedSupportConversationId || !supportReplyText.trim() || Boolean(isSaving)}
                        className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 disabled:opacity-60"
                      >
                        Send reply
                      </button>
                      <button
                        onClick={() => { void handleResolveSupportConversation(); }}
                        disabled={!canSupportReply || !selectedSupportConversationId || String(selectedSupportConversation?.status || '').trim().toLowerCase() === 'resolved' || Boolean(isSaving)}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {canSupportAiReview && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-800">Support AI policy</div>
                    {isLoadingSupportAiPolicy ? <Loader2 size={13} className="animate-spin text-gray-500" /> : null}
                  </div>
                  {!supportAiPolicyDraft ? (
                    <div className="text-xs text-gray-500">Policy not loaded.</div>
                  ) : (
                    <div className="grid gap-2 text-xs">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(supportAiPolicyDraft.enabled)}
                          onChange={(event) => updateSupportAiPolicyDraft({ enabled: event.target.checked })}
                          disabled={!canSupportAiConfig}
                        />
                        Enabled
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Confidence threshold</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={Number(supportAiPolicyDraft.confidenceThreshold || 0)}
                          onChange={(event) => updateSupportAiPolicyDraft({ confidenceThreshold: Number(event.target.value) })}
                          disabled={!canSupportAiConfig}
                          className="h-8 rounded border border-gray-200 px-2 text-xs"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Max auto replies</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={Math.max(0, Math.floor(Number(supportAiPolicyDraft.maxAutoRepliesPerConversation || 0)))}
                          onChange={(event) => updateSupportAiPolicyDraft({ maxAutoRepliesPerConversation: Number(event.target.value) })}
                          disabled={!canSupportAiConfig}
                          className="h-8 rounded border border-gray-200 px-2 text-xs"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Allowed actions (csv)</span>
                        <input
                          value={Array.isArray(supportAiPolicyDraft.allowedActions) ? supportAiPolicyDraft.allowedActions.join(', ') : ''}
                          onChange={(event) => updateSupportAiPolicyDraft({ allowedActions: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
                          disabled={!canSupportAiConfig}
                          className="h-8 rounded border border-gray-200 px-2 text-xs"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Blocked topics (csv)</span>
                        <input
                          value={Array.isArray(supportAiPolicyDraft.blockedTopics) ? supportAiPolicyDraft.blockedTopics.join(', ') : ''}
                          onChange={(event) => updateSupportAiPolicyDraft({ blockedTopics: event.target.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) })}
                          disabled={!canSupportAiConfig}
                          className="h-8 rounded border border-gray-200 px-2 text-xs"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Require human tags (csv)</span>
                        <input
                          value={Array.isArray(supportAiPolicyDraft.requireHumanForTags) ? supportAiPolicyDraft.requireHumanForTags.join(', ') : ''}
                          onChange={(event) => updateSupportAiPolicyDraft({ requireHumanForTags: event.target.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) })}
                          disabled={!canSupportAiConfig}
                          className="h-8 rounded border border-gray-200 px-2 text-xs"
                        />
                      </label>
                      <div className="mt-1">
                        <button
                          onClick={() => { void handleSaveSupportAiPolicy(); }}
                          disabled={!canSupportAiConfig || Boolean(isSaving)}
                          className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 disabled:opacity-60"
                        >
                          Save AI policy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            </>
          )}
        </div>
        {ADMIN_MESSAGES_TAB_ORDER.filter((tabId) => tabId !== adminMessagesTab).map((tabId) => (
          <div key={`admin-message-panel-${tabId}`} {...adminMessagesTabs.getPanelProps(tabId)} className="hidden" />
        ))}
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
                    const isProtected = isProtectedRbacAssignment(assignment);
                    const protectionReason = protectedRbacRows[String(assignment.uid || '').trim()] || '';
                    return (
                      <tr key={assignment.uid} className="border-t border-gray-100">
                        <td className="px-2 py-2">
                          <div className="font-semibold text-gray-800">{assignment.uid}</div>
                          <div className="text-[10px] text-gray-500">v{Number(assignment.version || 0)}</div>
                          {isProtected && (
                            <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              Protected by server policy
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={draft.role}
                            onChange={(event) => setRbacDraft(assignment.uid, (previous) => ({ ...previous, role: event.target.value }))}
                            disabled={!canRbacWrite || isProtected}
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
                            disabled={!canRbacWrite || isProtected}
                            className="h-8 rounded border border-gray-200 px-2 text-xs"
                          >
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          {!canRbacWrite ? (
                            <span className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-500">read-only</span>
                          ) : isProtected ? (
                            <div className="max-w-[14rem] rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                              {protectionReason || 'Protected by server policy'}
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <button
                                onClick={() => {
                                  void withSaving(`rbac_save_${assignment.uid}`, async () => {
                                    try {
                                      await assignAdminRbacUser(assignment.uid, { role: draft.role, status: draft.status }, mediaBackendUrl);
                                      await reloadRbacSafely(rbacSearch);
                                      onToast('Role updated.', 'success');
                                    } catch (error) {
                                      markProtectedRbacAssignment(assignment.uid, error);
                                      throw error;
                                    }
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
                                      try {
                                        await enableAdminRbacUser(assignment.uid, note, mediaBackendUrl);
                                        await reloadRbacSafely(rbacSearch);
                                      } catch (error) {
                                        markProtectedRbacAssignment(assignment.uid, error);
                                        throw error;
                                      }
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
                                      try {
                                        await disableAdminRbacUser(assignment.uid, note, mediaBackendUrl);
                                        await reloadRbacSafely(rbacSearch);
                                      } catch (error) {
                                        markProtectedRbacAssignment(assignment.uid, error);
                                        throw error;
                                      }
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

      <section className={`${adminMainTab === 'readerLibrary' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
        <AdminReaderLibraryPanel
          mediaBackendUrl={mediaBackendUrl}
          onToast={onToast}
          canManage={canManageReaderLibrary}
        />
      </section>

      <section className={`${adminMainTab === 'users' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
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
                        <div className="mt-1 text-[10px] text-gray-500">
                          Cap: {Math.max(0, Number(row.limits?.maxCharsPerGeneration || 0)).toLocaleString()} chars
                          {row.features?.earlyAccess ? ' â€¢ Early access' : ''}
                        </div>
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

      <section className="hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800"><Ticket size={16} className="text-indigo-600" />Coupons</div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5" {...couponTabs.listProps}>
            <button {...couponTabs.getTabProps('wallet_credit')} className={`rounded px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${couponTab === 'wallet_credit' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}>Wallet</button>
            <button {...couponTabs.getTabProps('subscription_discount')} className={`rounded px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${couponTab === 'subscription_discount' ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}>Subscription</button>
          </div>
        </div>
        <div {...couponTabs.getPanelProps(couponTab)}>
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
                          <button type="button" onClick={() => addCouponPlanRow('starter')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Starter</button>
                          <button type="button" onClick={() => addCouponPlanRow('creator')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Creator</button>
                          <button type="button" onClick={() => addCouponPlanRow('pro')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Pro</button>
                          <button type="button" onClick={() => addCouponPlanRow('scale')} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">+ Scale</button>
                          <button type="button" onClick={() => addCouponPlanRow()} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">+ Add plan</button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        {couponPlanRows.map((row) => (
                          <div key={row.id} className="grid grid-cols-12 gap-2">
                            <input
                              value={row.plan}
                              onChange={(event) => updateCouponPlanRow(row.id, { plan: event.target.value })}
                              placeholder="Plan key (starter, creator, pro, scale)"
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
        </div>
        {couponTabIds.filter((tabId) => tabId !== couponTab).map((tabId) => (
          <div key={`admin-coupon-panel-${tabId}`} {...couponTabs.getPanelProps(tabId)} className="hidden" />
        ))}
      </section>

      <section className={`${adminMainTab === 'pools' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Key size={16} className="text-indigo-600" />
            GCP Slot Health
          </div>
        </div>
        {!canOpsRead ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `ops.read` permission.</div>
        ) : isLoadingGeminiPool ? (
          <div className="text-xs text-gray-500">Loading service-account slot status...</div>
        ) : (
          <div className="space-y-3 text-xs">
            {geminiWarnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                {geminiWarnings.map((warning, index) => (
                  <div key={`pool-warning-${index}`}>{sanitizeUiText(String(warning || ''))}</div>
                ))}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Slot Summary</div>
                <div>Total slots: <strong>{geminiSlotSummary.total}</strong></div>
                <div>Healthy: <strong>{geminiSlotSummary.healthy}</strong></div>
                <div>Warnings: <strong>{geminiSlotSummary.warnings}</strong></div>
                <div>Critical: <strong>{geminiSlotSummary.bad}</strong></div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Backend Snapshot</div>
                <div>Slots: <strong>{Array.isArray(geminiSlotStatus?.backend?.slots) ? geminiSlotStatus.backend.slots.length : asNumber((geminiSlotStatus?.backend as Record<string, unknown> | undefined)?.slotCount)}</strong></div>
                <div>Last update: <strong>{formatDate(geminiSlotStatus?.backend?.lastCheckedAt as string || geminiSlotStatus?.backend?.updatedAt as string || geminiSlotStatus?.updatedAt as string || '')}</strong></div>
                <div>Status: <strong>{String(geminiSlotStatus?.backend?.ok === false ? 'degraded' : 'ok')}</strong></div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Runtime Snapshot</div>
                <div>Slots: <strong>{Array.isArray(geminiSlotStatus?.runtime?.slots) ? geminiSlotStatus.runtime.slots.length : asNumber((geminiSlotStatus?.runtime as Record<string, unknown> | undefined)?.slotCount)}</strong></div>
                <div>Last update: <strong>{formatDate(geminiSlotStatus?.runtime?.lastCheckedAt as string || geminiSlotStatus?.runtime?.updatedAt as string || '')}</strong></div>
                <div>Status: <strong>{String(geminiSlotStatus?.runtime?.ok === false ? 'degraded' : 'ok')}</strong></div>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
              <table className="min-w-full text-[11px]">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Slot</th>
                    <th className="px-3 py-2 text-left">Health</th>
                    <th className="px-3 py-2 text-left">Usage</th>
                    <th className="px-3 py-2 text-left">Last Used</th>
                    <th className="px-3 py-2 text-left">Quarantine</th>
                    <th className="px-3 py-2 text-left">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {geminiSlotRows.map((slot) => {
                    const tone = geminiSlotTone(slot);
                    const rowClass = tone === 'bad'
                      ? 'bg-red-50 text-red-800'
                      : tone === 'warn'
                        ? 'bg-amber-50 text-amber-800'
                        : tone === 'ok'
                          ? 'bg-emerald-50 text-emerald-800'
                          : '';
                    return (
                      <tr key={slot.slotId} className={`border-t border-gray-100 ${rowClass}`}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-gray-900">{slot.label}</div>
                          <div className="text-[10px] text-gray-500">{slot.slotId}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>Status: <strong>{slot.status || 'unknown'}</strong></div>
                          <div>Healthy: <strong>{slot.healthy ? 'Yes' : 'No'}</strong></div>
                          <div>Reason: <strong>{slot.healthReason || '-'}</strong></div>
                          <div>In-flight: <strong>{slot.inFlight}</strong></div>
                        </td>
                        <td className="px-3 py-2">
                          <div>Requests: <strong>{slot.requests.toLocaleString()}</strong></div>
                          <div>Tokens: <strong>{slot.tokens.toLocaleString()}</strong></div>
                          <div>Failures: <strong>{slot.failures.toLocaleString()}</strong></div>
                        </td>
                        <td className="px-3 py-2">{formatDate(slot.lastUsedAt)}</td>
                        <td className="px-3 py-2">
                          <div>{slot.quarantinedUntil ? formatDate(slot.quarantinedUntil) : '-'}</div>
                          <div className="text-[10px] text-gray-500">{tone === 'bad' ? 'critical' : tone === 'warn' ? 'watch' : 'normal'}</div>
                        </td>
                        <td className="px-3 py-2">{slot.source || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className={`${adminMainTab === 'ops' ? '' : 'hidden'} rounded-2xl border border-gray-200 bg-white p-4 shadow-sm`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800"><Activity size={16} className="text-indigo-600" />Ops</div>
          <button onClick={() => { void reloadOpsSafely(); void reloadAlertsSafely(); void reloadSchedulerSafely(); void reloadAuditSafely(); void reloadAudioMetadataSafely(); void reloadAnalyticsSafely(); void reloadAccountingSafely(); }} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700"><RefreshCw size={13} />Refresh</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2" {...opsTabs.listProps}>
          {opsTabIds.map((tabId) => (
            <button key={tabId} {...opsTabs.getTabProps(tabId)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${opsTab === tabId ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>{opsTabLabels[tabId]}</button>
          ))}
        </div>

        <div {...opsTabs.getPanelProps(opsTab)}>
        {(opsTab === 'usage' || opsTab === 'tokens') && (!canOpsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `ops.read` permission.</div> : (
          <div className="space-y-3 text-xs">
            {isLoadingOps ? <div className="text-gray-500">Loading ops telemetry...</div> : (
              <>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-semibold text-gray-800">Voice cloning runtime</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${voiceCloneProviderReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {voiceCloneProviderReady ? 'Ready' : 'Not ready'}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-5">
                    <div>Provider: <strong>{voiceCloneProviderActive}</strong></div>
                    <div>Default: <strong>{voiceCloneProviderDefault}</strong></div>
                    <div>Device: <strong>{String(voiceCloneProviderInfo?.device || voiceCloneProvider?.device || 'n/a')}</strong></div>
                    <div>GPU concurrency: <strong>{String(voiceCloneProvider?.runtimeGpuConcurrency || 0) || '0'} / {String(voiceCloneProvider?.expectedGpuConcurrency || 2)}</strong></div>
                    <div>Detail: <strong>{String(voiceCloneProviderInfo?.detail || voiceCloneProvider?.detail || 'n/a')}</strong></div>
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Modal is the only supported production VC runtime. Provider switching is disabled.
                  </div>
                </div>
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
            {canGuardianMutate && <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Guarded actions</div><div className="flex flex-wrap gap-2"><button onClick={() => { void withSaving('ops_refresh_pool', async () => { await runOpsGuardianAction('refresh_gemini_pool', undefined, mediaBackendUrl); await reloadOpsSafely(); onToast('Action submitted.', 'success'); }); }} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">Refresh Primary AI Pool</button><button onClick={() => { void withSaving('ops_soft_shedding', async () => { await runOpsGuardianAction('enable_soft_shedding', undefined, mediaBackendUrl); await reloadOpsSafely(); onToast('Action submitted.', 'success'); }); }} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Enable Soft Shedding</button></div></div>}
          </div>
        ))}

        {opsTab === 'alerts' && (!canAlertsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `alerts.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            {canAlertsWrite && <div className="grid gap-2 md:grid-cols-2"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create policy</div><div className="grid gap-2"><input value={newAlertName} onChange={(event) => setNewAlertName(event.target.value)} placeholder="name" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newAlertMetricKey} onChange={(event) => setNewAlertMetricKey(event.target.value)} placeholder="metricKey" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { void withSaving('alert_create', async () => { await createAlertPolicy({ name: newAlertName || `policy-${Date.now()}`, metricKey: newAlertMetricKey, operator: newAlertOperator, threshold: asNumber(newAlertThreshold), windowSec: Math.max(10, asNumber(newAlertWindowSec)), cooldownSec: Math.max(10, asNumber(newAlertCooldownSec)), severity: newAlertSeverity || 'warning', enabled: true, channels: newAlertUseWebhook ? ['in_app', 'webhook'] : ['in_app'] }, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Create</button></div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create destination</div><div className="grid gap-2"><input value={newDestinationName} onChange={(event) => setNewDestinationName(event.target.value)} placeholder="name" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newDestinationUrl} onChange={(event) => setNewDestinationUrl(event.target.value)} placeholder="https://webhook" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { void withSaving('dest_create', async () => { await createAlertDestination({ type: 'webhook', name: newDestinationName || `dest-${Date.now()}`, url: newDestinationUrl, ...(newDestinationSecretRef.trim() ? { secretRef: newDestinationSecretRef.trim() } : {}), enabled: true }, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Create</button></div></div></div>}
            <div className="grid gap-2 md:grid-cols-3"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Policies</div>{alertPolicies.slice(0, 8).map((policy) => <div key={policy.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{policy.name}</div>{canAlertsWrite && <button onClick={() => { void withSaving(`policy_toggle_${policy.id}`, async () => { await patchAlertPolicy(policy.id, { enabled: !policy.enabled }, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="mt-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{policy.enabled ? 'Disable' : 'Enable'}</button>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Destinations</div>{alertDestinations.slice(0, 8).map((destination) => <div key={destination.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{destination.name}</div><div className="truncate text-[10px] text-gray-600">{destination.url}</div>{canAlertsWrite && <button onClick={() => { void withSaving(`dest_toggle_${destination.id}`, async () => { await patchAlertDestination(destination.id, { enabled: !destination.enabled }, mediaBackendUrl); await reloadAlertsSafely(); }); }} className="mt-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{destination.enabled ? 'Disable' : 'Enable'}</button>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Events</div>{alertEvents.slice(0, 8).map((eventItem) => <div key={eventItem.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{eventItem.policyId}</div><div className="text-[10px] text-gray-600">{eventItem.status}</div>{canAlertsWrite && eventItem.status !== 'resolved' && <div className="mt-1 flex gap-1"><button onClick={() => { void withSaving(`event_ack_${eventItem.id}`, async () => { await ackAlertEvent(eventItem.id, '', mediaBackendUrl); await reloadAlertsSafely(); }); }} className="rounded border border-blue-200 px-2 py-1 text-[10px] font-semibold text-blue-700">Ack</button><button onClick={() => { void withSaving(`event_resolve_${eventItem.id}`, async () => { await resolveAlertEvent(eventItem.id, '', mediaBackendUrl); await reloadAlertsSafely(); }); }} className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700">Resolve</button></div>}</div>)}</div></div>
          </div>
        ))}

        {opsTab === 'scheduler' && (!canSchedulerRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `scheduler.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            {canSchedulerWrite && <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Create task</div><div className="grid gap-2 md:grid-cols-3"><select value={newTaskType} onChange={(event) => setNewTaskType(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="usage_reset_daily">usage_reset_daily</option><option value="guardian_scan">guardian_scan</option><option value="usage_export_daily">usage_export_daily</option><option value="coupon_abuse_scan">coupon_abuse_scan</option><option value="audio_generation_audit_retention_cleanup">audio_generation_audit_retention_cleanup</option><option value="accounting_monitor_daily">accounting_monitor_daily</option></select><input value={newTaskCron} onChange={(event) => setNewTaskCron(event.target.value)} placeholder="cronExpr" className="h-8 rounded border border-gray-200 px-2 text-xs" /><input value={newTaskTimezone} onChange={(event) => setNewTaskTimezone(event.target.value)} placeholder="timezone" className="h-8 rounded border border-gray-200 px-2 text-xs" /></div><button onClick={() => { void withSaving('task_create', async () => { await createSchedulerTask({ taskType: newTaskType, cronExpr: newTaskCron, timezone: newTaskTimezone, enabled: newTaskEnabled, dryRun: newTaskDryRun, concurrencyPolicy: newTaskConcurrencyPolicy }, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="mt-2 h-8 rounded border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700">Create</button></div>}
            <div className="grid gap-2 md:grid-cols-2"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Tasks</div>{schedulerTasks.slice(0, 10).map((task) => <div key={task.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{task.taskType}</div><div className="text-[10px] text-gray-600">{task.cronExpr} | {formatDate(task.nextRunAt || '')}</div>{canSchedulerWrite && <div className="mt-1 flex gap-1"><button onClick={() => { void withSaving(`task_toggle_${task.id}`, async () => { await patchSchedulerTask(task.id, { enabled: !task.enabled }, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">{task.enabled ? 'Disable' : 'Enable'}</button><button onClick={() => { void withSaving(`task_run_${task.id}`, async () => { await runSchedulerTask(task.id, task.dryRun, mediaBackendUrl); await reloadSchedulerSafely(); }); }} className="rounded border border-indigo-200 px-2 py-1 text-[10px] font-semibold text-indigo-700">Run</button></div>}</div>)}</div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Runs</div>{schedulerRuns.slice(0, 12).map((run) => <div key={run.id} className="mb-1 rounded border border-gray-200 bg-white p-2"><div className="font-semibold">{run.taskId}</div><div className="text-[10px] text-gray-600">{run.status} | {formatDate(run.startedAt || '')}</div></div>)}</div></div>
          </div>
        ))}

        {opsTab === 'audit' && (!canAuditRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `audit.read` permission.</div> : (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 font-semibold text-gray-800">Audit Ledger</div>
              <div className="grid gap-2 md:grid-cols-4">
                <input value={auditActorUid} onChange={(event) => setAuditActorUid(event.target.value)} placeholder="actorUid" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={auditAction} onChange={(event) => setAuditAction(event.target.value)} placeholder="action" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={auditResourceType} onChange={(event) => setAuditResourceType(event.target.value)} placeholder="resourceType" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <button onClick={() => { void reloadAuditSafely(); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Search</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => { void withSaving('audit_verify', async () => { const payload = await verifyAdminAuditChain(mediaBackendUrl, { limit: 2000 }); setAuditVerify(payload); }); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">Verify</button>
                <button onClick={handleExportAuditCsv} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">Export CSV</button>
                {auditVerify && <span className={`rounded px-2 py-1 text-[10px] font-semibold ${auditVerify.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{auditVerify.ok ? `healthy (${auditVerify.checked})` : `mismatch ${auditVerify.mismatchAtSequence || '-'}`}</span>}
              </div>
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-gray-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-2 py-2 text-left">Seq</th>
                      <th className="px-2 py-2 text-left">When</th>
                      <th className="px-2 py-2 text-left">Actor</th>
                      <th className="px-2 py-2 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEvents.map((eventItem) => (
                      <tr key={eventItem.eventId} className="border-t border-gray-100">
                        <td className="px-2 py-2">{asNumber(eventItem.sequence)}</td>
                        <td className="px-2 py-2">{formatDate(eventItem.ts)}</td>
                        <td className="px-2 py-2">{eventItem.actorUid}</td>
                        <td className="px-2 py-2">{eventItem.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-semibold text-gray-800">Audio Metadata</div>
                {isLoadingAudioMetadata ? <div className="text-[10px] text-gray-500">Loading...</div> : null}
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <input value={audioMetadataUid} onChange={(event) => setAudioMetadataUid(event.target.value)} placeholder="uid" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={audioMetadataUserId} onChange={(event) => setAudioMetadataUserId(event.target.value)} placeholder="userId" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={audioMetadataIdentityValue} onChange={(event) => setAudioMetadataIdentityValue(event.target.value)} placeholder="identity" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={audioMetadataPaymentRef} onChange={(event) => setAudioMetadataPaymentRef(event.target.value)} placeholder="paymentRef" className="h-8 rounded border border-gray-200 px-2 text-xs" />
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <select value={audioMetadataStatus} onChange={(event) => setAudioMetadataStatus(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs">
                  <option value="">All statuses</option>
                  <option value="received">received</option>
                  <option value="queued">queued</option>
                  <option value="running">running</option>
                  <option value="completed">completed</option>
                  <option value="failed">failed</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <select value={audioMetadataEngine} onChange={(event) => setAudioMetadataEngine(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs">
                  <option value="">All engines</option>
                  {audioMetadataEngineOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input type="date" value={audioMetadataFrom} onChange={(event) => setAudioMetadataFrom(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input type="date" value={audioMetadataTo} onChange={(event) => setAudioMetadataTo(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" />
              </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                <input value={audioMetadataOutputSha256} onChange={(event) => setAudioMetadataOutputSha256(event.target.value)} placeholder="outputSha256" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <input value={audioMetadataWatermarkId} onChange={(event) => setAudioMetadataWatermarkId(event.target.value)} placeholder="watermarkId" className="h-8 rounded border border-gray-200 px-2 text-xs" />
                <select value={audioMetadataC2paStatus} onChange={(event) => setAudioMetadataC2paStatus(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs">
                  <option value="">All C2PA states</option>
                  <option value="pending">pending</option>
                  <option value="applied">applied</option>
                  <option value="unsupported">unsupported</option>
                  <option value="error">error</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => { void reloadAudioMetadataSafely(); }} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">Search</button>
                <button onClick={() => { void handleExportAudioMetadataCsv(); }} disabled={isExportingAudioMetadata} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700 disabled:opacity-60">{isExportingAudioMetadata ? 'Exporting...' : 'Export CSV'}</button>
                {selectedAudioMetadataRecord && <button onClick={() => setSelectedAudioMetadataRecord(null)} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">Clear detail</button>}
                <span className="self-center text-[10px] text-gray-500">{audioMetadataRecords.length} records</span>
              </div>
              <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-gray-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-2 py-2 text-left">When</th>
                      <th className="px-2 py-2 text-left">Identity</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-left">Engine</th>
                      <th className="px-2 py-2 text-left">Integrity</th>
                      <th className="px-2 py-2 text-left">IP</th>
                      <th className="px-2 py-2 text-left">Payment</th>
                      <th className="px-2 py-2 text-left">Text</th>
                      <th className="px-2 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audioMetadataRecords.length === 0 && (
                      <tr>
                        <td className="px-2 py-3 text-gray-500" colSpan={9}>No audio metadata records found.</td>
                      </tr>
                    )}
                    {audioMetadataRecords.map((record) => (
                      <tr key={record.auditId} className="border-t border-gray-100 align-top">
                        <td className="px-2 py-2">{formatDate(record.submittedAt)}</td>
                        <td className="px-2 py-2">
                          <div>{record.identityValue || record.userId || record.uid || '-'}</div>
                          <div className="text-[10px] text-gray-500">{record.uid || '-'}</div>
                        </td>
                        <td className="px-2 py-2">{record.status || '-'}</td>
                        <td className="px-2 py-2">{record.engine || '-'}</td>
                        <td className="px-2 py-2">
                          <div className="max-w-[16rem] space-y-1 whitespace-pre-wrap break-words text-[10px] text-gray-700">
                            <div><span className="font-semibold text-gray-500">SHA:</span> {record.outputSha256 || '-'}</div>
                            <div><span className="font-semibold text-gray-500">Label:</span> {record.audibleLabelApplied ? 'yes' : 'no'}</div>
                            <div><span className="font-semibold text-gray-500">WM:</span> {record.watermarkId || '-'} {record.watermarkMode ? `(${record.watermarkMode})` : ''}</div>
                            <div><span className="font-semibold text-gray-500">WM ver:</span> {record.watermarkVersion || '-'}</div>
                            <div><span className="font-semibold text-gray-500">Detectable:</span> {renderBooleanLabel(record.watermarkDetectable) || '-'}</div>
                            <div><span className="font-semibold text-gray-500">C2PA:</span> {record.c2paStatus || '-'} {record.c2paManifestRef ? `• ${record.c2paManifestRef}` : ''}</div>
                            <div><span className="font-semibold text-gray-500">Prov:</span> {record.provenanceVersion || '-'}{record.provenanceError ? ` • ${record.provenanceError}` : ''}</div>
                          </div>
                        </td>
                        <td className="px-2 py-2 font-mono text-[10px]">{record.sourceIp || '-'}</td>
                        <td className="px-2 py-2">{record.paymentRef || '-'}</td>
                        <td className="px-2 py-2">
                          <div className="max-w-xs whitespace-pre-wrap break-words">{record.textPreview || '-'}</div>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => { void handleLoadAudioMetadataRecord(record.auditId); }} className="rounded border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-700">View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedAudioMetadataRecord && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 font-semibold text-gray-800">Full Input Text</div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-700">{selectedAudioMetadataRecord.inputText || ''}</pre>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 font-semibold text-gray-800">Integrity metadata</div>
                    {selectedAudioMetadataIntegritySummary.length > 0 && (
                      <dl className="mb-3 grid gap-2 text-[11px] text-gray-700 md:grid-cols-2">
                        {selectedAudioMetadataIntegritySummary.map((entry) => (
                          <div key={`${entry.label}:${entry.value}`} className="grid gap-0.5">
                            <dt className="font-medium text-gray-500">{entry.label}</dt>
                            <dd className="break-words text-gray-800">{entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {selectedAudioMetadataProvenanceEntries.length > 0 ? (
                      <dl className="grid gap-2 text-[11px] text-gray-700">
                        {selectedAudioMetadataProvenanceEntries.map((entry) => (
                          <div key={`${entry.label}:${entry.value}`} className="grid gap-0.5">
                            <dt className="font-medium text-gray-500">{entry.label}</dt>
                            <dd className="break-words text-gray-800">{entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <div className="text-[11px] text-gray-500">No provenance fields available.</div>
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-3 md:col-span-2">
                    <div className="mb-2 font-semibold text-gray-800">Stored Record</div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-700">{JSON.stringify(selectedAudioMetadataRecord, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {opsTab === 'analytics' && (!canAnalyticsRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `analytics.read` permission.</div> : (
          <div className="space-y-2 text-xs">
            <div className="grid gap-2 md:grid-cols-5"><input type="date" value={analyticsFrom} onChange={(event) => setAnalyticsFrom(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" /><input type="date" value={analyticsTo} onChange={(event) => setAnalyticsTo(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" /><select value={analyticsPlan} onChange={(event) => setAnalyticsPlan(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="">All plans</option><option value="starter">starter</option><option value="creator">creator</option><option value="pro">pro</option><option value="scale">scale</option></select><select value={analyticsCouponKind} onChange={(event) => setAnalyticsCouponKind(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs"><option value="">All kinds</option><option value="wallet_credit">wallet_credit</option><option value="subscription_discount">subscription_discount</option></select><button onClick={() => { void reloadAnalyticsSafely(); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Apply</button></div>
            <div className="grid gap-2 md:grid-cols-4"><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Conversion</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.conversionRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Completion</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.checkoutCompletionRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">D30 churn</div><div className="text-lg font-bold text-gray-900">{toPercentLabel(analyticsSummary?.d30ChurnRate)}</div></div><div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Efficiency</div><div className="text-lg font-bold text-gray-900">{asNumber(analyticsSummary?.discountEfficiency).toFixed(2)}</div></div></div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="mb-1 font-semibold text-gray-800">Impact</div><div className="flex gap-2"><input value={analyticsImpactCode} onChange={(event) => setAnalyticsImpactCode(event.target.value.toUpperCase())} placeholder="Coupon code" className="h-8 rounded border border-gray-200 px-2 text-xs" /><button onClick={() => { const code = analyticsImpactCode.trim().toUpperCase(); if (!code) return; void withSaving('impact_fetch', async () => { const payload = await fetchCouponAnalyticsImpact(code, mediaBackendUrl, { from: analyticsFrom, to: analyticsTo }); setAnalyticsImpact(payload); }); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700">Load</button></div>{analyticsImpact && <div className="mt-2">Coupon {analyticsImpact.couponCode}: conversion {toPercentLabel(analyticsImpact.overall.conversionRate)}, churn {toPercentLabel(analyticsImpact.overall.d30ChurnRate)}</div>}</div>
            <div className="max-h-36 overflow-auto rounded-xl border border-gray-100"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-gray-50 text-gray-600"><tr><th className="px-2 py-2 text-left">Date</th><th className="px-2 py-2 text-left">Plan</th><th className="px-2 py-2 text-left">Started</th><th className="px-2 py-2 text-left">Activated</th></tr></thead><tbody>{analyticsSeries.slice(0, 60).map((point, idx) => <tr key={`${point.bucket || point.date || 'bucket'}-${idx}`} className="border-t border-gray-100"><td className="px-2 py-2">{point.bucket || point.date || '-'}</td><td className="px-2 py-2">{point.plan || '-'}</td><td className="px-2 py-2">{asNumber(point.checkoutsStarted)}</td><td className="px-2 py-2">{asNumber(point.subscriptionsActivated)}</td></tr>)}</tbody></table></div>
          </div>
        ))}

        {opsTab === 'accounting' && (!canBillingRead ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">Missing `billing.read` permission.</div> : (
          <div className="space-y-3 text-xs">
            <div className="grid gap-2 md:grid-cols-7">
              <input type="date" value={accountingFrom} onChange={(event) => setAccountingFrom(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" />
              <input type="date" value={accountingTo} onChange={(event) => setAccountingTo(event.target.value)} className="h-8 rounded border border-gray-200 px-2 text-xs" />
              <select value={accountingGroupBy} onChange={(event) => setAccountingGroupBy(event.target.value as 'day' | 'month' | 'year')} className="h-8 rounded border border-gray-200 px-2 text-xs">
                <option value="day">day</option>
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
              <label className="inline-flex h-8 items-center gap-2 rounded border border-gray-200 px-2 text-[11px] text-gray-700">
                <input type="checkbox" checked={accountingIncludeUnpaidAccrual} onChange={(event) => setAccountingIncludeUnpaidAccrual(event.target.checked)} />
                Include unpaid accrual
              </label>
              <button onClick={() => { void reloadAccountingSafely(); }} className="h-8 rounded border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700">Apply</button>
              <button onClick={() => { void handleExportAccountingCsv(); }} disabled={isExportingAccounting} className="h-8 rounded border border-gray-200 bg-white text-xs font-semibold text-gray-700 disabled:opacity-60">{isExportingAccounting ? 'Exporting...' : 'Export CSV'}</button>
              {canBillingWrite ? (
                <div className="flex gap-2">
                  <button onClick={() => { void handleRunAccountingMonitor(true); }} disabled={isRunningAccountingMonitor} className="h-8 rounded border border-gray-200 px-2 text-xs font-semibold text-gray-700 disabled:opacity-60">{isRunningAccountingMonitor ? 'Running...' : 'Dry monitor'}</button>
                  <button onClick={() => { void handleRunAccountingMonitor(false); }} disabled={isRunningAccountingMonitor} className="h-8 rounded border border-indigo-200 bg-indigo-50 px-2 text-xs font-semibold text-indigo-700 disabled:opacity-60">{isRunningAccountingMonitor ? 'Running...' : 'Run monitor'}</button>
                </div>
              ) : <div />}
            </div>

            {isLoadingAccounting ? <div className="text-gray-500">Loading accounting view...</div> : null}

            <div className="grid gap-2 md:grid-cols-6">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Revenue accrued</div><div className="text-lg font-bold text-gray-900">INR {asNumber(accountingSummary?.revenue?.accruedInr).toLocaleString()}</div></div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Revenue unpaid</div><div className="text-lg font-bold text-amber-700">INR {asNumber(accountingSummary?.revenue?.unpaidInr).toLocaleString()}</div></div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Tax accrued</div><div className="text-lg font-bold text-gray-900">INR {asNumber(accountingSummary?.revenue?.taxInr).toLocaleString()}</div></div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Expenditure</div><div className="text-lg font-bold text-gray-900">INR {asNumber(accountingSummary?.expenditure?.totalInr).toLocaleString()}</div></div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Cloud Run CPU</div><div className="text-lg font-bold text-gray-900">INR {asNumber(accountingSummary?.cloudRun?.cpuCostInr).toLocaleString()}</div></div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3"><div className="text-gray-500">Gemini cost</div><div className="text-lg font-bold text-gray-900">INR {asNumber(accountingSummary?.gemini?.estimatedCostInr).toLocaleString()}</div></div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Source status</div>
                <div className="text-[11px] text-gray-700">Stripe: <strong>{String(accountingSourceStatus?.stripeInvoices || 'unknown')}</strong></div>
                <div className="text-[11px] text-gray-700">Cloud Run CPU: <strong>{String(accountingSourceStatus?.cloudRunCpu || 'unknown')}</strong></div>
                <div className="text-[11px] text-gray-700">Gemini usage: <strong>{String(accountingSourceStatus?.usageEvents || 'unknown')}</strong></div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Margin</div>
                <div className={`text-lg font-bold ${asNumber(accountingSummary?.marginInr) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>INR {asNumber(accountingSummary?.marginInr).toLocaleString()}</div>
                <div className="text-[11px] text-gray-700">Margin %: <strong>{toPercentLabel(accountingSummary?.marginPct)}</strong></div>
                <div className="text-[11px] text-gray-700">Gemini generations: <strong>{asNumber(accountingSummary?.gemini?.generations).toLocaleString()}</strong></div>
              </div>
            </div>

            {accountingWarnings.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
                {accountingWarnings.map((warning, index) => <div key={`accounting-warning-${index}`}>- {warning}</div>)}
              </div>
            ) : null}

            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Day/Month/Year series</div>
                <div className="max-h-52 overflow-auto rounded border border-gray-100 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-600">
                      <tr><th className="px-2 py-2 text-left">Bucket</th><th className="px-2 py-2 text-left">Revenue</th><th className="px-2 py-2 text-left">Expenditure</th><th className="px-2 py-2 text-left">Gemini tokens</th></tr>
                    </thead>
                    <tbody>
                      {accountingSeries.slice(0, 180).map((point, idx) => (
                        <tr key={`accounting-series-${point.bucket}-${idx}`} className="border-t border-gray-100">
                          <td className="px-2 py-2">{point.bucket || '-'}</td>
                          <td className="px-2 py-2">INR {asNumber(point.revenueAccruedInr).toLocaleString()}</td>
                          <td className="px-2 py-2">INR {(asNumber(point.walletExpenditureInr) + asNumber(point.couponDiscountInr) + asNumber(point.cloudRunCpuCostInr) + asNumber(point.geminiCostInr)).toLocaleString()}</td>
                          <td className="px-2 py-2">{asNumber(point.geminiTotalTokens).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-1 font-semibold text-gray-800">Monitor runs</div>
                <div className="max-h-52 overflow-auto rounded border border-gray-100 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 text-gray-600">
                      <tr><th className="px-2 py-2 text-left">When</th><th className="px-2 py-2 text-left">Source</th><th className="px-2 py-2 text-left">Anomalies</th><th className="px-2 py-2 text-left">Dry run</th></tr>
                    </thead>
                    <tbody>
                      {accountingMonitorRuns.length === 0 ? <tr><td className="px-2 py-3 text-gray-500" colSpan={4}>No monitor runs yet.</td></tr> : null}
                      {accountingMonitorRuns.map((run) => (
                        <tr key={run.id} className="border-t border-gray-100">
                          <td className="px-2 py-2">{formatDate(run.createdAt || run.startedAt || '')}</td>
                          <td className="px-2 py-2">{run.source || '-'}</td>
                          <td className="px-2 py-2">{Array.isArray(run.anomalies) ? run.anomalies.length : 0}</td>
                          <td className="px-2 py-2">{run.dryRun ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-1 font-semibold text-gray-800">Ledger records</div>
              <div className="max-h-72 overflow-auto rounded border border-gray-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-600">
                    <tr><th className="px-2 py-2 text-left">Time</th><th className="px-2 py-2 text-left">Type</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-left">Amount (INR)</th><th className="px-2 py-2 text-left">Tax (INR)</th></tr>
                  </thead>
                  <tbody>
                    {accountingRecords.length === 0 ? <tr><td className="px-2 py-3 text-gray-500" colSpan={5}>No accounting records in selected range.</td></tr> : null}
                    {accountingRecords.map((record) => (
                      <tr key={record.id} className="border-t border-gray-100">
                        <td className="px-2 py-2">{formatDate(record.timestamp)}</td>
                        <td className="px-2 py-2">{record.type || '-'}</td>
                        <td className="px-2 py-2">{record.status || '-'}</td>
                        <td className="px-2 py-2">INR {asNumber(record.amountInr).toLocaleString()}</td>
                        <td className="px-2 py-2">INR {asNumber(record.taxInr).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
        </div>
        {opsTabIds.filter((tabId) => tabId !== opsTab).map((tabId) => (
          <div key={`admin-ops-panel-${tabId}`} {...opsTabs.getPanelProps(tabId)} className="hidden" />
        ))}
      </section>
      {ADMIN_MAIN_TAB_ORDER.filter((tabId) => tabId !== adminMainTab).map((tabId) => (
        <section key={`admin-main-panel-${tabId}`} {...adminMainTabs.getPanelProps(tabId)} className="hidden" />
      ))}
      </div>
      </section>
    </div>
  );
};

