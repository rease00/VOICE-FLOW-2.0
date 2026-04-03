import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'V FLOW AI Reader',
    short_name: 'VF Reader',
    description: 'Install Reader for compact playback and offline saved audio.',
    start_url: '/app/reader',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#071124',
    theme_color: '#0f213f',
    icons: [
      {
        src: '/brand-logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
