import { describe, expect, it } from 'vitest';
import { createStudioObjectUrlRegistry } from '../services/studioObjectUrlRegistry';

describe('createStudioObjectUrlRegistry', () => {
  it('revokes the previous blob URL when replacing generated output', () => {
    const revoked: string[] = [];
    const registry = createStudioObjectUrlRegistry({
      revokeObjectUrl: (url) => {
        revoked.push(url);
      },
    });

    registry.replace('blob:old-audio', 'blob:new-audio');

    expect(revoked).toEqual(['blob:old-audio']);
    expect(registry.getTrackedCount()).toBe(1);
  });

  it('does not revoke when replacing a blob URL with itself', () => {
    const revoked: string[] = [];
    const registry = createStudioObjectUrlRegistry({
      revokeObjectUrl: (url) => {
        revoked.push(url);
      },
    });

    registry.replace('blob:same-audio', 'blob:same-audio');

    expect(revoked).toEqual([]);
    expect(registry.getTrackedCount()).toBe(1);
  });

  it('keeps only visible history and pinned URLs during reconciliation', () => {
    const revoked: string[] = [];
    const registry = createStudioObjectUrlRegistry({
      revokeObjectUrl: (url) => {
        revoked.push(url);
      },
    });

    registry.register('blob:h1');
    registry.register('blob:h2');
    registry.register('blob:generated');

    registry.reconcile(['blob:h2'], ['blob:generated']);

    expect(revoked).toEqual(['blob:h1']);
    expect(registry.getTrackedCount()).toBe(2);
  });

  it('reclaims evicted history URLs over repeated generations', () => {
    const revoked: string[] = [];
    const created: string[] = [];
    const registry = createStudioObjectUrlRegistry({
      maxTracked: 10,
      revokeObjectUrl: (url) => {
        revoked.push(url);
      },
    });

    let visibleHistory: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const url = `blob:history-${index}`;
      created.push(url);
      visibleHistory = [url, ...visibleHistory].slice(0, 5);
      registry.reconcile(visibleHistory, []);
    }

    expect(registry.getTrackedCount()).toBe(5);
    expect(revoked.length).toBe(created.length - 5);
  });
});
