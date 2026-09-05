import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  AdminErrorSummary,
  AdminAttentionList,
  AdminDataTable,
  AdminEmptyState,
  AdminFilterBar,
  AdminFormSection,
  AdminMetricCard,
  AdminMobileCardList,
  AdminNavGroup,
  AdminPageHeader,
  AdminSkeleton,
  AdminStatusBadge,
  AdminTechnicalDetails,
  AdminUnsavedBar,
  ChoiceField,
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
    expect(brandTokens.admin.color.primary).toBe('#b01365');
    expect(brandTokens.admin.color.canvas).toBe('#faf7f9');
    expect(brandTokens.admin.typography.family).toContain('Inter');
    expect(brandTokens.admin.radius.control).toBe('0.625rem');
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

  it('makes the complete choice row one labelled interaction target', () => {
    const markup = renderToStaticMarkup(
      <ChoiceField
        description="Dobrovolná volba bez předvybrané hodnoty."
        label="Zapnout networking"
        type="radio"
      />,
    );
    const id = markup.match(/<label[^>]+for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(markup.startsWith('<label')).toBe(true);
    expect(markup).toContain(`id="${id}"`);
    expect(markup).toContain('aria-describedby=');
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

  it('renders a role context action outside the five primary destinations', () => {
    const markup = renderToStaticMarkup(
      <ParticipantNavigation
        activeItemId="program"
        contextAction={{
          href: '/host/aktivity',
          icon,
          id: 'activity-management',
          label: 'Správa aktivit',
        }}
        items={Array.from({ length: 5 }, (_, index) => ({
          href: `/app/${index}`,
          icon,
          id: index === 0 ? 'program' : String(index),
          label: `Položka ${index}`,
        }))}
      />,
    );

    expect(markup).toContain('href="/host/aktivity"');
    expect(markup).toContain('Správa aktivit');
    expect(markup.match(/<li/g)).toHaveLength(5);
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

  it('renders an admin page header with one descriptive heading and action', () => {
    const markup = renderToStaticMarkup(
      <AdminPageHeader
        action={<Button>Načíst změny ze SimpleShopu</Button>}
        description="Načtěte, zkontrolujte a bezpečně použijte změny vstupenek."
        meta="Aktuální k 12:04"
        title="Aktualizace vstupenek"
      />,
    );

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('Aktualizace vstupenek');
    expect(markup).toContain('Načíst změny ze SimpleShopu');
    expect(markup).toContain('Aktuální k 12:04');
  });

  it('keeps status meaning and technical details accessible without color', () => {
    const markup = renderToStaticMarkup(
      <>
        <AdminStatusBadge icon={icon} tone="warning">
          Vyžaduje pozornost
        </AdminStatusBadge>
        <AdminTechnicalDetails>
          Referenční údaj 1234567890
        </AdminTechnicalDetails>
      </>,
    );

    expect(markup).toContain('Vyžaduje pozornost');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<details open');
    expect(markup).toContain('Technické údaje');
  });

  it('groups related admin fields and links every summary error', () => {
    const markup = renderToStaticMarkup(
      <>
        <AdminErrorSummary
          errors={[
            {
              fieldId: 'duvod-zmeny',
              message: 'Doplňte důvod změny, který se uloží do historie změn.',
            },
          ]}
          focusOnMount={false}
        />
        <AdminFormSection
          description="Zvolte hodnotu podle dopadu na účastníky."
          legend="Nastavení rezervací"
        >
          <Input id="duvod-zmeny" />
        </AdminFormSection>
      </>,
    );

    expect(markup).toContain('href="#duvod-zmeny"');
    expect(markup).toContain('<fieldset');
    expect(markup).toContain('<legend>Nastavení rezervací</legend>');
    expect(markup).toContain('aria-describedby=');
  });

  it('keeps long Czech admin data, navigation and actions semantically named', () => {
    const markup = renderToStaticMarkup(
      <div data-admin-root="">
        <AdminNavGroup
          activeItemId="tickets"
          items={[
            {
              href: '/admin/vstupenky',
              icon,
              id: 'tickets',
              label: 'Aktualizace vstupenek ze serverově připojeného zdroje',
            },
          ]}
          label="Účastníci a vstupenky"
        />
        <AdminAttentionList
          items={[
            {
              action: <Button>Zkontrolovat kapacitu</Button>,
              description: 'Obsazeno je 78 z 80 dostupných míst.',
              id: 'capacity',
              severity: 'warning',
              title: 'Aktivita Růst bez zkratek je téměř plná',
            },
          ]}
        />
        <AdminMetricCard
          detail="Dvacet osm účastníků zatím přístup neaktivovalo."
          label="Aktivace účastníků"
          updatedAt="Aktuální k 12:04"
          value="412 z 440"
        />
        <AdminFilterBar
          clearAction={<Button variant="quiet">Vymazat filtry</Button>}
        >
          <Button variant="secondary">Vyžaduje pozornost</Button>
        </AdminFilterBar>
        <AdminDataTable caption="Zkontrolované změny vstupenek">
          <tbody>
            <tr>
              <th scope="row">Vstupenka 7100001</th>
              <td>Vyžaduje opravu ve zdroji prodeje</td>
            </tr>
          </tbody>
        </AdminDataTable>
        <AdminMobileCardList label="Změny vstupenek na malém displeji">
          <li>Vstupenka 7100001 · vyžaduje opravu</li>
        </AdminMobileCardList>
        <AdminEmptyState
          action={<Button>Načíst změny</Button>}
          title="Od poslední kontroly nejsou žádné nové změny"
        >
          Zkontrolovat zdroj můžete znovu později.
        </AdminEmptyState>
        <AdminSkeleton />
        <AdminUnsavedBar onDiscard={() => undefined} onSave={() => undefined} />
      </div>,
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Účastníci a vstupenky"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Neuložené změny"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Aktualizace vstupenek ze serverově');
  });

  it('can preserve the contract-defined attention order', () => {
    const markup = renderToStaticMarkup(
      <AdminAttentionList
        items={[
          {
            description: 'První položka podle pořadí metrik.',
            id: 'contract-first',
            severity: 'warning',
            title: 'Nejdříve podle kontraktu',
          },
          {
            description: 'Druhá položka má vyšší závažnost.',
            id: 'contract-second',
            severity: 'danger',
            title: 'Až poté závažnější stav',
          },
        ]}
        sortBySeverity={false}
      />,
    );

    expect(markup.indexOf('Nejdříve podle kontraktu')).toBeLessThan(
      markup.indexOf('Až poté závažnější stav'),
    );
  });
});
