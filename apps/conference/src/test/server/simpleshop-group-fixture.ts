// Synthetic contacts; column layout follows the live SimpleShop export.
export const simpleShopGroupProduct = {
  id: '143958',
  type: '9',
  code: '0MnNQ',
  archived: false,
  script_iframe: '<div data-simpleshopform="0MnNQ"></div>',
  test_mode: false,
};

export const simpleShopGroupEmails = Array.from(
  { length: 5 },
  (_, index) => `group-participant-${index + 1}@example.test`,
);

export const simpleShopGroupCsv = (
  emails: readonly string[] = simpleShopGroupEmails,
  orderExternalId = '9500001',
  firstTicketId = 9_500_010,
): string => {
  const headers = [
    'ID vstupenky',
    'Kód vstupenky',
    'Datum uplatnění',
    'Počet',
    'Jednotka',
    'Položka',
    'Cena položky celkem',
    'E-mail',
    'Telefon',
    'ID dokladu',
    'Číslo dokladu',
    'Stav',
    'Celková cena nákupu',
    'Měna',
    'Platební metoda',
    'Slevový kupón',
    'Faktura',
    'Odběratel',
    'Jméno',
    'Příjmení',
    'IČO',
    'DIČ',
    'Ulice',
    'Město',
    'PSČ',
    'Země',
    'Vytvořeno',
    'Uhrazeno',
    'Poznámka',
    'Jméno (prodej na jméno)',
    'Příjmení (prodej na jméno)',
    'E-mail (prodej na jméno)',
    'Název firmy (prodej na jméno)',
    'Pozice (prodej na jméno)',
    'Telefonní kontakt (prodej na jméno)',
  ];
  const buyer = {
    'ID dokladu': orderExternalId,
    Počet: '1',
    Stav: 'Uhrazeno',
    Vytvořeno: '01.09.2026',
    'Slevový kupón': 'GROUP20',
    Jméno: 'Skupinový',
    Příjmení: 'Kupující',
    'E-mail': 'group-buyer@example.test',
    Telefon: '+420111222333',
  };
  const rows: Record<string, string>[] = emails.map((email, index) => ({
    ...buyer,
    'ID vstupenky': String(firstTicketId + index),
    'Kód vstupenky': `GRP00${index + 1}`,
    Položka: 'Konference BYZON 2026 - Regular Bird (Vstupné pátek)',
    'Jméno (prodej na jméno)': `Účastník ${index + 1}`,
    'Příjmení (prodej na jméno)': 'Skupiny',
    'E-mail (prodej na jméno)': email,
    'Název firmy (prodej na jméno)': `Firma ${index + 1}`,
    'Pozice (prodej na jméno)': `Pozice ${index + 1}`,
    'Telefonní kontakt (prodej na jméno)': `+42077711122${index + 1}`,
  }));
  rows.push(
    { ...buyer, Počet: String(emails.length), Položka: 'Afterparty pátek' },
    { ...buyer, Položka: 'Sleva (20 %)' },
  );
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? '')),
  ]
    .map((row) => row.map(cell).join(';'))
    .join('\r\n');
};
