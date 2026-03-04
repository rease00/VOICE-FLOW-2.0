import { describe, expect, it } from 'vitest';
import { toCompactToastCopy, toUserMessage, truncateForToast } from './format';

describe('notification format helpers', () => {
  it('maps raw backend and network errors to user-friendly copy', () => {
    expect(
      toUserMessage('Cannot reach backend at http://127.0.0.1:7800 (CORS)', 'Backend unreachable')
    ).toContain('Cannot connect to service right now');
    expect(toUserMessage('Firebase: Error (auth/network-request-failed).', 'Auth failed')).toContain(
      'Cannot connect to service right now'
    );
    expect(toUserMessage('Request timeout after 60000ms', 'Request failed')).toContain(
      'request took too long'
    );
  });

  it('passes through non-technical messages', () => {
    expect(toUserMessage('Coupon applied successfully.', 'Fallback')).toBe('Coupon applied successfully.');
  });

  it('redacts infrastructure/provider details from profile save errors', () => {
    const raw =
      'Failed to save user profile: 403 Cloud Firestore API has not been used in project voiceflow-000f. reason: SERVICE_DISABLED firestore.googleapis.com';
    expect(toUserMessage(raw, 'Could not save user ID.')).toContain('Profile service is temporarily unavailable');
  });

  it('enforces compact toast title/message limits', () => {
    const title = truncateForToast('A'.repeat(90), 42);
    const message = truncateForToast('B'.repeat(220), 110);
    expect(title.length).toBeLessThanOrEqual(42);
    expect(message.length).toBeLessThanOrEqual(110);

    const compact = toCompactToastCopy('Title', 'Message');
    expect(compact.title).toBe('Title');
    expect(compact.message).toBe('Message');
  });
});
