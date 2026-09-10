import { expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { AdminContentWorkspace } from '../../components/admin-content-workspace';
import {
  AdminContentAssetField,
  createAdminContentAssetPreviewPort,
  type AdminContentAssetPort,
} from '../../components/admin-content-asset-field';
import { createAdminContentPreviewPort } from '../../lib/admin-content-preview-port';
import { renderComponent, userEvent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const eventId = '019fc700-0000-7000-8000-000000000001';
const imageData =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1WQAAAAASUVORK5CYII=';
const assets = (): AdminContentAssetPort => {
  const base = createAdminContentAssetPreviewPort();
  return {
    ...base,
    resolve: async (input) => {
      const result = await base.resolve(input);
      if (result.ok && result.data?.preview)
        result.data.preview.url = imageData;
      return result;
    },
    replace: async (input) => {
      const result = await base.replace(input);
      if (result.ok && result.data.asset.preview)
        result.data.asset.preview.url = imageData;
      return result;
    },
    download: vi.fn(async () => ({
      ok: true as const,
      data: new Blob(['image'], { type: 'image/webp' }),
    })),
  };
};

it('uploads a partner logo without losing the edited name and saves the resulting owner version', async () => {
  const content = createAdminContentPreviewPort({ eventId });
  const save = vi.fn(content.save);
  // Content and image ports share the database in production; capture the outgoing version here.
  save.mockResolvedValue({
    ok: true,
    data: {
      id: '019fc700-0000-7000-8000-000000000025',
      status: 'updated',
      requestId: crypto.randomUUID(),
    },
  });
  const assetPort = assets();
  const screen = await renderComponent(
    <AdminContentWorkspace
      eventId={eventId}
      initialResource="partners"
      timezone="Europe/Prague"
      port={{ ...content, save }}
      assetPort={assetPort}
    />,
  );
  await screen
    .getByRole('button', { name: 'Upravit: Partner Example' })
    .click();
  await expect
    .element(screen.getByText('Logo partnera zatím není dostupné'))
    .toBeVisible();
  await screen
    .getByRole('textbox', { name: 'Název', exact: true })
    .fill('Upravený partner');
  await userEvent.upload(
    await screen.getByLabelText('Obrázek').element(),
    new File(['test'], 'logo.png', { type: 'image/png' }),
  );
  await screen.getByRole('button', { name: 'Uložit změny' }).click();
  expect(save).not.toHaveBeenCalled();
  await expect
    .element(
      screen.getByText(
        'Nejprve nahrajte vybraný obrázek, nebo zrušte jeho výběr.',
      ),
    )
    .toBeVisible();
  await screen
    .getByRole('textbox', { name: 'Alternativní popis' })
    .fill('Logo testovacího partnera');
  await screen.getByRole('button', { name: 'Nahrát obrázek' }).click();
  await expect
    .element(screen.getByRole('img', { name: 'Logo testovacího partnera' }))
    .toBeVisible();
  await expect
    .element(screen.getByRole('button', { name: 'Stáhnout logo' }))
    .toBeEnabled();
  await expect
    .element(screen.getByRole('textbox', { name: 'Název', exact: true }))
    .toHaveValue('Upravený partner');
  await expectComponentToPassAxe(document.querySelector('[role="dialog"]')!);
  await screen.getByRole('button', { name: 'Uložit změny' }).click();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ name: 'Upravený partner', version: 2 }),
    }),
  );
});

it('downloads the stored logo in read-only mode without presenting upload controls', async () => {
  const port = assets();
  const owner = {
    kind: 'partner' as const,
    id: '019fc700-0000-7000-8000-000000000025',
  };
  await port.replace({
    owner,
    eventId,
    purpose: 'partner_logo',
    expectedOwnerVersion: 1,
    altText: 'Logo partnera',
    file: new File(['test'], 'logo.png', { type: 'image/png' }),
    onProgress: () => {},
  });
  const screen = await renderComponent(
    <AdminContentAssetField
      eventId={eventId}
      owner={owner}
      ownerVersion={2}
      purpose="partner_logo"
      port={port}
      readOnly
    />,
  );
  await screen.getByRole('button', { name: 'Stáhnout logo' }).click();
  expect(port.download).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Obrázek')).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole('img', { name: 'Logo partnera' }))
    .toBeVisible();
});
