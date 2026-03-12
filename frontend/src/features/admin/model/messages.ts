import type { SupportConversation } from '../../../../services/adminService';

export type AdminMessagesTab = 'critical' | 'users';

export const ADMIN_MESSAGES_TAB_ORDER: readonly AdminMessagesTab[] = ['critical', 'users'] as const;
export const DEFAULT_ADMIN_MESSAGES_TAB: AdminMessagesTab = 'critical';

const toToken = (value: unknown): string => String(value || '').trim().toLowerCase();

export const resolveAdminMessagesTab = (value: unknown): AdminMessagesTab => {
  const token = toToken(value);
  return token === 'users' ? 'users' : 'critical';
};

export const isCriticalSupportConversation = (conversation: Pick<SupportConversation, 'status' | 'priority'>): boolean => {
  const status = toToken(conversation.status);
  const priority = toToken(conversation.priority);
  return status === 'needs_human' || priority !== 'green';
};

export const isUsersSupportConversation = (conversation: Pick<SupportConversation, 'status' | 'priority'>): boolean => {
  if (isCriticalSupportConversation(conversation)) return false;
  const status = toToken(conversation.status);
  return status === 'open' || status === 'ai_answered';
};

export const segmentSupportConversations = (
  conversations: SupportConversation[]
): { critical: SupportConversation[]; users: SupportConversation[] } => {
  const critical: SupportConversation[] = [];
  const users: SupportConversation[] = [];
  for (const conversation of conversations) {
    if (isCriticalSupportConversation(conversation)) {
      critical.push(conversation);
      continue;
    }
    if (isUsersSupportConversation(conversation)) {
      users.push(conversation);
    }
  }
  return { critical, users };
};
