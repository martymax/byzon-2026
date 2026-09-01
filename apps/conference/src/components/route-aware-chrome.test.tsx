import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({ pathname: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: navigationMocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: ({
    alt = '',
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));
vi.mock('./app-main', () => ({
  AppMain: ({ children }: { readonly children: React.ReactNode }) => (
    <main id="main">{children}</main>
  ),
}));

import { RouteAwareChrome } from './route-aware-chrome';

describe('route-aware root chrome', () => {
  beforeEach(() => navigationMocks.pathname.mockReset());

  it('omits the public landmark and header from admin markup', () => {
    navigationMocks.pathname.mockReturnValue('/admin/obsah');

    const markup = renderToStaticMarkup(
      <RouteAwareChrome>
        <main id="admin-main">Administrace</main>
      </RouteAwareChrome>,
    );

    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup.match(/skip-link/g) ?? []).toHaveLength(0);
    expect(markup).not.toContain('app-header');
    expect(markup).toContain('id="admin-main"');
  });

  it('keeps one public main and skip link outside admin', () => {
    navigationMocks.pathname.mockReturnValue('/program');

    const markup = renderToStaticMarkup(
      <RouteAwareChrome>
        <section>Program</section>
      </RouteAwareChrome>,
    );

    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup.match(/skip-link/g)).toHaveLength(1);
    expect(markup).toContain('app-header');
  });
});
