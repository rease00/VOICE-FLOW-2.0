import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'V FLOW AI Studio',
    short_name: 'VF Studio',
    description: 'Install V FLOW AI for studio and writing workspace access.',
    start_url: '/app/writing',
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
