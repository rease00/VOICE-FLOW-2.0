import { describe, expect, it } from 'vitest';
import { getManagedTabNavigationTarget } from '../src/shared/ui/tabs';
import {
  ADMIN_MAIN_TAB_ORDER,
  DEFAULT_ADMIN_MAIN_TAB,
  resolveAdminMainTab,
} from '../src/features/admin/model/tabs';

describe('admin main tabs model', () => {
  it('keeps the admin tab order and default contract aligned with the dashboard surfaces', () => {
    expect(ADMIN_MAIN_TAB_ORDER).toEqual(['today', 'users', 'runtime', 'money', 'safety']);
    expect(DEFAULT_ADMIN_MAIN_TAB).toBe('today');
    expect(resolveAdminMainTab(undefined)).toBe('today');
    expect(resolveAdminMainTab('support')).toBe('safety');
  });

  it('supports keyboard navigation for admin main tabs', () => {
    const items = ADMIN_MAIN_TAB_ORDER.map((id) => ({ id }));
    expect(getManagedTabNavigationTarget(items, 'today', 'ArrowRight')).toBe('users');
    expect(getManagedTabNavigationTarget(items, 'safety', 'ArrowRight')).toBe('today');
    expect(getManagedTabNavigationTarget(items, 'money', 'Home')).toBe('today');
    expect(getManagedTabNavigationTarget(items, 'today', 'End')).toBe('safety');
  });
});

