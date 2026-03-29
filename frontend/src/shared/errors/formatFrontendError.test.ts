import { describe, expect, it } from 'vitest';
import { formatFrontendError } from './formatFrontendError';

describe('formatFrontendError', () => {
  it('maps network and CORS failures to friendly public copy', () => {
    expect(
      formatFrontendError('Cannot reach backend at http://127.0.0.1:7800 (CORS)', {
        fallback: 'Backend unreachable.',
        context: 'runtime',
      }).publicMessage
    ).toContain('Cannot connect');
  });

  it('maps timeout failures to retry-friendly copy', () => {
    expect(
      formatFrontendError('Request timeout after 60000ms', {
        fallback: 'Request failed.',
        context: 'generation',
      }).publicMessage.toLowerCase()
    ).toContain('too long');
  });

  it('handles auth and profile gating without leaking backend details', () => {
    expect(
      formatFrontendError('Missing bearer token for request.', {
        fallback: 'Auth failed.',
        context: 'auth',
      }).publicMessage
    ).toContain('sign in again');

    expect(
      formatFrontendError('requiredUserId: complete your user id before continuing', {
        fallback: 'Profile incomplete.',
        context: 'auth',
      }).publicMessage
    ).toContain('Complete your user ID setup');

    expect(
      formatFrontendError('Forbidden', {
        fallback: 'Auth failed.',
        context: 'auth',
      }).publicMessage
    ).toContain('restricted');

    expect(
      formatFrontendError('Firebase: Error (auth/user-not-found).', {
        fallback: 'Auth failed.',
        context: 'auth',
      }).publicMessage
    ).toContain('sign in again');

    expect(
      formatFrontendError('FirebaseError: permission-denied', {
        fallback: 'Auth failed.',
        context: 'auth',
      }).publicMessage
    ).toContain('restricted');
  });

  it('maps quota and billing failures to clean user-facing copy', () => {
    expect(
      formatFrontendError('Quota exceeded: too many requests (status code 429).', {
        fallback: 'Generation failed.',
        context: 'generation',
      }).publicMessage
    ).toContain('temporarily rate-limited');

    expect(
      formatFrontendError('Billing portal URL is missing.', {
        fallback: 'Billing failed.',
        context: 'billing',
      }).publicMessage
    ).toContain('Billing is temporarily unavailable');
  });

  it('suppresses JSON blobs, trace ids, and service-internal payloads for non-admin users', () => {
    const formatted = formatFrontendError(
      '{"detail":"Long-text synthesis failed","trace_id":"abc123","backend":"http://localhost:7810"}',
      {
        fallback: 'Generation failed.',
        context: 'generation',
      }
    );

    expect(formatted.publicMessage).toBe('Generation failed.');
    expect(formatted.adminDetails).toBeUndefined();
  });

  it('preserves diagnostics for admins without using them as the primary message', () => {
    const formatted = formatFrontendError(
      'Long-text synthesis failed (trace_id=abc123, backend=http://localhost:7810, status code 503)',
      {
        fallback: 'Generation failed.',
        context: 'generation',
        isAdmin: true,
      }
    );

    expect(formatted.publicMessage).toBe('Generation failed.');
    expect(formatted.adminDetails).toContain('trace_id=abc123');
    expect(formatted.adminDetails).toContain('localhost:7810');
  });

  it('passes through safe non-technical copy unchanged', () => {
    expect(
      formatFrontendError('Coupon applied successfully.', {
        fallback: 'Fallback',
        context: 'billing',
      }).publicMessage
    ).toBe('Coupon applied successfully.');
  });

  it('maps normalized live scheduler and polling codes to friendly copy', () => {
    const rpmError = new Error('Generation failed: capacity pressure') as Error & { detail?: unknown };
    rpmError.detail = { code: 'rpm_exhausted', reason: 'capacity_pressure' };

    expect(
      formatFrontendError(rpmError, {
        fallback: 'Generation failed.',
        context: 'generation',
      }).publicMessage
    ).toContain('rate-limited');

    expect(
      formatFrontendError(
        { detail: { code: 'chunk_gap_blocked', reason: 'structured_chunk_missing' } },
        {
          fallback: 'Generation failed.',
          context: 'generation',
        }
      ).publicMessage
    ).toContain('earlier chunk');

    expect(
      formatFrontendError(
        { detail: { code: 'poll_failed', message: 'status polling lost connection' } },
        {
          fallback: 'Generation failed.',
          context: 'generation',
        }
      ).publicMessage
    ).toContain('status stream');

    const sessionError = new Error('Unified session runtime failed.') as Error & { detail?: unknown };
    sessionError.detail = {
      code: 'session_migration_failed',
      message: 'A saved live session could not be restored cleanly. Please start a fresh run.',
      statusCode: 404,
    };

    expect(
      formatFrontendError(sessionError, {
        fallback: 'Generation failed.',
        context: 'generation',
      }).publicMessage
    ).toBe('A saved live session could not be restored cleanly. Please start a fresh run.');
  });

  it('does not pass through raw chunk/runtime failure tokens', () => {
    const formatted = formatFrontendError('Vector runtime synthesis failed: chunk_failed', {
      fallback: 'Generation failed.',
      context: 'generation',
    });
    expect(formatted.publicMessage).toContain('runtime');
    expect(formatted.publicMessage.toLowerCase()).not.toContain('chunk_failed');
  });
});
