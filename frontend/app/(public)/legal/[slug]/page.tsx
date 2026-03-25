import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalCenter } from '../../../../src/landing/legal/LegalCenter';
import { getLegalDocuments, resolveLegalDocument } from '../../../../src/landing/legal/legalContent';

interface LegalDocPageProps {
  params: Promise<{ slug: string }>;
}

const resolveSlug = async (params: LegalDocPageProps['params']): Promise<string> => {
  const resolved = await params;
  return String(resolved.slug || '').trim().toLowerCase();
};

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  return getLegalDocuments().map((document) => ({ slug: document.id }));
}

export async function generateMetadata({ params }: LegalDocPageProps): Promise<Metadata> {
  const slug = await resolveSlug(params);
  const document = resolveLegalDocument(`/legal/${slug}`);
  if (!document) {
    return {
      title: 'VoiceFlow Legal Center',
      description: 'VoiceFlow policy center for terms, privacy, cookies, billing, and acceptable-use documents.',
    };
  }
  return {
    title: `${document.title} | VoiceFlow`,
    description: document.description,
    alternates: {
      canonical: document.path,
    },
  };
}

export default async function LegalDocumentPage({ params }: LegalDocPageProps) {
  const slug = await resolveSlug(params);
  const document = resolveLegalDocument(`/legal/${slug}`);
  if (!document) notFound();
  return <LegalCenter activeDocument={document} />;
}
