import { describe, expect, it } from 'vitest';
import { getManagedTabNavigationTarget } from '../src/shared/ui/tabs';
import {
  ADMIN_MAIN_TAB_ORDER,
  DEFAULT_ADMIN_MAIN_TAB,
  resolveAdminMainTab,
} from '../src/features/admin/model/tabs';

describe('admin main tabs model', () => {
  it('keeps the admin tab order and default contract with messages inserted', () => {
    expect(ADMIN_MAIN_TAB_ORDER).toEqual(['unlock', 'users', 'messages', 'pools', 'ops']);
    expect(DEFAULT_ADMIN_MAIN_TAB).toBe('users');
    expect(resolveAdminMainTab(undefined)).toBe('users');
    expect(resolveAdminMainTab('support')).toBe('messages');
  });

  it('supports keyboard navigation for admin main tabs', () => {
    const items = ADMIN_MAIN_TAB_ORDER.map((id) => ({ id }));
    expect(getManagedTabNavigationTarget(items, 'unlock', 'ArrowRight')).toBe('users');
    expect(getManagedTabNavigationTarget(items, 'ops', 'ArrowRight')).toBe('unlock');
    expect(getManagedTabNavigationTarget(items, 'pools', 'Home')).toBe('unlock');
    expect(getManagedTabNavigationTarget(items, 'unlock', 'End')).toBe('ops');
  });
});

