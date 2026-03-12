import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TAB_ORDER,
  DEFAULT_ACCOUNT_TAB,
  normalizeAccountTab,
  resolveAccountTabFromSearch,
  shouldKeepConversationSelection,
  shouldLazyLoadAccountTab,
} from '../components/account/accountCenterTabs';
import { getManagedTabNavigationTarget } from '../src/shared/ui/tabs';

describe('accountCenterTabs', () => {
  it('normalizes aliases into supported account tabs', () => {
    expect(normalizeAccountTab('overview')).toBe('account');
    expect(normalizeAccountTab('plan')).toBe('billing');
    expect(normalizeAccountTab('history')).toBe('account');
    expect(normalizeAccountTab('unknown')).toBe('account');
  });

  it('reads the active account tab from profile deep-link search params', () => {
    expect(resolveAccountTabFromSearch('?vf-screen=profile&vf-tab=support')).toBe('support');
    expect(resolveAccountTabFromSearch('?vf-screen=profile&vf-tab=usage')).toBe('usage');
    expect(resolveAccountTabFromSearch('?vf-screen=profile&vf-tab=weird')).toBe('account');
  });

  it('marks support as the only lazy tab', () => {
    expect(shouldLazyLoadAccountTab('support')).toBe(true);
    expect(shouldLazyLoadAccountTab('billing')).toBe(false);
    expect(shouldKeepConversationSelection('support')).toBe(true);
    expect(shouldKeepConversationSelection('activity')).toBe(false);
  });

  it('keeps the account section tab order and default tab contract', () => {
    expect(ACCOUNT_TAB_ORDER).toEqual(['account', 'billing', 'usage', 'preferences', 'support']);
    expect(DEFAULT_ACCOUNT_TAB).toBe('account');
    expect(ACCOUNT_TAB_ORDER[0]).toBe(DEFAULT_ACCOUNT_TAB);
  });

  it('supports keyboard navigation across account tabs', () => {
    const items = ACCOUNT_TAB_ORDER.map((id) => ({ id }));

    expect(getManagedTabNavigationTarget(items, 'account', 'ArrowRight')).toBe('billing');
    expect(getManagedTabNavigationTarget(items, 'support', 'ArrowRight')).toBe('account');
    expect(getManagedTabNavigationTarget(items, 'usage', 'ArrowLeft')).toBe('billing');
    expect(getManagedTabNavigationTarget(items, 'usage', 'Home')).toBe('account');
    expect(getManagedTabNavigationTarget(items, 'usage', 'End')).toBe('support');
  });
});
