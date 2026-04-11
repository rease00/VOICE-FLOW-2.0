import { resolveApiBaseUrl } from '../src/shared/api/config';

export const BACKEND_ROUTING_APPLIED_EVENT = 'vf:backend-routing-applied';

export interface BackendRoutingPrimeResult {
  applied: boolean;
  reason: string;
  baseUrl: string;
}

export const primeLoginRoutingAfterAccountBootstrap = async (
  input: { baseUrl?: string } = {}
): Promise<BackendRoutingPrimeResult> => {
  const baseUrl = resolveApiBaseUrl(input.baseUrl);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BACKEND_ROUTING_APPLIED_EVENT, {
        detail: {
          baseUrl,
          source: 'account_bootstrap',
        },
      }),
    );
  }

  return {
    applied: false,
    reason: 'base_url_confirmed',
    baseUrl,
  };
};

