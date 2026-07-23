import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Input,
  ParticipantNavigation,
  brandTokens,
} from './index';

const icon = (
  <svg viewBox="0 0 24 24">
    <path d="M4 12h16" />
  </svg>
);

describe('BYZON UI primitives', () => {
  it('exposes the approved brand and accessibility tokens', () => {
    expect(brandTokens.color.brand).toBe('#f5218e');
    expect(brandTokens.color.ink).toBe('#140610');
    expect(brandTokens.touchTarget).toBe('2.75rem');
    expect(brandTokens.typography.display).toContain('Khand');
    expect(brandTokens.typography.body).toContain('Inter');
  });

  it('prevents a second submit while a button is loading', () => {
    const markup = renderToStaticMarkup(
      <Button loading type="submit">
        Uložit
      </Button>,
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Pracuji…');
  });

  it('connects a field label, helper and inline error', () => {
    const markup = renderToStaticMarkup(
      <FormField
        error="Kód se nepodařilo ověřit."
        helperText="Kód opište přesně tak, jak je uvedený na vstupence."
        label="Kód vstupenky"
        required
      >
        <Input name="ticketCode" />
      </FormField>,
    );
    const id = markup.match(/<label[^>]+for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-required="true"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('role="alert"');
  });

  it('renders a labelled active destination and caps participant navigation', () => {
    const markup = renderToStaticMarkup(
      <ParticipantNavigation
        activeItemId="program"
        items={[
          { href: '/app', icon, id: 'home', label: 'Přehled' },
          {
            href: '/app/program',
            icon,
            id: 'program',
            label: 'Program',
          },
        ]}
      />,
    );
    expect(markup).toContain('aria-label="Hlavní navigace"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Program');

    expect(() =>
      renderToStaticMarkup(
        <ParticipantNavigation
          activeItemId="one"
          items={Array.from({ length: 6 }, (_, index) => ({
            href: `/app/${index}`,
            icon,
            id: String(index),
            label: `Položka ${index}`,
          }))}
        />,
      ),
    ).toThrow(/at most five/i);
  });

  it('links error summary items to their invalid controls', () => {
    const markup = renderToStaticMarkup(
      <ErrorSummary
        errors={[{ fieldId: 'email', message: 'Doplňte e-mail.' }]}
      />,
    );
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('href="#email"');
  });

  it('gives a dialog an accessible name and close action', () => {
    const markup = renderToStaticMarkup(
      <Dialog onClose={() => undefined} open title="Potvrdit změnu">
        Opravdu chcete pokračovat?
      </Dialog>,
    );
    const titleId = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(markup).toContain(`id="${titleId}"`);
    expect(markup).toContain('aria-label="Zavřít"');
  });
});
