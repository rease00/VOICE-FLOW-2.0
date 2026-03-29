import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchRoutingBackendCandidatesMock = vi.hoisted(() => vi.fn());
const issueTtsV2SessionKeyMock = vi.hoisted(() => vi.fn());
const resolveGeminiRegionSelectionMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/api/gatewayClient', () => ({
  fetchRoutingBackendCandidates: (...args: unknown[]) => fetchRoutingBackendCandidatesMock(...args),
  issueTtsV2SessionKey: (...args: unknown[]) => issueTtsV2SessionKeyMock(...args),
}));

vi.mock('../services/geminiRegionRouting', () => ({
  clearGeminiRegionSelection: vi.fn(),
  deriveGeminiRegionSelectionFromLocation: vi.fn(),
  resolveGeminiRegionSelection: (...args: unknown[]) => resolveGeminiRegionSelectionMock(...args),
  setGeminiRegionSelection: vi.fn(),
}));

describe('bootstrapLoginSeasonPinning', () => {
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

  it('runs routing first, then issues a forced session once per login session', async () => {
    const callOrder: string[] = [];
    fetchRoutingBackendCandidatesMock.mockImplementation(async () => {
      callOrder.push('routing');
      return {
        ok: true,
        candidates: [],
        fetchedAt: new Date().toISOString(),
      };
    });
    issueTtsV2SessionKeyMock.mockImplementation(async () => {
      callOrder.push('session');
      return 'session-key';
    });

    const { bootstrapLoginSeasonPinning, clearNearestBackendRoutingState } = await import('../services/backendRoutingService');
    clearNearestBackendRoutingState();

    const first = await bootstrapLoginSeasonPinning();
    const second = await bootstrapLoginSeasonPinning();

    expect(first.sessionIssued).toBe(true);
    expect(first.sessionKey).toBe('session-key');
    expect(second.sessionIssued).toBe(false);
    expect(second.sessionReason).toBe('already_ran');
    expect(fetchRoutingBackendCandidatesMock).toHaveBeenCalledTimes(1);
    expect(issueTtsV2SessionKeyMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['routing', 'session']);

    const [issueOptions] = issueTtsV2SessionKeyMock.mock.calls[0] as [Record<string, unknown>];
    expect(issueOptions).toMatchObject({
      force: true,
      probeAllSlotRegions: true,
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
    });
  });
});
