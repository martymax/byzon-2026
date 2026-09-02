import { createHash } from 'node:crypto';

import {
  SIMPLESHOP_TICKET_FORM_KEY,
  SIMPLESHOP_TICKET_PRODUCT_ID,
  TICKET_IMPORT_MAX_PREVIEW_ROWS,
  ticketImportSimpleShopSourceSchema,
  type TicketImportIdentitySource,
  type TicketImportSource,
  type TicketImportSourceStatus,
} from '@byzon/domain/contracts/ticket-import';
import { z } from 'zod';

export const SIMPLESHOP_API_BASE_URL = 'https://api.simpleshop.cz/2.0/';
export const SIMPLESHOP_MAX_PAGES = 1;
export const SIMPLESHOP_MAX_SOURCE_ROWS = 10_000;
export const SIMPLESHOP_MAX_RESPONSE_BYTES = 8_000_000;
export const SIMPLESHOP_REQUEST_TIMEOUT_MS = 8_000;

type SimpleShopPreviewSource = Extract<
  TicketImportSource,
  { kind: 'simpleshop_api' }
>;

export interface SimpleShopTicketSourceRecord {
  readonly sourceRowNumber: number;
  readonly externalId: string;
  readonly orderExternalId: string;
  readonly sourceStatus: TicketImportSourceStatus;
  readonly quantity: number;
  readonly orderTicketCount: number;
  readonly orderTicketPosition: number;
  readonly purchasedOn: string;
  readonly discountCoupon: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactCompany: string | null;
  readonly contactPosition: string | null;
  readonly contactPhone: string | null;
  readonly identitySource: TicketImportIdentitySource;
}

export interface SimpleShopTicketSourceSnapshot {
  readonly source: SimpleShopPreviewSource;
  readonly records: readonly SimpleShopTicketSourceRecord[];
  /** Digest covers normalized apply inputs but never contains a ticket code. */
  readonly snapshotDigest: string;
}

export type SimpleShopTicketSourceErrorCode =
  | 'credentials_missing'
  | 'invalid_target'
  | 'method_not_allowed'
  | 'timeout'
  | 'unavailable'
  | 'response_too_large'
  | 'invalid_payload'
  | 'record_limit_exceeded';

export class SimpleShopTicketSourceError extends Error {
  constructor(readonly code: SimpleShopTicketSourceErrorCode) {
    super('SimpleShop ticket source request failed');
    this.name = 'SimpleShopTicketSourceError';
  }
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SimpleShopTicketSourceAdapterOptions {
  readonly email?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly allowTestBaseUrl?: boolean;
  readonly fetch?: FetchImplementation;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxSourceRows?: number;
  readonly maxPreviewRows?: number;
  readonly maxAttempts?: number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export interface SimpleShopTicketSourceAdapter {
  readonly fetchPreviewSource: () => Promise<SimpleShopTicketSourceSnapshot>;
}

const productSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    type: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
    code: z.string().min(1).max(100),
    archived: z.boolean(),
    script_iframe: z.string().max(10_000),
    test_mode: z.boolean(),
  })
  .passthrough();

const exportEnvelopeSchema = z.strictObject({
  csv: z.string().min(1),
});

const positiveIntegerCell = /^\d+$/;
const requiredHeaders = [
  'ID vstupenky',
  'Kód vstupenky',
  'Počet',
  'ID dokladu',
  'Stav',
  'Vytvořeno',
  'Slevový kupón',
  'E-mail',
  'Telefon',
  'Jméno',
  'Příjmení',
  'Jméno (prodej na jméno)',
  'Příjmení (prodej na jméno)',
  'E-mail (prodej na jméno)',
  'Název firmy (prodej na jméno)',
  'Pozice (prodej na jméno)',
  'Telefonní kontakt (prodej na jméno)',
] as const;
const MAX_EXTERNAL_ID_LENGTH = 64;
const unsafeContactPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/;

const optionalSourceText = (value: string, maximum: number): string | null => {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || unsafeContactPattern.test(normalized)) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  return normalized;
};

const optionalEmail = (value: string): string | null => {
  const normalized = optionalSourceText(value, 320)?.toLocaleLowerCase('en-US');
  if (normalized === undefined || normalized === null) return null;
  const parsed = z.email().max(320).safeParse(normalized);
  if (!parsed.success) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  return parsed.data;
};

