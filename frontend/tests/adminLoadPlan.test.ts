import { describe, expect, it } from 'vitest';
import {
  ADMIN_REFRESH_ALL_SECTIONS,
  getAdminSectionsToLoad,
  resolveAdminSectionsForView,
} from '../src/features/admin/model/loadPlan';
import { resolveAdminOpsTabFromUrl } from '../src/app/workspace/mainAppHelpers';

describe('admin load plan', () => {
  it('loads only the users section for the default admin tab', () => {
    expect(resolveAdminSectionsForView('users', 'usage')).toEqual(['users']);
  });

  it('loads a tab once and avoids refetching already-loaded sections', () => {
    const loadedSections = new Set<'users' | 'supportConversations' | 'supportAiPolicy' | 'adminNotices' | 'adminUnlockStatus'>(['users']);

    expect(
      getAdminSectionsToLoad(loadedSections, resolveAdminSectionsForView('messages', 'usage'))
    ).toEqual(['supportConversations', 'supportAiPolicy', 'adminNotices', 'adminUnlockStatus']);

    loadedSections.add('supportConversations');
    loadedSections.add('supportAiPolicy');
    loadedSections.add('adminNotices');
    loadedSections.add('adminUnlockStatus');

    expect(
      getAdminSectionsToLoad(loadedSections, resolveAdminSectionsForView('messages', 'usage'))
    ).toEqual([]);
  });

  it('forces a full refresh and keeps audit/audio metadata grouped under the audit ops tab', () => {
    expect(resolveAdminSectionsForView('ops', 'audit')).toEqual(['audit', 'audioMetadata']);
    expect(resolveAdminSectionsForView('ops', 'accounting')).toEqual(['accounting']);
    expect(resolveAdminSectionsForView('messages', 'usage')).toEqual([
      'supportConversations',
      'supportAiPolicy',
      'adminNotices',
      'adminUnlockStatus',
    ]);
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
