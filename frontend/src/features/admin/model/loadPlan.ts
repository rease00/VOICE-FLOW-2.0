import type { AdminMainTab } from './tabs';

export type OpsTab = 'usage' | 'tokens' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics' | 'accounting';

export type AdminDataSection =
  | 'users'
  | 'coupons'
  | 'rbac'
  | 'geminiPools'
  | 'dailyReset'
  | 'ops'
  | 'alerts'
  | 'scheduler'
  | 'audit'
  | 'audioMetadata'
  | 'analytics'
  | 'accounting'
  | 'supportConversations'
  | 'supportAiPolicy'
  | 'adminNotices'
  | 'adminUnlockStatus';

const ADMIN_MAIN_TAB_SECTIONS: Record<AdminMainTab, readonly AdminDataSection[]> = {
  unlock: ['adminUnlockStatus'],
  users: ['users'],
  messages: ['supportConversations', 'supportAiPolicy', 'adminNotices', 'adminUnlockStatus'],
  pools: ['geminiPools'],
  ops: [],
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

export const ADMIN_REFRESH_ALL_SECTIONS: readonly AdminDataSection[] = [
  'users',
  'coupons',
  'rbac',
  'geminiPools',
  'dailyReset',
  'ops',
  'alerts',
  'scheduler',
  'audit',
  'audioMetadata',
  'analytics',
  'accounting',
  'supportConversations',
  'supportAiPolicy',
  'adminNotices',
  'adminUnlockStatus',
] as const;

export const resolveAdminSectionsForView = (
  mainTab: AdminMainTab,
  opsTab: OpsTab
): AdminDataSection[] => {
  const mainSections = ADMIN_MAIN_TAB_SECTIONS[mainTab] || [];
  const opsSections = mainTab === 'ops' ? (ADMIN_OPS_TAB_SECTIONS[opsTab] || []) : [];
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
