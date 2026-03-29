import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useId, useMemo, useRef } from 'react';

export type ManagedTabKey = string;

export interface ManagedTabItem<T extends ManagedTabKey = ManagedTabKey> {
  id: T;
  disabled?: boolean;
}

const HORIZONTAL_PREV_KEYS = new Set(['ArrowLeft']);
const HORIZONTAL_NEXT_KEYS = new Set(['ArrowRight']);
const VERTICAL_PREV_KEYS = new Set(['ArrowUp']);
const VERTICAL_NEXT_KEYS = new Set(['ArrowDown']);

export const getManagedTabNavigationTarget = <T extends ManagedTabKey>(
  items: ManagedTabItem<T>[],
  activeId: T,
  key: string,
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): T | null => {
  const enabledItems = items.filter((item) => !item.disabled);
  if (!enabledItems.length) return null;

  const currentIndex = enabledItems.findIndex((item) => item.id === activeId);
  const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;

  if (key === 'Home') return enabledItems[0]?.id || null;
  if (key === 'End') return enabledItems[enabledItems.length - 1]?.id || null;

  const previousKeys = orientation === 'vertical' ? VERTICAL_PREV_KEYS : HORIZONTAL_PREV_KEYS;
  const nextKeys = orientation === 'vertical' ? VERTICAL_NEXT_KEYS : HORIZONTAL_NEXT_KEYS;

  if (previousKeys.has(key)) {
    const nextIndex = (fallbackIndex - 1 + enabledItems.length) % enabledItems.length;
    return enabledItems[nextIndex]?.id || null;
  }

  if (nextKeys.has(key)) {
    const nextIndex = (fallbackIndex + 1) % enabledItems.length;
    return enabledItems[nextIndex]?.id || null;
  }

  return null;
};

interface UseManagedTabsOptions<T extends ManagedTabKey> {
  items: ManagedTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  label: string;
  orientation?: 'horizontal' | 'vertical';
  idBase?: string;
}

export const useManagedTabs = <T extends ManagedTabKey>({
  items,
  activeId,
  onChange,
  label,
  orientation = 'horizontal',
  idBase,
}: UseManagedTabsOptions<T>) => {
  const reactId = useId();
  const baseId = useMemo(
    () => idBase || `tabs-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [idBase, reactId]
  );
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const focusTab = useCallback((tabId: T) => {
    const target = tabRefs.current[tabId];
    if (target) target.focus();
  }, []);

  const selectTab = useCallback((tabId: T) => {
    onChange(tabId);
    focusTab(tabId);
  }, [focusTab, onChange]);

  const getTabId = useCallback((tabId: T) => `${baseId}-tab-${tabId}`, [baseId]);
  const getPanelId = useCallback((tabId: T) => `${baseId}-panel-${tabId}`, [baseId]);

  const getTabProps = useCallback((tabId: T, disabled?: boolean) => {
    const itemDisabled = Boolean(items.find((item) => item.id === tabId)?.disabled);
    const tabDisabled = itemDisabled || Boolean(disabled);
    return {
      id: getTabId(tabId),
      role: 'tab' as const,
      'aria-selected': activeId === tabId,
      'aria-controls': getPanelId(tabId),
      tabIndex: activeId === tabId ? 0 : -1,
      disabled: tabDisabled,
      ref: (element: HTMLButtonElement | null) => {
        tabRefs.current[tabId] = element;
      },
      onClick: () => {
        if (tabDisabled) return;
        onChange(tabId);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (tabDisabled) return;
        const nextId = getManagedTabNavigationTarget(items, tabId, event.key, orientation);
        if (!nextId || nextId === tabId) return;
        event.preventDefault();
        selectTab(nextId);
      },
    };
  }, [activeId, getPanelId, getTabId, items, onChange, orientation, selectTab]);

  const getPanelProps = useCallback((tabId: T) => ({
    id: getPanelId(tabId),
    role: 'tabpanel' as const,
    'aria-labelledby': getTabId(tabId),
    hidden: activeId !== tabId,
    tabIndex: 0,
  }), [activeId, getPanelId, getTabId]);

  return {
    listProps: {
      role: 'tablist' as const,
      'aria-label': label,
      'aria-orientation': orientation,
    },
    getPanelId,
    getPanelProps,
    getTabId,
    getTabProps,
  };
};
