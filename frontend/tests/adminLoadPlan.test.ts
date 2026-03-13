import { describe, expect, it } from 'vitest';
import {
  ADMIN_REFRESH_ALL_SECTIONS,
  getAdminSectionsToLoad,
  resolveAdminSectionsForView,
} from '../src/features/admin/model/loadPlan';

describe('admin load plan', () => {
  it('loads only the users section for the default admin tab', () => {
    expect(resolveAdminSectionsForView('users', 'usage')).toEqual(['users']);
  });

  it('loads a tab once and avoids refetching already-loaded sections', () => {
    const loadedSections = new Set<'users' | 'supportConversations' | 'supportAiPolicy'>(['users']);

    expect(
      getAdminSectionsToLoad(loadedSections, resolveAdminSectionsForView('messages', 'usage'))
    ).toEqual(['supportConversations', 'supportAiPolicy']);

    loadedSections.add('supportConversations');
    loadedSections.add('supportAiPolicy');

    expect(
      getAdminSectionsToLoad(loadedSections, resolveAdminSectionsForView('messages', 'usage'))
    ).toEqual([]);
  });

  it('forces a full refresh and keeps audit/audio metadata grouped under the audit ops tab', () => {
    expect(resolveAdminSectionsForView('ops', 'audit')).toEqual(['audit', 'audioMetadata']);
    expect(resolveAdminSectionsForView('ops', 'accounting')).toEqual(['accounting']);
    expect(getAdminSectionsToLoad(['users'], ADMIN_REFRESH_ALL_SECTIONS, true)).toEqual(
      [...ADMIN_REFRESH_ALL_SECTIONS]
    );
  });
});
