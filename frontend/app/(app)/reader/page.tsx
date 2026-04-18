import { redirect } from 'next/navigation';
import {
  resolveLegacyReaderRedirect,
  type LegacyReaderSearchParams,
} from '../../../src/app/legacyReaderRedirect';

type ReaderAliasPageProps = {
  searchParams?: Promise<LegacyReaderSearchParams>;
};

export default async function ReaderAliasPage({ searchParams }: ReaderAliasPageProps) {
  const resolvedSearchParams = await searchParams;
  redirect(resolveLegacyReaderRedirect(undefined, resolvedSearchParams));
}
