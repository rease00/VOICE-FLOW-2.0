import { describe, expect, it } from 'vitest';

import {
  ADMIN_REFRESH_ALL_SECTIONS,
  getAdminSectionsToLoad,
  resolveAdminSectionsForView,
} from '../src/features/admin/model/loadPlan';
import { resolveAdminOpsTabFromUrl } from '../src/app/workspace/mainAppHelpers';

describe('admin load plan', () => {
  it('loads only the users section for the users tab by default', () => {
    expect(resolveAdminSectionsForView('users', 'usage')).toEqual(['users', 'userTimeline']);
  });

  it('keeps money overview fast and loads heavy accounting sections only for the accounting subview', () => {
    expect(resolveAdminSectionsForView('money', 'accounting', { moneyView: 'overview' })).toEqual(['moneySummary']);
    expect(resolveAdminSectionsForView('money', 'accounting', { moneyView: 'accounting' })).toEqual([
      'moneySummary',
      'analytics',
      'accounting',
      'dailyReset',
    ]);
  });

  it('avoids refetching already-loaded sections unless force refresh is requested', () => {
    const loadedSections = new Set(['moneySummary', 'analytics']);

    expect(
      getAdminSectionsToLoad(loadedSections, resolveAdminSectionsForView('money', 'accounting', { moneyView: 'accounting' }))
    ).toEqual(['accounting', 'dailyReset']);

    expect(getAdminSectionsToLoad(['users'], ADMIN_REFRESH_ALL_SECTIONS, true)).toEqual(
      [...ADMIN_REFRESH_ALL_SECTIONS]
    );
  });

  it('accepts accounting from the admin deep-link tab parser', () => {
    const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'http://localhost/?vf-admin-tab=accounting',
          search: '?vf-admin-tab=accounting',
        },
      },
    });
    try {
      expect(resolveAdminOpsTabFromUrl()).toBe('accounting');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
