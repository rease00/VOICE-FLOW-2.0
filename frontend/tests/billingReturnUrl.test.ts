import { describe, expect, it, vi } from 'vitest';
import { buildBillingReturnUrl } from '../src/features/billing/hooks/useBillingActions';
import { consumeBillingReturnState } from '../components/account/billingReturnState';

describe('buildBillingReturnUrl', () => {
  const location = {
    origin: 'https://app.voiceflow.example',
    pathname: '/workspace',
  };

  it('builds success return URL for the public billing page', () => {
    const url = new URL(buildBillingReturnUrl('success', location));
    expect(url.origin).toBe('https://app.voiceflow.example');
    expect(url.pathname).toBe('/billing');
    expect(url.searchParams.get('tab')).toBe('subscription');
    expect(url.searchParams.get('billing')).toBe('success');
  });

  it('builds cancel return URL for the public billing page', () => {
    const url = new URL(buildBillingReturnUrl('cancel', location));
    expect(url.pathname).toBe('/billing');
    expect(url.searchParams.get('tab')).toBe('subscription');
    expect(url.searchParams.get('billing')).toBe('cancel');
  });

  it('builds portal return URL without transient billing state on the public billing page', () => {
    const url = new URL(buildBillingReturnUrl('none', location));
    expect(url.pathname).toBe('/billing');
    expect(url.searchParams.get('tab')).toBe('subscription');
    expect(url.searchParams.get('billing')).toBeNull();
  });

  it('routes VN pack returns back to the novel token tab', () => {
    const url = new URL(buildBillingReturnUrl('success', location, '/billing', 'vn'));
    expect(url.pathname).toBe('/billing');
    expect(url.searchParams.get('tab')).toBe('vn-packs');
    expect(url.searchParams.get('billing')).toBe('success');
  });
});

describe('consumeBillingReturnState', () => {
  it('consumes success token, refreshes billing data, and preserves profile billing routing params', async () => {
    const refreshBillingData = vi.fn(async () => undefined);
    const replaceUrl = vi.fn();
    const notify = vi.fn();
    const href = 'https://app.voiceflow.example/workspace?vf-screen=profile&vf-tab=billing&billing=success#billing';

    const state = await consumeBillingReturnState({
      href,
      search: '?vf-screen=profile&vf-tab=billing&billing=success',
      refreshBillingData,
      replaceUrl,
      notify,
    });

    expect(state).toBe('success');
    expect(refreshBillingData).toHaveBeenCalledTimes(1);
    expect(replaceUrl).toHaveBeenCalledWith('/workspace?vf-screen=profile&vf-tab=billing#billing');
    expect(notify).toHaveBeenCalledWith('success', true);
  });

  it('consumes cancel token without refresh and keeps profile billing routing params', async () => {
    const refreshBillingData = vi.fn(async () => undefined);
    const replaceUrl = vi.fn();
    const notify = vi.fn();

    const state = await consumeBillingReturnState({
      href: 'https://app.voiceflow.example/workspace?vf-screen=profile&vf-tab=billing&billing=cancel',
      search: '?vf-screen=profile&vf-tab=billing&billing=cancel',
      refreshBillingData,
      replaceUrl,
      notify,
    });

    expect(state).toBe('cancel');
    expect(refreshBillingData).not.toHaveBeenCalled();
    expect(replaceUrl).toHaveBeenCalledWith('/workspace?vf-screen=profile&vf-tab=billing');
    expect(notify).toHaveBeenCalledWith('cancel', false);
  });
});
