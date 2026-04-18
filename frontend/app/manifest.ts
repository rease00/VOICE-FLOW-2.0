import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Voice Flow Studio',
    short_name: 'Voice Flow',
    description:
      'Premium AI voice studio — TTS, dubbing, multi-speaker reader.',
    start_url: '/app/studio',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0A0B14',
    theme_color: '#7C5CFF',
    categories: ['productivity', 'music', 'education'],
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
        url: '/app/studio',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
      {
        name: 'Open Reader',
        short_name: 'Reader',
        url: '/app/reader',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
    ],
  };
}
