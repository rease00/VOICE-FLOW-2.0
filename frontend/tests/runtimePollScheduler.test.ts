import { describe, expect, it } from 'vitest';
import { resolveRuntimePollMode } from '../src/shared/runtime/runtimePollScheduler';

describe('resolveRuntimePollMode', () => {
  it('ignores session identity and only gates on visibility and leadership', () => {
    expect(
      resolveRuntimePollMode({
        nowMs: 1000,
        isBusy: true,
        activeUntilMs: 0,
        cooldownUntilMs: 0,
        isVisible: true,
        isLeader: true,
      })
    ).toBe('active');
    expect(
      resolveRuntimePollMode({
        nowMs: 1000,
        isBusy: false,
        activeUntilMs: 0,
        cooldownUntilMs: 0,
        isVisible: false,
        isLeader: true,
      })
    ).toBe('none');
  });

  it('returns active while busy or within active window', () => {
    expect(
      resolveRuntimePollMode({
        nowMs: 1000,
        isBusy: true,
        activeUntilMs: 0,
        cooldownUntilMs: 0,
        isVisible: true,
        isLeader: true,
      })
    ).toBe('active');
    expect(
      resolveRuntimePollMode({
        nowMs: 1000,
        isBusy: false,
        activeUntilMs: 2000,
        cooldownUntilMs: 0,
        isVisible: true,
        isLeader: true,
      })
    ).toBe('active');
  });

  it('returns cooldown after activity and none after window expires', () => {
    expect(
      resolveRuntimePollMode({
        nowMs: 2000,
        isBusy: false,
        activeUntilMs: 1000,
        cooldownUntilMs: 4000,
        isVisible: true,
        isLeader: true,
      })
    ).toBe('cooldown');
    expect(
      resolveRuntimePollMode({
        nowMs: 5000,
        isBusy: false,
        activeUntilMs: 1000,
        cooldownUntilMs: 4000,
        isVisible: true,
        isLeader: true,
      })
    ).toBe('none');
  });

  it('returns none for follower tabs', () => {
    expect(
      resolveRuntimePollMode({
        nowMs: 1000,
        isBusy: true,
        activeUntilMs: 0,
        cooldownUntilMs: 0,
        isVisible: true,
        isLeader: false,
      })
    ).toBe('none');
  });
});
