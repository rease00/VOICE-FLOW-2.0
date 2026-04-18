import type { AdminMainTab } from './tabs';

export type OpsTab = 'usage' | 'tokens' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics' | 'accounting';
export type MoneyView = 'overview' | 'providers' | 'cash' | 'budgets' | 'accounting';

export type AdminDataSection =
  | 'dashboardSummary'
  | 'users'
  | 'userTimeline'
  | 'coupons'
  | 'rbac'
  | 'geminiPools'
  | 'dailyReset'
  | 'ops'
  | 'runtimeSummary'
  | 'moneySummary'
  | 'alerts'
  | 'scheduler'
  | 'audit'
  | 'audioMetadata'
  | 'analytics'
  | 'accounting'
  | 'supportConversations'
  | 'supportQueues'
  | 'supportAiPolicy'
  | 'adminNotices'
  | 'adminUnlockStatus'
  | 'incidents'
  | 'featureFlags'
  | 'automationRuns'
  | 'moderationReports';

const ADMIN_MAIN_TAB_SECTIONS: Record<AdminMainTab, readonly AdminDataSection[]> = {
  today: ['dashboardSummary', 'runtimeSummary', 'moneySummary', 'supportQueues', 'incidents', 'featureFlags'],
  users: ['users', 'userTimeline'],
  runtime: ['runtimeSummary', 'geminiPools', 'ops', 'alerts', 'scheduler', 'featureFlags'],
  money: ['moneySummary'],
  safety: ['supportConversations', 'supportQueues', 'supportAiPolicy', 'adminNotices', 'adminUnlockStatus', 'audit', 'audioMetadata', 'incidents', 'moderationReports', 'automationRuns', 'featureFlags'],
};

const ADMIN_OPS_TAB_SECTIONS: Record<OpsTab, readonly AdminDataSection[]> = {
  usage: ['ops'],
  tokens: ['ops'],
  guardian: ['ops'],
  alerts: ['alerts'],
  scheduler: ['scheduler'],
  audit: ['audit', 'audioMetadata'],
  analytics: ['analytics'],
  accounting: ['accounting'],
};

const uniqueSections = (sections: readonly AdminDataSection[]): AdminDataSection[] => Array.from(new Set(sections));

const resolveMoneySectionsForView = (moneyView?: MoneyView): AdminDataSection[] => {
  if (moneyView === 'accounting') {
    return ['moneySummary', 'analytics', 'accounting', 'dailyReset'];
  }
  return ['moneySummary'];
};

export const ADMIN_REFRESH_ALL_SECTIONS: readonly AdminDataSection[] = [
  'dashboardSummary',
  'users',
  'userTimeline',
  'coupons',
  'rbac',
  'geminiPools',
  'dailyReset',
  'ops',
  'runtimeSummary',
  'moneySummary',
  'alerts',
  'scheduler',
  'audit',
  'audioMetadata',
  'analytics',
  'accounting',
  'supportConversations',
  'supportQueues',
  'supportAiPolicy',
  'adminNotices',
  'adminUnlockStatus',
  'incidents',
  'featureFlags',
  'automationRuns',
  'moderationReports',
] as const;

export const resolveAdminSectionsForView = (
  mainTab: AdminMainTab,
  opsTab: OpsTab,
  options?: { moneyView?: MoneyView }
): AdminDataSection[] => {
  const mainSections = mainTab === 'money'
    ? resolveMoneySectionsForView(options?.moneyView)
    : (ADMIN_MAIN_TAB_SECTIONS[mainTab] || []);
  const opsSections = (mainTab === 'runtime' || mainTab === 'safety' || (mainTab === 'money' && options?.moneyView === 'accounting'))
    ? (ADMIN_OPS_TAB_SECTIONS[opsTab] || [])
    : [];
  return uniqueSections([...mainSections, ...opsSections]);
};

export const getAdminSectionsToLoad = (
  loadedSections: Iterable<AdminDataSection>,
  requiredSections: readonly AdminDataSection[],
  force = false
): AdminDataSection[] => {
  const uniqueRequired = uniqueSections(requiredSections);
  if (force) return uniqueRequired;
  const loaded = new Set(loadedSections);
  return uniqueRequired.filter((section) => !loaded.has(section));
};
