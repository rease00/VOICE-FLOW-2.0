import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchRoutingBackendCandidatesMock = vi.hoisted(() => vi.fn());
const issueTtsV2SessionKeyMock = vi.hoisted(() => vi.fn());
const resolveGeminiRegionSelectionMock = vi.hoisted(() => vi.fn());
const deriveGeminiRegionSelectionFromLocationMock = vi.hoisted(() => vi.fn());
const setGeminiRegionSelectionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/api/gatewayClient', () => ({
  fetchRoutingBackendCandidates: (...args: unknown[]) => fetchRoutingBackendCandidatesMock(...args),
  issueTtsV2SessionKey: (...args: unknown[]) => issueTtsV2SessionKeyMock(...args),
}));

vi.mock('../services/geminiRegionRouting', () => ({
  clearGeminiRegionSelection: vi.fn(),
  resolveGeminiRegionSelection: (...args: unknown[]) => resolveGeminiRegionSelectionMock(...args),
  deriveGeminiRegionSelectionFromLocation: (...args: unknown[]) => deriveGeminiRegionSelectionFromLocationMock(...args),
  setGeminiRegionSelection: (...args: unknown[]) => setGeminiRegionSelectionMock(...args),
}));

describe('applyNearestBackendRoutingOnLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const memoryStore = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => memoryStore.get(String(key)) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        memoryStore.set(String(key), String(value));
      }),
      removeItem: vi.fn((key: string) => {
        memoryStore.delete(String(key));
      }),
      clear: vi.fn(() => {
        memoryStore.clear();
      }),
    };
    vi.stubGlobal('window', { dispatchEvent: vi.fn() } as unknown as Window);
    vi.stubGlobal('sessionStorage', storage as unknown as Storage);
    vi.stubGlobal('localStorage', storage as unknown as Storage);
    resolveGeminiRegionSelectionMock.mockReturnValue({
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
    });
    deriveGeminiRegionSelectionFromLocationMock.mockImplementation((region: string, source: string) => ({
      regionHint: region,
      regionSource: source,
    }));
    fetchRoutingBackendCandidatesMock.mockImplementation(async () => ({
      ok: true,
      candidates: [],
      fetchedAt: new Date().toISOString(),
    }));
    issueTtsV2SessionKeyMock.mockResolvedValue('session-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries routing until a backend is successfully selected', async () => {
    const { applyNearestBackendRoutingOnLogin, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const first = await applyNearestBackendRoutingOnLogin();
    const second = await applyNearestBackendRoutingOnLogin();

    expect(first.reason).toBe('no_candidates');
    expect(second.reason).toBe('no_candidates');
    expect(fetchRoutingBackendCandidatesMock).toHaveBeenCalledTimes(2);
  });

  it('marks routing as complete only after a successful backend selection', async () => {
    fetchRoutingBackendCandidatesMock.mockResolvedValue({
      ok: true,
      selectedRegion: 'us-central1',
      selectedBaseUrl: 'https://voiceflow.example',
      candidates: [
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'us-central1',
          queueDepth: 1,
          oldestQueuedAgeMs: 250,
          capabilities: { supportsTts: true },
        },
      ],
      fetchedAt: new Date().toISOString(),
    });

    const { applyNearestBackendRoutingOnLogin, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const first = await applyNearestBackendRoutingOnLogin();
    const second = await applyNearestBackendRoutingOnLogin();

    expect(first.applied).toBe(true);
    expect(first.reason).toBe('switched');
    expect(second.reason).toBe('already_ran');
    expect(fetchRoutingBackendCandidatesMock).toHaveBeenCalledTimes(1);
  });

  it('primes a session key for the routed backend in the background path', async () => {
    fetchRoutingBackendCandidatesMock.mockResolvedValue({
      ok: true,
      selectedRegion: 'us-central1',
      selectedBaseUrl: 'https://voiceflow.example',
      candidates: [
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'us-central1',
          queueDepth: 1,
          oldestQueuedAgeMs: 250,
          capabilities: { supportsTts: true },
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
    resolveGeminiRegionSelectionMock.mockReturnValue({
      regionHint: 'us-central1',
      regionSource: 'login_auto_nearest',
    });

    const { applyNearestBackendRoutingOnLogin, primeLoginTtsSessionKey, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const routingResult = await applyNearestBackendRoutingOnLogin();
    const primeResult = await primeLoginTtsSessionKey({
      baseUrl: routingResult.baseUrl,
      regionHint: routingResult.regionHint,
      regionSource: routingResult.regionSource,
    });

    expect(primeResult.primed).toBe(true);
    expect(issueTtsV2SessionKeyMock).toHaveBeenCalledTimes(1);
    expect(issueTtsV2SessionKeyMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://voiceflow.example',
      probeAllSlotRegions: true,
      regionHint: 'us-central1',
      regionSource: 'login_auto_nearest',
    }));
  });

  it('prefers the healthiest candidate and persists the selected region hint', async () => {
    fetchRoutingBackendCandidatesMock.mockResolvedValue({
      ok: true,
      selectedRegion: 'us-central1',
      selectedBaseUrl: 'https://voiceflow.example',
      candidates: [
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'europe-west1',
          queueDepth: 6,
          oldestQueuedAgeMs: 1200,
          capabilities: { supportsTts: true },
        },
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'us-central1',
          queueDepth: 1,
          oldestQueuedAgeMs: 250,
          capabilities: { supportsTts: true },
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
    const { applyNearestBackendRoutingOnLogin, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const result = await applyNearestBackendRoutingOnLogin();

    expect(result.applied).toBe(true);
    expect(result.baseUrl).toBe('https://voiceflow.example');
    expect(deriveGeminiRegionSelectionFromLocationMock).toHaveBeenCalledWith('us-central1', 'login_auto_nearest');
    expect(setGeminiRegionSelectionMock).toHaveBeenCalledWith({
      regionHint: 'us-central1',
      regionSource: 'login_auto_nearest',
    });

    expect(fetchRoutingBackendCandidatesMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the lowest queue depth even when discovery answered from another region', async () => {
    fetchRoutingBackendCandidatesMock.mockResolvedValue({
      ok: true,
      selectedRegion: 'us-central1',
      selectedBaseUrl: 'https://voiceflow.example',
      candidates: [
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'us-central1',
          queueDepth: 8,
          oldestQueuedAgeMs: 2400,
          capabilities: { supportsTts: true },
        },
        {
          baseUrl: 'https://voiceflow.example',
          probeOk: true,
          healthy: true,
          region: 'europe-west1',
          queueDepth: 1,
          oldestQueuedAgeMs: 180,
          capabilities: { supportsTts: true },
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
    const { applyNearestBackendRoutingOnLogin, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const result = await applyNearestBackendRoutingOnLogin();

    expect(result.applied).toBe(true);
    expect(result.selectedRegion).toBe('europe-west1');
    expect(deriveGeminiRegionSelectionFromLocationMock).toHaveBeenCalledWith('europe-west1', 'login_auto_nearest');
    expect(setGeminiRegionSelectionMock).toHaveBeenCalledWith({
      regionHint: 'europe-west1',
      regionSource: 'login_auto_nearest',
    });

    expect(fetchRoutingBackendCandidatesMock).toHaveBeenCalledTimes(1);
  });
});
