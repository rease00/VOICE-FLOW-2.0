import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'V FLOW AI — Voice Studio & Reader',
    short_name: 'V FLOW AI',
    description:
      'Premium AI voice studio — TTS, dubbing, multi-speaker reader. Create, listen, and share voice experiences.',
    start_url: '/app/studio',
    scope: '/',
    id: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'portrait-primary',
    background_color: '#0A0B14',
    theme_color: '#7C5CFF',
    categories: ['productivity', 'music', 'education', 'entertainment'],
    prefer_related_applications: false,
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Open Studio',
        short_name: 'Studio',
        description: 'Create AI voice content',
        url: '/app/studio',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
      {
        name: 'Open Reader',
        short_name: 'Reader',
        description: 'Listen to audio novels',
        url: '/app/reader',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
      {
        name: 'My Library',
        short_name: 'Library',
        description: 'Browse your voice library',
        url: '/app/library',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
    ],
  };
}
