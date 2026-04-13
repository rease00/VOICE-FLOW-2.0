import { redirect } from 'next/navigation';
import {
  resolveLegacyReaderRedirect,
  type LegacyReaderSearchParams,
} from '../../../../../src/app/legacyReaderRedirect';

type ReaderAliasSlugPageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams?: Promise<LegacyReaderSearchParams>;
};

export default async function ReaderAliasSlugPage({ params, searchParams }: ReaderAliasSlugPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  redirect(resolveLegacyReaderRedirect(resolvedParams.slug, resolvedSearchParams));
}
