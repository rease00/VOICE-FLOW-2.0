import { describe, expect, it } from 'vitest';
import { getManagedTabNavigationTarget } from '../src/shared/ui/tabs';
import {
  ADMIN_MESSAGES_TAB_ORDER,
  DEFAULT_ADMIN_MESSAGES_TAB,
  isCriticalSupportConversation,
  isUsersSupportConversation,
  resolveAdminMessagesTab,
  segmentSupportConversations,
} from '../src/features/admin/model/messages';

describe('admin messages model', () => {
  it('keeps messages tab order and default contract', () => {
    expect(ADMIN_MESSAGES_TAB_ORDER).toEqual(['critical', 'users', 'broadcast']);
    expect(DEFAULT_ADMIN_MESSAGES_TAB).toBe('critical');
    expect(resolveAdminMessagesTab(undefined)).toBe('critical');
    expect(resolveAdminMessagesTab('users')).toBe('users');
    expect(resolveAdminMessagesTab('broadcast')).toBe('broadcast');
  });

  it('supports keyboard navigation for message subtabs', () => {
    const items = ADMIN_MESSAGES_TAB_ORDER.map((id) => ({ id }));
    expect(getManagedTabNavigationTarget(items, 'critical', 'ArrowRight')).toBe('users');
    expect(getManagedTabNavigationTarget(items, 'users', 'ArrowRight')).toBe('broadcast');
    expect(getManagedTabNavigationTarget(items, 'broadcast', 'ArrowRight')).toBe('critical');
    expect(getManagedTabNavigationTarget(items, 'users', 'Home')).toBe('critical');
    expect(getManagedTabNavigationTarget(items, 'critical', 'End')).toBe('broadcast');
  });

  it('classifies critical conversations using needs_human or non-green priority', () => {
    expect(isCriticalSupportConversation({ status: 'needs_human', priority: 'green' })).toBe(true);
    expect(isCriticalSupportConversation({ status: 'open', priority: 'yellow' })).toBe(true);
    expect(isCriticalSupportConversation({ status: 'open', priority: 'green' })).toBe(false);
  });

  it('classifies users queue as active non-critical conversations only', () => {
    expect(isUsersSupportConversation({ status: 'open', priority: 'green' })).toBe(true);
    expect(isUsersSupportConversation({ status: 'ai_answered', priority: 'green' })).toBe(true);
    expect(isUsersSupportConversation({ status: 'resolved', priority: 'green' })).toBe(false);
    expect(isUsersSupportConversation({ status: 'needs_human', priority: 'green' })).toBe(false);
    expect(isUsersSupportConversation({ status: 'open', priority: 'yellow' })).toBe(false);
  });

  it('segments critical and users queues without overlap', () => {
    const sample = [
      { conversationId: 'a', uid: 'u1', userId: 'u1', status: 'open', priority: 'green' },
      { conversationId: 'b', uid: 'u2', userId: 'u2', status: 'needs_human', priority: 'green' },
      { conversationId: 'c', uid: 'u3', userId: 'u3', status: 'ai_answered', priority: 'green' },
      { conversationId: 'd', uid: 'u4', userId: 'u4', status: 'resolved', priority: 'green' },
      { conversationId: 'e', uid: 'u5', userId: 'u5', status: 'open', priority: 'yellow' },
    ] as const;

    const segmented = segmentSupportConversations(sample.map((item) => ({ ...item })));
    expect(segmented.critical.map((item) => item.conversationId)).toEqual(['b', 'e']);
    expect(segmented.users.map((item) => item.conversationId)).toEqual(['a', 'c']);
  });
});
