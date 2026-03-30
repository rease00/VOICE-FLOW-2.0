import { describe, expect, it } from 'vitest';
import { classifyUnhandledRejection } from './AppErrorBoundary';

describe('classifyUnhandledRejection', () => {
  it('treats fetch and network failures as recoverable transient errors', () => {
    const recovery = classifyUnhandledRejection(new Error('Failed to fetch resource from backend'));

    expect(recovery?.kind).toBe('transient');
    expect(recovery?.telemetryReason).toBe('network');
    expect(recovery?.title).toBe('Connection Issue');
    expect(recovery?.dedupeKey).toBe('unhandled-rejection-transient-network');
  });

  it('treats abort errors as recoverable without showing the crash fallback', () => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';

    const recovery = classifyUnhandledRejection(error);

    expect(recovery?.kind).toBe('transient');
    expect(recovery?.telemetryReason).toBe('abort');
    expect(recovery?.title).toBe('Request Cancelled');
    expect(recovery?.dedupeKey).toBe('unhandled-rejection-transient-abort');
  });

  it('treats background poll failures as recoverable transient errors', () => {
    const recovery = classifyUnhandledRejection(new Error('poll_failed: status polling lost connection'));

    expect(recovery?.kind).toBe('transient');
    expect(recovery?.telemetryReason).toBe('background');
    expect(recovery?.title).toBe('Background Task Interrupted');
    expect(recovery?.dedupeKey).toBe('unhandled-rejection-transient-background');
  });

  it('keeps unrelated failures fatal so the crash fallback can still appear', () => {
    expect(classifyUnhandledRejection(new Error('Validation failed'))).toBeNull();
  });
});
