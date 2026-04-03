import { redirect } from 'next/navigation';

type ReaderAliasSlugPageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const serializeSearchParams = (searchParams: Record<string, string | string[] | undefined> | undefined): string => {
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

export default async function ReaderAliasSlugPage({ params, searchParams }: ReaderAliasSlugPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const slugPath = (resolvedParams.slug || [])
    .map((segment) => encodeURIComponent(String(segment || '').trim()))
    .filter(Boolean)
    .join('/');
  const pathname = slugPath ? `/app/reader/${slugPath}` : '/app/reader';
  const query = serializeSearchParams(resolvedSearchParams);
  redirect(query ? `${pathname}?${query}` : pathname);
}
