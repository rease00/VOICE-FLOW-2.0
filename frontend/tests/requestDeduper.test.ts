import { describe, expect, it, vi } from 'vitest';
import { fetchWithRequestDedup } from '../src/shared/api/requestDeduper';

const createDeferredResponse = () => {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('fetchWithRequestDedup', () => {
  it('dedupes concurrent GET requests when callers use different abort signals', async () => {
    const deferred = createDeferredResponse();
    const fetchMock = vi.fn(async () => deferred.promise);
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const first = fetchWithRequestDedup('/api/runtime/status', { signal: controllerA.signal }, fetchMock as typeof fetch);
    const second = fetchWithRequestDedup('/api/runtime/status', { signal: controllerB.signal }, fetchMock as typeof fetch);

    controllerA.abort();
    deferred.resolve(new Response('ok', { status: 200 }));

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second.then((response) => response.text())).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps in-flight coalescing after one caller aborts before response settles', async () => {
    const deferred = createDeferredResponse();
    const fetchMock = vi.fn(async () => deferred.promise);
    const controllerA = new AbortController();
    const controllerB = new AbortController();

    const first = fetchWithRequestDedup('/api/runtime/status', { signal: controllerA.signal }, fetchMock as typeof fetch);
    controllerA.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });

    const second = fetchWithRequestDedup('/api/runtime/status', { signal: controllerB.signal }, fetchMock as typeof fetch);
    deferred.resolve(new Response('ok', { status: 200 }));

    await expect(second.then((response) => response.text())).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns cloned responses for deduped consumers', async () => {
    const fetchMock = vi.fn(async () => new Response('payload', { status: 200 }));
    const first = fetchWithRequestDedup('/api/metrics', undefined, fetchMock as typeof fetch);
    const second = fetchWithRequestDedup('/api/metrics', undefined, fetchMock as typeof fetch);

    await expect(first.then((response) => response.text())).resolves.toBe('payload');
    await expect(second.then((response) => response.text())).resolves.toBe('payload');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
