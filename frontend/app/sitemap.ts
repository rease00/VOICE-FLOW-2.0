import type { MetadataRoute } from 'next';
import { getLegalDocuments } from '../src/landing/legal/legalContent';

const BASE_URL = 'https://v-flow-ai.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const legalRoutes = getLegalDocuments().map((document) => ({
    url: `${BASE_URL}${document.path}`,
    lastModified,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  return [
    {
      url: `${BASE_URL}/`,
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/landing`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/billing`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/legal`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...legalRoutes,
  ];
}
