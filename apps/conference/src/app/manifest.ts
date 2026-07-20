import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BYZON 2026 – konferenční aplikace',
    short_name: 'BYZON 2026',
    description: 'Program a služby pro účastníky konference BYZON 2026.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf7f9',
    theme_color: '#f5218e',
    lang: 'cs',
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
