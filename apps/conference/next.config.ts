import type { NextConfig } from 'next';

export const publicShellCacheControl =
  'public, max-age=0, s-maxage=0, must-revalidate';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@byzon/config'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self)' },
        ],
      },
      {
        source: '/aktivace/odkaz',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/prihlaseni',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/chyba-pristupu',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/app/nastaveni',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/app/oznameni/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/onboarding',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/check-in',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        source: '/offline',
        headers: [{ key: 'Cache-Control', value: publicShellCacheControl }],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: publicShellCacheControl }],
      },
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: publicShellCacheControl }],
      },
      {
        source: '/brand/:path*',
        headers: [{ key: 'Cache-Control', value: publicShellCacheControl }],
      },
      {
        source: '/sw-shell-manifest.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
