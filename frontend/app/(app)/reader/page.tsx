import { redirect } from 'next/navigation';

type ReaderAliasSearchParams = Record<string, string | string[] | undefined>;

type ReaderAliasPageProps = {
  searchParams?: Promise<ReaderAliasSearchParams>;
};

const serializeSearchParams = (searchParams: ReaderAliasSearchParams | undefined): string => {
  const params = new URLSearchParams();
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        const safeEntry = String(entry || '').trim();
        if (safeEntry) params.append(key, safeEntry);
      });
      return;
    }
    const safeValue = String(value || '').trim();
    if (safeValue) params.set(key, safeValue);
  });
  return params.toString();
};

export default async function ReaderAliasPage({ searchParams }: ReaderAliasPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = serializeSearchParams(resolvedSearchParams);
  redirect(query ? `/app/reader?${query}` : '/app/reader');
}