const fullName = (firstName: string, lastName: string): string | null => {
  const parts = [
    optionalSourceText(firstName, 80),
    optionalSourceText(lastName, 80),
  ].filter((value): value is string => value !== null);
  return parts.length === 0 ? null : parts.join(' ');
};

const simpleShopPurchaseDatePattern = /^(\d{2})\.(\d{2})\.(\d{4})$/;

const purchaseDate = (value: string): string => {
  const match = simpleShopPurchaseDatePattern.exec(value.trim());
  if (!match) throw new SimpleShopTicketSourceError('invalid_payload');
  const [, day, month, year] = match;
  const normalized = `${year}-${month}-${day}`;
  const parsed = z.string().date().safeParse(normalized);
  if (!parsed.success) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  return parsed.data;
};

interface ParsedSimpleShopTicketRow {
  readonly sourceRowNumber: number;
  readonly externalId: string;
  readonly orderExternalId: string;
  readonly sourceStatus: TicketImportSourceStatus;
  readonly quantity: number;
  readonly purchasedOn: string;
  readonly discountCoupon: string | null;
  readonly namedContactName: string | null;
  readonly namedContactEmail: string | null;
  readonly namedContactCompany: string | null;
  readonly namedContactPosition: string | null;
  readonly namedContactPhone: string | null;
  readonly buyerName: string | null;
  readonly buyerEmail: string | null;
  readonly buyerPhone: string | null;
}

const sourceStatusFor = (value: string): TicketImportSourceStatus => {
  switch (value) {
    case 'Uhrazeno':
      return 'paid';
    case 'Neuhrazeno':
      return 'unpaid';
    case 'STORNO':
      return 'cancelled';
    default:
      return 'unknown';
  }
};

const ticketCodeCharacterClasses = (value: string): readonly string[] => {
  const classes = new Set<string>();
  for (const character of value) {
    if (/^[0-9]$/.test(character)) classes.add('digit');
    else if (/^[A-Z]$/.test(character)) classes.add('upper_ascii');
    else if (/^[a-z]$/.test(character)) classes.add('lower_ascii');
    else if (character === '-') classes.add('hyphen');
    else if (/^\s$/u.test(character)) classes.add('whitespace');
    else if (/^[\x20-\x7e]$/.test(character)) classes.add('other_ascii');
    else classes.add('non_ascii');
  }
  return [...classes];
};

const validateBaseUrl = (candidate: string, allowTestBaseUrl: boolean): URL => {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new SimpleShopTicketSourceError('invalid_target');
  }
  const productionBase = new URL(SIMPLESHOP_API_BASE_URL);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !parsed.pathname.endsWith('/') ||
    parsed.pathname !== '/2.0/' ||
    (!allowTestBaseUrl && parsed.origin !== productionBase.origin)
  ) {
    throw new SimpleShopTicketSourceError('invalid_target');
  }
  return parsed;
};

export const assertSimpleShopReadRequest = (
  url: URL,
  method: string,
  baseUrl = new URL(SIMPLESHOP_API_BASE_URL),
): void => {
  if (method !== 'GET') {
    throw new SimpleShopTicketSourceError('method_not_allowed');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== baseUrl.origin ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== '' ||
    !url.pathname.startsWith(baseUrl.pathname)
  ) {
    throw new SimpleShopTicketSourceError('invalid_target');
  }
};

const parseCsv = (
  value: string,
  maxRows: number,
): readonly (readonly string[])[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += character;
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ';') {
      row.push(cell);
      cell = '';
      if (row.length > 500) {
        throw new SimpleShopTicketSourceError('invalid_payload');
      }
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      if (rows.length > maxRows + 1) {
        throw new SimpleShopTicketSourceError('record_limit_exceeded');
      }
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new SimpleShopTicketSourceError('invalid_payload');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  while (
    rows.length > 0 &&
    rows.at(-1)!.every((candidate) => candidate.length === 0)
  ) {
    rows.pop();
  }
  if (rows.length < 2) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  const width = rows[0]!.length;
  if (width === 0 || rows.some((candidate) => candidate.length !== width)) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  rows[0]![0] = rows[0]![0]!.replace(/^\uFEFF/, '');
  return rows;
};

