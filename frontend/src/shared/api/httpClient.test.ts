import { describe, expect, it } from 'vitest';
import { parseResponseError } from './httpClient';

describe('httpClient error parsing', () => {
  it('redacts provider infrastructure details from API error payloads', async () => {
    const response = new Response(
      JSON.stringify({
        detail:
          'Failed to save user profile: 403 Cloud Firestore API has not been used in project voiceflow-000f. reason: SERVICE_DISABLED firestore.googleapis.com',
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const error = await parseResponseError(response);
    expect(error.detail).toContain('temporarily unavailable');
    expect(error.detail.toLowerCase()).not.toContain('googleapis.com');
    expect(error.detail.toLowerCase()).not.toContain('firestore.googleapis.com');
  });

  it('preserves safe user-facing conflict messages', async () => {
    const response = new Response(
      JSON.stringify({
        detail: 'userId already exists.',
      }),
      {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const error = await parseResponseError(response);
    expect(error.detail).toBe('userId already exists.');
  });

  it('extracts readable text from object-shaped detail payloads', async () => {
    const response = new Response(
      JSON.stringify({
        detail: {
          error: 'request_id is already associated with a different user.',
          errorCode: 'REQUEST_ID_CONFLICT',
          reason: 'request_id_owner_conflict',
        },
      }),
      {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const error = await parseResponseError(response);
    expect(error.detail).toContain('request_id is already associated with a different user.');
    expect(error.detail).toContain('REQUEST_ID_CONFLICT');
    expect(error.detail).not.toContain('[object Object]');
  });
});
