import { createHash } from 'node:crypto';

const API_BASE_URL = 'https://api.simpleshop.cz/2.0/';
const API_HOST = 'api.simpleshop.cz';
const PRODUCT_ID = 143_958;
const FORM_KEY = '0MnNQ';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 8_000_000;
const MAX_CSV_ROWS = 10_000;
const MAX_CSV_COLUMNS = 500;

const credentials = {
  email: process.env.SIMPLESHOP_API_EMAIL,
  apiKey: process.env.SIMPLESHOP_API_KEY,
};

const fail = (code) => {
  throw new Error(code);
};

const requireCredentials = () => {
  if (
    typeof credentials.email !== 'string' ||
    credentials.email.length === 0 ||
    typeof credentials.apiKey !== 'string' ||
    credentials.apiKey.length === 0
  ) {
    fail('DISCOVERY_CREDENTIALS_MISSING');
  }
};

const assertAllowedUrl = (url) => {
  if (
    url.protocol !== 'https:' ||
    url.hostname !== API_HOST ||
    url.port !== '' ||
    !url.pathname.startsWith('/2.0/') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    fail('DISCOVERY_URL_REJECTED');
  }
};

const readBoundedResponse = async (response) => {
  const reader = response.body?.getReader();
  if (!reader) fail('DISCOVERY_RESPONSE_BODY_MISSING');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      fail('DISCOVERY_RESPONSE_TOO_LARGE');
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

const fetchJson = async (relativePath) => {
  const url = new URL(relativePath, API_BASE_URL);
  assertAllowedUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let bytes;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(
          `${credentials.email}:${credentials.apiKey}`,
          'utf8',
        ).toString('base64')}`,
      },
      redirect: 'error',
      signal: controller.signal,
    });
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_RESPONSE_BYTES)
    ) {
      fail('DISCOVERY_RESPONSE_TOO_LARGE');
    }
    if (!response.ok) fail(`DISCOVERY_HTTP_${response.status}`);
    const responseMediaType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (responseMediaType !== 'application/json') {
      fail('DISCOVERY_CONTENT_TYPE_REJECTED');
    }
    bytes = await readBoundedResponse(response);
  } catch (error) {
    if (
      error instanceof Error &&
      /^DISCOVERY_[A-Z0-9_]+$/.test(error.message)
    ) {
      throw error;
    }
    fail(
      controller.signal.aborted
        ? 'DISCOVERY_REQUEST_TIMEOUT'
        : 'DISCOVERY_REQUEST_FAILED',
    );
  } finally {
    clearTimeout(timeout);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('DISCOVERY_RESPONSE_NOT_UTF8');
  }
  try {
    return {
      status: response.status,
      byteSize: bytes.byteLength,
      body: JSON.parse(text),
    };
  } catch {
    fail('DISCOVERY_RESPONSE_NOT_JSON');
  }
};

const valueType = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const characterClasses = (value) => {
  const classes = new Set();
  for (const character of value) {
    if (/^[0-9]$/.test(character)) classes.add('digit');
    else if (/^[A-Z]$/.test(character)) classes.add('upper_ascii');
    else if (/^[a-z]$/.test(character)) classes.add('lower_ascii');
    else if (character === '-') classes.add('hyphen');
    else if (/^\s$/u.test(character)) classes.add('whitespace');
    else if (/^[\x20-\x7E]$/.test(character)) classes.add('other_ascii');
    else classes.add('non_ascii');
  }
  return [...classes].sort();
};

const schemaSummary = (root) => {
  const paths = new Map();
  const visit = (value, path, depth) => {
    if (depth > 12) fail('DISCOVERY_SCHEMA_DEPTH_EXCEEDED');
    const type = valueType(value);
    const current = paths.get(path) ?? {
      path,
      types: new Set(),
      occurrences: 0,
      arrayLengths: [],
      stringByteLengths: [],
      stringCharacterClasses: new Set(),
    };
    current.types.add(type);
    current.occurrences += 1;
    if (type === 'string') {
      current.stringByteLengths.push(Buffer.byteLength(value, 'utf8'));
      for (const item of characterClasses(value)) {
        current.stringCharacterClasses.add(item);
      }
    }
    if (type === 'array') current.arrayLengths.push(value.length);
    paths.set(path, current);

    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${path}[]`, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        visit(item, `${path}.${key}`, depth + 1);
      }
    }
  };
  visit(root, '$', 0);
  return [...paths.values()].map((entry) => ({
    path: entry.path,
    types: [...entry.types].sort(),
    occurrences: entry.occurrences,
    ...(entry.arrayLengths.length > 0
      ? {
          arrayLength: {
            min: Math.min(...entry.arrayLengths),
            max: Math.max(...entry.arrayLengths),
          },
        }
      : {}),
    ...(entry.stringByteLengths.length > 0
      ? {
          stringByteLength: {
            min: Math.min(...entry.stringByteLengths),
            max: Math.max(...entry.stringByteLengths),
          },
          stringCharacterClasses: [...entry.stringCharacterClasses].sort(),
        }
      : {}),
  }));
};

