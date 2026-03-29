import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getManagedTabNavigationTarget, type ManagedTabItem, useManagedTabs } from './tabs';

describe('getManagedTabNavigationTarget', () => {
  const items: ManagedTabItem<'import' | 'settings' | 'translator' | 'cast'>[] = [
    { id: 'import' },
    { id: 'settings' },
    { id: 'translator', disabled: true },
    { id: 'cast' },
  ];

  it('moves horizontally and skips disabled tabs', () => {
    expect(getManagedTabNavigationTarget(items, 'import', 'ArrowRight')).toBe('settings');
    expect(getManagedTabNavigationTarget(items, 'settings', 'ArrowRight')).toBe('cast');
    expect(getManagedTabNavigationTarget(items, 'cast', 'ArrowRight')).toBe('import');
  });

  it('moves backward and supports home/end', () => {
    expect(getManagedTabNavigationTarget(items, 'settings', 'ArrowLeft')).toBe('import');
    expect(getManagedTabNavigationTarget(items, 'import', 'End')).toBe('cast');
    expect(getManagedTabNavigationTarget(items, 'cast', 'Home')).toBe('import');
  });

  it('supports vertical navigation', () => {
    expect(getManagedTabNavigationTarget(items, 'import', 'ArrowDown', 'vertical')).toBe('settings');
    expect(getManagedTabNavigationTarget(items, 'settings', 'ArrowUp', 'vertical')).toBe('import');
  });

  it('ignores unrelated keys', () => {
    expect(getManagedTabNavigationTarget(items, 'import', 'Enter')).toBeNull();
  });

  it('matches the account side-nav vertical order', () => {
    const accountItems: ManagedTabItem<'account' | 'billing' | 'usage' | 'preferences' | 'support' | 'activity'>[] = [
      { id: 'account' },
      { id: 'billing' },
      { id: 'usage' },
      { id: 'preferences' },
      { id: 'support' },
      { id: 'activity' },
    ];

    expect(getManagedTabNavigationTarget(accountItems, 'account', 'ArrowDown', 'vertical')).toBe('billing');
    expect(getManagedTabNavigationTarget(accountItems, 'activity', 'ArrowDown', 'vertical')).toBe('account');
    expect(getManagedTabNavigationTarget(accountItems, 'usage', 'Home', 'vertical')).toBe('account');
    expect(getManagedTabNavigationTarget(accountItems, 'usage', 'End', 'vertical')).toBe('activity');
  });

  it('matches the admin coupon and ops tab order', () => {
    const couponItems: ManagedTabItem<'wallet_credit' | 'subscription_discount'>[] = [
      { id: 'wallet_credit' },
      { id: 'subscription_discount' },
    ];
    const opsItems: ManagedTabItem<'usage' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics'>[] = [
      { id: 'usage' },
      { id: 'guardian' },
      { id: 'alerts' },
      { id: 'scheduler' },
      { id: 'audit' },
      { id: 'analytics' },
    ];

    expect(getManagedTabNavigationTarget(couponItems, 'wallet_credit', 'ArrowRight')).toBe('subscription_discount');
    expect(getManagedTabNavigationTarget(couponItems, 'subscription_discount', 'ArrowRight')).toBe('wallet_credit');
    expect(getManagedTabNavigationTarget(opsItems, 'guardian', 'ArrowRight')).toBe('alerts');
    expect(getManagedTabNavigationTarget(opsItems, 'usage', 'ArrowLeft')).toBe('analytics');
  });

  it('inherits disabled state from items when getTabProps omits disabled', () => {
    const Probe = () => {
      const managedTabs = useManagedTabs({
        items: [
          { id: 'first', disabled: true },
          { id: 'second' },
        ],
        activeId: 'second',
        onChange: () => undefined,
        label: 'Probe tabs',
        idBase: 'probe-tabs',
      });
      return React.createElement(
        'div',
        null,
        React.createElement('button', { type: 'button', ...managedTabs.getTabProps('first') }, 'First'),
        React.createElement('button', { type: 'button', ...managedTabs.getTabProps('second') }, 'Second')
      );
    };
    const markup = renderToStaticMarkup(React.createElement(Probe));
    expect(markup).toMatch(/id="probe-tabs-tab-first"[^>]*disabled=""/);
    expect(markup).toContain('id="probe-tabs-tab-second"');
  });

  it('does not re-enable an item-disabled tab when disabled=false is passed', () => {
    const Probe = () => {
      const managedTabs = useManagedTabs({
        items: [
          { id: 'first', disabled: true },
          { id: 'second' },
        ],
        activeId: 'second',
        onChange: () => undefined,
        label: 'Probe tabs override',
        idBase: 'probe-tabs-override',
      });
      return React.createElement(
        'div',
        null,
        React.createElement('button', { type: 'button', ...managedTabs.getTabProps('first', false) }, 'First'),
        React.createElement('button', { type: 'button', ...managedTabs.getTabProps('second') }, 'Second')
      );
    };
    const markup = renderToStaticMarkup(React.createElement(Probe));
    expect(markup).toMatch(/id="probe-tabs-override-tab-first"[^>]*disabled=""/);
  });
});
