export type BillingReturnState = 'success' | 'cancel';

export const resolveBillingReturnStateFromSearch = (search: string): BillingReturnState | null => {
  const token = String(new URLSearchParams(search).get('billing') || '').trim().toLowerCase();
  if (token === 'success') return 'success';
  if (token === 'cancel') return 'cancel';
  return null;
};

export const buildRelativeUrlWithoutBilling = (href: string): string => {
  const url = new URL(href);
  url.searchParams.delete('billing');
  return `${url.pathname}${url.search}${url.hash}`;
};

interface ConsumeBillingReturnStateArgs {
  href: string;
  search: string;
  refreshBillingData: () => Promise<void>;
  replaceUrl: (nextUrl: string) => void;
  notify: (state: BillingReturnState, refreshed: boolean) => void;
}

export const consumeBillingReturnState = async ({
  href,
  search,
  refreshBillingData,
  replaceUrl,
  notify,
}: ConsumeBillingReturnStateArgs): Promise<BillingReturnState | null> => {
  const state = resolveBillingReturnStateFromSearch(search);
  if (!state) return null;

  replaceUrl(buildRelativeUrlWithoutBilling(href));
  if (state === 'success') {
    let refreshed = false;
    try {
      await refreshBillingData();
      refreshed = true;
    } catch {
      refreshed = false;
    }
    notify(state, refreshed);
    return state;
  }

  notify(state, false);
  return state;
};