const parseExport = (
  csv: string,
  maxSourceRows: number,
  maxPreviewRows: number,
): SimpleShopTicketSourceSnapshot => {
  const parsedRows = parseCsv(csv, maxSourceRows);
  const headers = parsedRows[0]!;
  const rows = parsedRows.slice(1);
  const headerIndex = new Map<string, number>();
  headers.forEach((header, index) => {
    if (headerIndex.has(header)) {
      throw new SimpleShopTicketSourceError('invalid_payload');
    }
    headerIndex.set(header, index);
  });
  if (requiredHeaders.some((header) => !headerIndex.has(header))) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  const at = (
    row: readonly string[],
    header: (typeof requiredHeaders)[number],
  ) => row[headerIndex.get(header)!]!;

  const externalIds = new Set<string>();
  const ticketCodes = new Set<string>();
  const parsedTicketRows: ParsedSimpleShopTicketRow[] = [];
  const codeByteLengths: number[] = [];
  const codeClasses = new Set<string>();
  const observedStatuses: Record<TicketImportSourceStatus, number> = {
    paid: 0,
    unpaid: 0,
    cancelled: 0,
    refunded: 0,
    unknown: 0,
  };
  let ignoredSummaryRows = 0;
  let multipleQuantitySummaryRows = 0;

  rows.forEach((row, index) => {
    const sourceRowNumber = index + 2;
    const externalId = at(row, 'ID vstupenky');
    const ticketCode = at(row, 'Kód vstupenky');
    const orderExternalId = at(row, 'ID dokladu');
    const quantityCell = at(row, 'Počet');
    const sourceStatus = sourceStatusFor(at(row, 'Stav'));
    if (
      !positiveIntegerCell.test(quantityCell) ||
      !positiveIntegerCell.test(orderExternalId) ||
      orderExternalId.length > MAX_EXTERNAL_ID_LENGTH
    ) {
      throw new SimpleShopTicketSourceError('invalid_payload');
    }
    const quantity = Number(quantityCell);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new SimpleShopTicketSourceError('invalid_payload');
    }
    if (externalId.length === 0 && ticketCode.length === 0) {
      ignoredSummaryRows += 1;
      if (quantity > 1) multipleQuantitySummaryRows += 1;
      return;
    }
    if (
      externalId.length === 0 ||
      ticketCode.length === 0 ||
      !positiveIntegerCell.test(externalId) ||
      externalId.length > MAX_EXTERNAL_ID_LENGTH ||
      quantity !== 1 ||
      Buffer.byteLength(ticketCode, 'utf8') > 512
    ) {
      throw new SimpleShopTicketSourceError('invalid_payload');
    }
    if (externalIds.has(externalId) || ticketCodes.has(ticketCode)) {
      throw new SimpleShopTicketSourceError('invalid_payload');
    }
    externalIds.add(externalId);
    ticketCodes.add(ticketCode);
    const byteLength = Buffer.byteLength(ticketCode, 'utf8');
    codeByteLengths.push(byteLength);
    ticketCodeCharacterClasses(ticketCode).forEach((item) =>
      codeClasses.add(item),
    );
    observedStatuses[sourceStatus] += 1;
    parsedTicketRows.push({
      sourceRowNumber,
      externalId,
      orderExternalId,
      sourceStatus,
      quantity,
      purchasedOn: purchaseDate(at(row, 'Vytvořeno')),
      discountCoupon: optionalSourceText(at(row, 'Slevový kupón'), 100),
      namedContactName: fullName(
        at(row, 'Jméno (prodej na jméno)'),
        at(row, 'Příjmení (prodej na jméno)'),
      ),
      namedContactEmail: optionalEmail(at(row, 'E-mail (prodej na jméno)')),
      namedContactCompany: optionalSourceText(
        at(row, 'Název firmy (prodej na jméno)'),
        160,
      ),
      namedContactPosition: optionalSourceText(
        at(row, 'Pozice (prodej na jméno)'),
        160,
      ),
      namedContactPhone: optionalSourceText(
        at(row, 'Telefonní kontakt (prodej na jméno)'),
        64,
      ),
      buyerName: fullName(at(row, 'Jméno'), at(row, 'Příjmení')),
      buyerEmail: optionalEmail(at(row, 'E-mail')),
      buyerPhone: optionalSourceText(at(row, 'Telefon'), 64),
    });
    if (parsedTicketRows.length > maxPreviewRows) {
      throw new SimpleShopTicketSourceError('record_limit_exceeded');
    }
  });

  if (
    parsedTicketRows.length === 0 ||
    codeByteLengths.some((length) => length === 0)
  ) {
    throw new SimpleShopTicketSourceError('invalid_payload');
  }
  const paidTicketCountByOrder = new Map<string, number>();
  const ticketRowsByOrder = new Map<string, ParsedSimpleShopTicketRow[]>();
  for (const row of parsedTicketRows) {
    const orderRows = ticketRowsByOrder.get(row.orderExternalId) ?? [];
    orderRows.push(row);
    ticketRowsByOrder.set(row.orderExternalId, orderRows);
    if (row.sourceStatus !== 'paid') continue;
    paidTicketCountByOrder.set(
      row.orderExternalId,
      (paidTicketCountByOrder.get(row.orderExternalId) ?? 0) + 1,
    );
  }
  const records: SimpleShopTicketSourceRecord[] = parsedTicketRows.map(
    (row) => {
      const hasNamedParticipant = row.namedContactEmail !== null;
      const canUseSingleTicketBuyer =
        row.sourceStatus === 'paid' &&
        paidTicketCountByOrder.get(row.orderExternalId) === 1 &&
        row.buyerEmail !== null;
      const identitySource: TicketImportIdentitySource = hasNamedParticipant
        ? 'named_participant'
        : canUseSingleTicketBuyer
          ? 'single_paid_ticket_buyer'
          : 'manual_review';
      return {
        sourceRowNumber: row.sourceRowNumber,
        externalId: row.externalId,
        orderExternalId: row.orderExternalId,
        sourceStatus: row.sourceStatus,
        quantity: row.quantity,
        orderTicketCount: ticketRowsByOrder.get(row.orderExternalId)!.length,
        orderTicketPosition:
          ticketRowsByOrder
            .get(row.orderExternalId)!
            .findIndex(({ externalId }) => externalId === row.externalId) + 1,
        purchasedOn: row.purchasedOn,
        discountCoupon: row.discountCoupon,
        contactName:
          identitySource === 'named_participant'
            ? row.namedContactName
            : row.buyerName,
        contactEmail:
          identitySource === 'named_participant'
            ? row.namedContactEmail
            : row.buyerEmail,
        contactCompany:
          identitySource === 'named_participant'
            ? row.namedContactCompany
            : null,
        contactPosition:
          identitySource === 'named_participant'
            ? row.namedContactPosition
            : null,
        contactPhone:
          identitySource === 'named_participant'
            ? row.namedContactPhone
            : row.buyerPhone,
        identitySource,
      };
    },
  );
  const source = ticketImportSimpleShopSourceSchema.parse({
    kind: 'simpleshop_api',
    productId: SIMPLESHOP_TICKET_PRODUCT_ID,
    formKey: SIMPLESHOP_TICKET_FORM_KEY,
    strict: true,
    pageCount: SIMPLESHOP_MAX_PAGES,
    sourceRows: rows.length,
    ticketRows: records.length,
    ignoredSummaryRows,
    multipleQuantitySummaryRows,
    observedStatuses,
    codeShape: {
      count: records.length,
      minByteLength: Math.min(...codeByteLengths),
      maxByteLength: Math.max(...codeByteLengths),
      characterClasses: [...codeClasses].sort(),
    },
  });
  const snapshotDigest = createHash('sha256')
    .update(
      JSON.stringify({
        source,
        records: records.map(
          ({
            sourceRowNumber,
            externalId,
            orderExternalId,
            sourceStatus,
            quantity,
            contactName,
            contactEmail,
            identitySource,
          }) => ({
            sourceRowNumber,
            externalId,
            orderExternalId,
            sourceStatus,
            quantity,
            contactName,
            contactEmail,
            identitySource,
          }),
        ),
      }),
      'utf8',
    )
    .digest('hex');
  return { source, records, snapshotDigest };
};

const defaultDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const readBoundedResponse = async (
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (!reader) throw new SimpleShopTicketSourceError('invalid_payload');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SimpleShopTicketSourceError('response_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const createSimpleShopTicketSourceAdapter = (
  options: SimpleShopTicketSourceAdapterOptions,
): SimpleShopTicketSourceAdapter => {
  const baseUrl = validateBaseUrl(
    options.baseUrl ?? SIMPLESHOP_API_BASE_URL,
    options.allowTestBaseUrl === true,
  );
  const fetchImplementation =
    options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? SIMPLESHOP_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? SIMPLESHOP_MAX_RESPONSE_BYTES;
  const maxSourceRows = options.maxSourceRows ?? SIMPLESHOP_MAX_SOURCE_ROWS;
  const maxPreviewRows =
    options.maxPreviewRows ?? TICKET_IMPORT_MAX_PREVIEW_ROWS;
  const maxAttempts = options.maxAttempts ?? 2;
  const delay = options.delay ?? defaultDelay;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000 ||
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1_024 ||
    maxResponseBytes > SIMPLESHOP_MAX_RESPONSE_BYTES ||
    !Number.isInteger(maxSourceRows) ||
    maxSourceRows < 1 ||
    maxSourceRows > SIMPLESHOP_MAX_SOURCE_ROWS ||
    !Number.isInteger(maxPreviewRows) ||
    maxPreviewRows < 1 ||
    maxPreviewRows > TICKET_IMPORT_MAX_PREVIEW_ROWS ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 3
  ) {
    throw new TypeError('Invalid SimpleShop adapter limits');
  }

  const authorization = () => {
    if (
      typeof options.email !== 'string' ||
      options.email.length === 0 ||
      typeof options.apiKey !== 'string' ||
      options.apiKey.length === 0
    ) {
      throw new SimpleShopTicketSourceError('credentials_missing');
    }
    return `Basic ${Buffer.from(
      `${options.email}:${options.apiKey}`,
      'utf8',
    ).toString('base64')}`;
  };

  const getJson = async (relativePath: string): Promise<unknown> => {
    const url = new URL(relativePath, baseUrl);
    assertSimpleShopReadRequest(url, 'GET', baseUrl);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: authorization(),
          },
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          if (retryable && attempt < maxAttempts) {
            await delay(100 * 2 ** (attempt - 1));
            continue;
          }
          throw new SimpleShopTicketSourceError('unavailable');
        }
        const responseMediaType = response.headers
          .get('content-type')
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase();
        if (responseMediaType !== 'application/json') {
          await response.body?.cancel().catch(() => undefined);
          throw new SimpleShopTicketSourceError('invalid_payload');
        }
        const declaredLength = response.headers.get('content-length');
        if (
          declaredLength !== null &&
          (!/^\d+$/.test(declaredLength) ||
            Number(declaredLength) > maxResponseBytes)
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw new SimpleShopTicketSourceError('response_too_large');
        }
        const bytes = await readBoundedResponse(response, maxResponseBytes);
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          return JSON.parse(text) as unknown;
        } catch {
          throw new SimpleShopTicketSourceError('invalid_payload');
        }
      } catch (error) {
        if (error instanceof SimpleShopTicketSourceError) throw error;
        const timedOut = controller.signal.aborted;
        if (attempt < maxAttempts) {
          await delay(100 * 2 ** (attempt - 1));
          continue;
        }
        throw new SimpleShopTicketSourceError(
          timedOut ? 'timeout' : 'unavailable',
        );
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new SimpleShopTicketSourceError('unavailable');
  };

  return {
    fetchPreviewSource: async () => {
      const productRaw = await getJson(
        `product/${SIMPLESHOP_TICKET_PRODUCT_ID}/`,
      );
      const product = productSchema.safeParse(productRaw);
      if (
        !product.success ||
        String(product.data.id) !== String(SIMPLESHOP_TICKET_PRODUCT_ID) ||
        String(product.data.type) !== '9' ||
        product.data.code !== SIMPLESHOP_TICKET_FORM_KEY ||
        !product.data.script_iframe.includes(SIMPLESHOP_TICKET_FORM_KEY) ||
        product.data.archived ||
        product.data.test_mode
      ) {
        throw new SimpleShopTicketSourceError('invalid_payload');
      }
      const exportRaw = await getJson(
        `export/who-bought/product/${SIMPLESHOP_TICKET_PRODUCT_ID}/?strict=1`,
      );
      const envelope = exportEnvelopeSchema.safeParse(exportRaw);
      if (!envelope.success) {
        throw new SimpleShopTicketSourceError('invalid_payload');
      }
      if (Buffer.byteLength(envelope.data.csv, 'utf8') > maxResponseBytes) {
        throw new SimpleShopTicketSourceError('response_too_large');
      }
      return parseExport(envelope.data.csv, maxSourceRows, maxPreviewRows);
    },
  };
};
