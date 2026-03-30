import { describe, expect, it } from 'vitest';

import {
  buildRuntimeSwitchReadOnlyMessage,
  isRuntimeSwitchPermissionError,
  isRuntimeSwitchUnlockError,
} from '../src/shared/runtime/runtimeSwitchErrors';

describe('runtime switch error helpers', () => {
  it('detects unlock failures from backend details', () => {
    expect(isRuntimeSwitchUnlockError('X-Admin-Unlock bearer token is required.')).toBe(true);
    expect(isRuntimeSwitchUnlockError('admin session unlock required')).toBe(true);
  });

  it('detects permission-denied switch failures for read-only messaging', () => {
    expect(isRuntimeSwitchPermissionError('Missing permission: ops.mutate')).toBe(true);
    expect(isRuntimeSwitchPermissionError('403 Forbidden')).toBe(true);
  });

  it('builds explicit read-only messaging for runtime switch actions', () => {
    expect(buildRuntimeSwitchReadOnlyMessage('Prime')).toContain('read-only for this account');
    expect(buildRuntimeSwitchReadOnlyMessage('Prime')).toContain('ops.mutate required');
  });
});
