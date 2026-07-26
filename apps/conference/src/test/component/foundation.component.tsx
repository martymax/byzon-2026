import { Button, FormField, Input } from '@byzon/ui';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { renderComponent, userEvent } from './render';

function ComponentHarnessProbe() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      aria-label="Testovací formulář"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <FormField label="Kontaktní e-mail">
        <Input name="email" type="email" />
      </FormField>
      <Button type="submit">Pokračovat</Button>
      <p aria-live="polite">{submitted ? 'Formulář byl odeslán.' : ''}</p>
    </form>
  );
}

describe('browser component test harness', () => {
  it('uses accessible locators, real keyboard focus and browser events', async () => {
    const screen = await renderComponent(<ComponentHarnessProbe />);
    const email = screen.getByRole('textbox', { name: 'Kontaktní e-mail' });

    await userEvent.keyboard('{Tab}');
    await expect.element(email).toHaveFocus();
    await email.fill('synthetic@example.test');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();

    await expect
      .element(screen.getByText('Formulář byl odeslán.'))
      .toBeVisible();
  });
});
