'use client';

import {
  isAdminContentSecurityFailure,
  type AdminContentFailure,
  type AdminContentItem,
  type AdminContentPort,
  type AdminContentResource,
} from '../lib/admin-content-api';

import { contentBulkPatch } from './admin-content-bulk-model';
import {
  AdminBulkPanel,
  type AdminBulkAction,
  type BulkField,
} from './admin-bulk-panel';

const label = (item: AdminContentItem) =>
  String(
    item.title ??
      item.name ??
      item.question ??
      `${item.firstName ?? ''} ${item.lastName ?? ''}`,
  );
const active = (item: AdminContentItem) => item.status !== 'archived';
const options = (items: readonly AdminContentItem[]) =>
  items.filter(active).map((item) => ({ value: item.id, label: label(item) }));
const select = (
  name: string,
  fieldLabel: string,
  choices: readonly { value: string; label: string }[],
): BulkField => ({ name, label: fieldLabel, options: choices });

export const AdminContentBulk = ({
  items,
  resource,
  references,
  port,
  eventId,
  disabled,
  onBusyChange,
  onCompleted,
  onSecurityFailure,
}: {
  readonly items: readonly AdminContentItem[];
  readonly resource: AdminContentResource;
  readonly references: Readonly<Record<string, readonly AdminContentItem[]>>;
  readonly port: AdminContentPort;
  readonly eventId: string;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCompleted: () => void;
  readonly onSecurityFailure: (failure: AdminContentFailure) => void;
}) => {
  const save = async (
    item: AdminContentItem,
    patch: Record<string, unknown> | null,
    signal: AbortSignal,
  ) => {
    const result =
      patch === null
        ? await port.archive({
            eventId,
            resource,
            id: item.id,
            ...(item.version === undefined ? {} : { version: item.version }),
            signal,
          })
        : await port.save({
            eventId,
            resource,
            id: item.id,
            body: {
              ...patch,
              ...(item.version === undefined ? {} : { version: item.version }),
            },
            signal,
          });
    if (result.ok) return { ok: true };
    if (isAdminContentSecurityFailure(result.failure))
      onSecurityFailure(result.failure);
    return {
      ok: false,
      message: [
        result.failure.message,
        ...Object.values(result.failure.fieldErrors ?? {}),
      ].join(' '),
      stop: !['validation', 'conflict', 'not_found'].includes(
        result.failure.kind,
      ),
    };
  };
  const edit = (
    id: string,
    title: string,
    field: BulkField,
    description: string,
  ): AdminBulkAction<AdminContentItem> => ({
    id,
    label: title,
    description,
    fields: [field],
    eligible: active,
    execute: (item, values, signal, index) =>
      save(item, contentBulkPatch(id, item, values, index), signal),
  });
  const actions: AdminBulkAction<AdminContentItem>[] = [];
  if (resource !== 'days') {
    actions.push({
      ...edit(
        'status',
        'Změnit stav',
        select('value', 'Nový stav', [
          { value: 'draft', label: 'Koncept / obnovit z archivu' },
          { value: 'published', label: 'Připravit ke zveřejnění' },
          ...(resource === 'sessions'
            ? [{ value: 'cancelled', label: 'Zrušit bod programu' }]
            : []),
        ]),
        'Nastaví společný stav. Viditelný obsah se změní až po kontrole a zveřejnění obsahu.',
      ),
      eligible: (item, values) => item.status !== values.value,
    });
  }
  actions.push({
    id: 'archive',
    label: resource === 'days' ? 'Smazat dny' : 'Archivovat',
    danger: true,
    description:
      resource === 'days'
        ? 'Trvale odstraní vybrané dny bez navázaného programu. Dny s navázanými položkami server odmítne.'
        : 'Archivuje vybrané položky. Dopad na veřejný program zkontrolujete před zveřejněním.',
    eligible: active,
    execute: (item, _values, signal) => save(item, null, signal),
  });
  actions.push(
    edit(
      'sortOrder',
      'Nastavit pořadí',
      {
        name: 'value',
        label: 'Počáteční pořadí (další položky +1)',
        type: 'number',
        min: 0,
      },
      'Přiřadí vybraným položkám po sobě jdoucí pořadí podle pořadí ve výběru.',
    ),
  );
  if (resource === 'sessions') {
    actions.push(
      edit(
        'type',
        'Změnit typ programu',
        select(
          'value',
          'Typ programu',
          [
            ['talk', 'Přednáška'],
            ['panel', 'Panelová diskuze'],
            ['workshop', 'Workshop'],
            ['mastermind', 'Mastermind'],
            ['coaching', 'Koučink'],
            ['networking', 'Networking'],
            ['break', 'Přestávka'],
            ['meal', 'Jídlo'],
            ['gala', 'Galavečer'],
            ['other', 'Ostatní'],
          ].map(([value, name]) => ({ value: value!, label: name! })),
        ),
        'Změní typ vybraných bodů programu.',
      ),
    );
    actions.push(
      edit(
        'roomId',
        'Přesunout do místnosti',
        select('value', 'Místnost', [
          { value: '__none__', label: 'Bez místnosti' },
          ...options(references.rooms ?? []),
        ]),
        'Změní místnost. Server ověří časové kolize a příslušnost místnosti k akci.',
      ),
    );
    actions.push({
      ...edit(
        'shiftTime',
        'Posunout časy',
        {
          name: 'value',
          label: 'Posun v minutách (záporný = dříve)',
          type: 'number',
          min: -1440,
          max: 1440,
        },
        'Posune začátek i konec o stejný počet minut. Délka zůstane zachovaná. Kolize a časy mimo den akce server odmítne.',
      ),
      validate: (_items, values) =>
        Number(values.value) === 0 ? 'Zadejte nenulový posun.' : null,
      order: (selected, values) =>
        [...selected].sort(
          (a, b) =>
            (Date.parse(String(a.startsAt)) - Date.parse(String(b.startsAt))) *
            (Number(values.value) > 0 ? -1 : 1),
        ),
    });
    for (const action of ['addSpeaker', 'removeSpeaker'] as const)
      actions.push({
        ...edit(
          action,
          action === 'addSpeaker' ? 'Přidat řečníka' : 'Odebrat řečníka',
          select('value', 'Řečník', options(references.speakers ?? [])),
          'Upraví přiřazení zvoleného řečníka. Ostatní řečníci zůstanou zachováni.',
        ),
        eligible: (item, values) =>
          active(item) &&
          (action === 'addSpeaker'
            ? !Array.isArray(item.speakerIds) ||
              !item.speakerIds.includes(values.value)
            : Array.isArray(item.speakerIds) &&
              item.speakerIds.includes(values.value)),
      });
  }
  if (resource === 'rooms') {
    actions.push(
      edit(
        'venueId',
        'Změnit místo',
        select('value', 'Místo', options(references.venues ?? [])),
        'Přiřadí místnosti ke zvolenému místu.',
      ),
    );
    actions.push(
      edit(
        'capacity',
        'Změnit kapacitu místností',
        {
          name: 'value',
          label: 'Kapacita místnosti (prázdné = neuvedená)',
          type: 'number',
          min: 1,
          required: false,
        },
        'Upraví informační kapacitu místností. Rezervační kapacity aktivit spravujete v Rezervacích.',
      ),
    );
  }
  if (resource === 'speakers')
    for (const [field, name] of [
      ['company', 'Firma'],
      ['jobTitle', 'Pracovní pozice'],
    ] as const) {
      actions.push(
        edit(
          field,
          `Změnit: ${name.toLocaleLowerCase('cs')}`,
          {
            name: 'value',
            label: `${name} (prázdné = vymazat)`,
            required: false,
          },
          'Nahradí toto pole ve vybraných profilech.',
        ),
      );
    }
  if (resource === 'partners' || resource === 'faqs')
    actions.push(
      edit(
        'category',
        'Změnit kategorii',
        {
          name: 'value',
          label: 'Kategorie (prázdné = vymazat)',
          required: false,
        },
        'Nastaví společnou kategorii vybraných položek.',
      ),
    );
  if (resource === 'partners')
    actions.push(
      edit(
        'tier',
        'Změnit úroveň partnerství',
        { name: 'value', label: 'Úroveň (prázdné = vymazat)', required: false },
        'Nastaví společnou úroveň partnerství.',
      ),
    );
  if (resource === 'pages')
    actions.push(
      edit(
        'kind',
        'Změnit druh stránek',
        select('value', 'Druh stránky', [
          { value: 'practical', label: 'Praktické informace' },
          { value: 'marketing', label: 'Marketing' },
          { value: 'other', label: 'Ostatní' },
        ]),
        'Změní zařazení vybraných stránek.',
      ),
    );
  return (
    <AdminBulkPanel
      items={items}
      identify={(item) => ({ id: item.id, label: label(item) })}
      actions={actions}
      disabled={disabled}
      onBusyChange={onBusyChange}
      onCompleted={onCompleted}
    />
  );
};