const findExactString = (root, expected) => {
  const paths = [];
  const visit = (value, path, depth) => {
    if (depth > 12) return;
    if (typeof value === 'string' && value.includes(expected)) paths.push(path);
    else if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, `${path}[${index}]`, depth + 1),
      );
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) =>
        visit(item, `${path}.${key}`, depth + 1),
      );
    }
  };
  visit(root, '$', 0);
  return paths;
};

const safeProductAssertions = (body) => ({
  responseIsObject:
    body !== null && typeof body === 'object' && !Array.isArray(body),
  idMatches:
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    String(body.id) === String(PRODUCT_ID),
  typeValueKind:
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (typeof body.type === 'string' || typeof body.type === 'number')
      ? typeof body.type
      : null,
  ticketTypeMatches:
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    String(body.type) === '9',
  archived:
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof body.archived === 'boolean'
      ? body.archived
      : null,
  testMode:
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof body.test_mode === 'boolean'
      ? body.test_mode
      : null,
  formKeyFoundAt: findExactString(body, FORM_KEY),
});

const delimiterFor = (value) => {
  const firstLine = value.split(/\r?\n/, 1)[0] ?? '';
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"') {
      if (quoted && firstLine[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && counts.has(character)) {
      counts.set(character, counts.get(character) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
};

const parseCsv = (value) => {
  const [delimiter, delimiterCount] = delimiterFor(value);
  if (delimiterCount === 0 || !/[\r\n]/.test(value)) return null;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
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
    else if (character === delimiter) {
      row.push(cell);
      cell = '';
      if (row.length > MAX_CSV_COLUMNS) fail('DISCOVERY_CSV_TOO_WIDE');
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      if (rows.length > MAX_CSV_ROWS + 1) fail('DISCOVERY_CSV_TOO_MANY_ROWS');
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) fail('DISCOVERY_CSV_MALFORMED');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  while (
    rows.length > 0 &&
    rows.at(-1).every((candidate) => candidate.length === 0)
  ) {
    rows.pop();
  }
  if (rows.length === 0) return null;
  const width = rows[0].length;
  if (width === 0 || rows.some((candidate) => candidate.length !== width)) {
    fail('DISCOVERY_CSV_INCONSISTENT_WIDTH');
  }
  return { delimiter, rows };
};

const sanitizeHeader = (value, index) => {
  if (
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/u.test(value)
  ) {
    return value;
  }
  return `unsafe_header_${index + 1}_${createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
    .slice(0, 12)}`;
};

const normalizedHeader = (value) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US');

const classifyCell = (value) => {
  if (value.length === 0) return 'empty';
  if (/^-?\d+$/.test(value)) return 'integer';
  if (/^-?\d+[.,]\d+$/.test(value)) return 'decimal';
  if (/^(?:true|false|ano|ne)$/i.test(value)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(value)) return 'date_like';
  return 'text';
};

const isCodeColumn = (header) =>
  /(ticket|vstupenk|voucher).*(code|kod)|(?:code|kod).*(ticket|vstupenk|voucher)/.test(
    normalizedHeader(header),
  );
const isTicketVoucherColumn = (header) =>
  /(ticket|vstupenk|voucher)/.test(normalizedHeader(header));
const isQuantityColumn = (header) =>
  /(quantity|amount|mnoz|pocet|qty|kus)/.test(normalizedHeader(header));
const isStatusColumn = (header) =>
  /(status|state|stav|flags?)/.test(normalizedHeader(header));
const isIdCandidate = (header) =>
  /(^|[^a-z])(id|invoice|order|doklad|objednav|faktur|cislo|number)/.test(
    normalizedHeader(header),
  );
const isProductColumn = (header) =>
  /product.*id|id.*product|produkt.*id|id.*produkt/.test(
    normalizedHeader(header),
  );
const isFormColumn = (header) =>
  /form.*(id|key|code|kod)|(?:id|key|code|kod).*form/.test(
    normalizedHeader(header),
  );

const summarizeColumn = (header, values) => {
  const nonEmpty = values.filter((value) => value.length > 0);
  const typeCounts = {};
  const lengths = [];
  const classes = new Set();
  const hashes = new Set();
  for (const value of values) {
    const type = classifyCell(value);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (value.length > 0) {
      lengths.push(Buffer.byteLength(value, 'utf8'));
      characterClasses(value).forEach((item) => classes.add(item));
      hashes.add(createHash('sha256').update(value, 'utf8').digest('hex'));
    }
  }
  const summary = {
    field: header,
    typeCounts,
    nonEmpty: nonEmpty.length,
    empty: values.length - nonEmpty.length,
    distinctNonEmpty: hashes.size,
    ...(lengths.length > 0
      ? {
          byteLength: { min: Math.min(...lengths), max: Math.max(...lengths) },
          characterClasses: [...classes].sort(),
        }
      : {}),
  };
  if (isStatusColumn(header)) {
    const distribution = new Map();
    for (const value of nonEmpty) {
      if (value.length > 40 || !/^[\p{L}\p{N}_. -]+$/u.test(value)) {
        fail('DISCOVERY_STATUS_VALUE_UNSAFE');
      }
      distribution.set(value, (distribution.get(value) ?? 0) + 1);
    }
    summary.safeValueCounts = Object.fromEntries(
      [...distribution.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }
  if (isQuantityColumn(header)) {
    const numericCounts = new Map();
    for (const value of nonEmpty) {
      if (!/^-?\d+(?:[.,]\d+)?$/.test(value)) continue;
      numericCounts.set(value, (numericCounts.get(value) ?? 0) + 1);
    }
    summary.numericValueCounts = Object.fromEntries(numericCounts);
  }
  if (isProductColumn(header)) {
    summary.expectedProductIdMatches = nonEmpty.filter(
      (value) => value === String(PRODUCT_ID),
    ).length;
  }
  if (isFormColumn(header)) {
    summary.expectedFormKeyMatches = nonEmpty.filter(
      (value) => value === FORM_KEY,
    ).length;
  }
  return summary;
};

const summarizeCsv = (parsed, sourcePath, encoding) => {
  const [rawHeaders, ...rows] = parsed.rows;
  const headers = rawHeaders.map(sanitizeHeader);
  const columns = headers.map((header, index) =>
    summarizeColumn(
      header,
      rows.map((row) => row[index]),
    ),
  );
  const indexFor = (pattern) =>
    headers.findIndex((header) => pattern.test(normalizedHeader(header)));
  const ticketIdIndex = indexFor(/^id vstupenky$/);
  const ticketCodeIndex = indexFor(/^kod vstupenky$/);
  const quantityIndex = indexFor(/^pocet$/);
  const statusIndex = indexFor(/^stav$/);
  const orderIdIndex = indexFor(/^id dokladu$/);
  const relationshipCounts = new Map();
  const orderRows = new Map();
  const orderTicketRows = new Map();
  for (const row of rows) {
    const ticketId = ticketIdIndex >= 0 ? row[ticketIdIndex] : '';
    const ticketCode = ticketCodeIndex >= 0 ? row[ticketCodeIndex] : '';
    const quantity = quantityIndex >= 0 ? row[quantityIndex] : '';
    const status = statusIndex >= 0 ? row[statusIndex] : '';
    if (
      status.length > 40 ||
      (status.length > 0 && !/^[\p{L}\p{N}_. -]+$/u.test(status)) ||
      (quantity.length > 0 && !/^\d+$/.test(quantity))
    ) {
      fail('DISCOVERY_RELATIONSHIP_VALUE_UNSAFE');
    }
    const signature = JSON.stringify({
      status: status || 'empty',
      quantity: quantity || 'empty',
      ticketId: ticketId.length > 0 ? 'present' : 'empty',
      ticketCode: ticketCode.length > 0 ? 'present' : 'empty',
    });
    relationshipCounts.set(
      signature,
      (relationshipCounts.get(signature) ?? 0) + 1,
    );
    if (orderIdIndex >= 0 && row[orderIdIndex].length > 0) {
      const orderHash = createHash('sha256')
        .update(row[orderIdIndex], 'utf8')
        .digest('hex');
      orderRows.set(orderHash, (orderRows.get(orderHash) ?? 0) + 1);
      if (ticketId.length > 0 && ticketCode.length > 0) {
        orderTicketRows.set(
          orderHash,
          (orderTicketRows.get(orderHash) ?? 0) + 1,
        );
      }
    }
  }
  const histogram = (values) => {
    const result = new Map();
    for (const value of values) {
      result.set(String(value), (result.get(String(value)) ?? 0) + 1);
    }
    return Object.fromEntries(
      [...result.entries()].sort(
        ([left], [right]) => Number(left) - Number(right),
      ),
    );
  };
  return {
    sourcePath,
    encoding,
    delimiter:
      parsed.delimiter === '\t'
        ? 'tab'
        : parsed.delimiter === ';'
          ? 'semicolon'
          : 'comma',
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    stableExternalIdCandidates: columns
      .filter(({ field }) => isIdCandidate(field))
      .map(({ field, nonEmpty, distinctNonEmpty, typeCounts, byteLength }) => ({
        field,
        nonEmpty,
        distinctNonEmpty,
        duplicateNonEmpty: nonEmpty - distinctNonEmpty,
        typeCounts,
        byteLength,
      })),
    statusAndFlagFields: columns.filter(({ field }) => isStatusColumn(field)),
    quantityFields: columns.filter(({ field }) => isQuantityColumn(field)),
    ticketAndVoucherFields: columns.filter(({ field }) =>
      isTicketVoucherColumn(field),
    ),
    codeFields: columns.filter(({ field }) => isCodeColumn(field)),
    productAndFormFields: columns.filter(
      ({ field }) => isProductColumn(field) || isFormColumn(field),
    ),
    relationships: {
      rowSignatures: [...relationshipCounts.entries()].map(
        ([signature, count]) => ({ ...JSON.parse(signature), count }),
      ),
      rowsPerOrder: histogram(orderRows.values()),
      ticketRowsPerOrder: histogram(orderTicketRows.values()),
    },
    columns,
  };
};

const maybeDecodedCsv = (value) => {
  const direct = parseCsv(value);
  if (direct) return { parsed: direct, encoding: 'utf8-json-string' };
  if (
    value.length < 16 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return null;
  }
  let decoded;
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.byteLength > MAX_RESPONSE_BYTES) return null;
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const parsed = parseCsv(decoded);
  return parsed ? { parsed, encoding: 'base64-utf8-json-string' } : null;
};

const findCsvPayloads = (root) => {
  const payloads = [];
  const visit = (value, path, depth) => {
    if (depth > 12) return;
    if (typeof value === 'string') {
      const candidate = maybeDecodedCsv(value);
      if (candidate) {
        payloads.push(summarizeCsv(candidate.parsed, path, candidate.encoding));
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, `${path}[${index}]`, depth + 1),
      );
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) =>
        visit(item, `${path}.${key}`, depth + 1),
      );
    }
  };
  visit(root, '$', 0);
  return payloads;
};

const sanitizedResponse = (response, includeProductAssertions = false) => ({
  httpStatus: response.status,
  responseByteSize: response.byteSize,
  schema: schemaSummary(response.body),
  ...(includeProductAssertions
    ? { assertions: safeProductAssertions(response.body) }
    : {}),
  csvPayloads: findCsvPayloads(response.body),
});

const main = async () => {
  requireCredentials();
  const [product, strictExport, allFormsExport] = await Promise.all([
    fetchJson(`product/${PRODUCT_ID}/`),
    fetchJson(`export/who-bought/product/${PRODUCT_ID}/?strict=1`),
    fetchJson(`export/who-bought/product/${PRODUCT_ID}/?strict=0`),
  ]);
  const report = {
    mode: 'read-only-get-discovery',
    apiBase: API_BASE_URL,
    productId: PRODUCT_ID,
    expectedFormKey: FORM_KEY,
    limits: {
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      maxCsvRows: MAX_CSV_ROWS,
      maxCsvColumns: MAX_CSV_COLUMNS,
    },
    endpoints: {
      product: {
        method: 'GET',
        path: `/2.0/product/${PRODUCT_ID}/`,
        result: sanitizedResponse(product, true),
      },
      whoBoughtStrict: {
        method: 'GET',
        path: `/2.0/export/who-bought/product/${PRODUCT_ID}/?strict=1`,
        result: sanitizedResponse(strictExport),
      },
      whoBoughtAllForms: {
        method: 'GET',
        path: `/2.0/export/who-bought/product/${PRODUCT_ID}/?strict=0`,
        result: sanitizedResponse(allFormsExport),
      },
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error) => {
  const code =
    error instanceof Error && /^DISCOVERY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'DISCOVERY_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
