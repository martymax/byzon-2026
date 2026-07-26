import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CheckinLayout, { dynamic } from './layout';
import CheckinLoading from './loading';

describe('dedicated check-in route boundary', () => {
  it('forces a request-scoped shell and marks it for global chrome isolation', () => {
    expect(dynamic).toBe('force-dynamic');

    const markup = renderToStaticMarkup(
      <CheckinLayout>
        <p>Operátorské pracoviště</p>
      </CheckinLayout>,
    );

    expect(markup).toContain('data-checkin-route');
    expect(markup).toContain('Operátorské pracoviště');
  });

  it('announces route loading without exposing an interactive scanner', () => {
    const markup = renderToStaticMarkup(<CheckinLoading />);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Připravuji bezpečné odbavení');
    expect(markup).not.toContain('<main');
    expect(markup).not.toContain('input');
    expect(markup).not.toContain('button');
  });
});
