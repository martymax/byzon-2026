import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  ticketClaimAttempts,
  ticketEvents,
  ticketImportBatches,
  ticketImportRows,
  ticketSourceParticipants,
  tickets,
} from './tickets.js';

const tables = [
  ticketImportBatches,
  ticketImportRows,
  ticketSourceParticipants,
  tickets,
  ticketEvents,
  ticketClaimAttempts,
];

describe('stage 4 ticket infrastructure schema', () => {
  it.each(tables)('$0 is event-scoped and indexed', (table) => {
    const config = getTableConfig(table);
    expect(config.columns.map((column) => column.name)).toContain('event_id');
    expect(
      config.indexes.some((index) =>
        index.config.columns.some(
          (column) => 'name' in column && column.name === 'event_id',
        ),
      ),
    ).toBe(true);
  });

  it('never stores a raw ticket code', () => {
    for (const table of tables) {
      const columns = getTableConfig(table).columns.map(
        (column) => column.name,
      );
      expect(columns).not.toContain('code');
      expect(columns).not.toContain('raw_code');
      expect(columns).not.toContain('raw_row_json');
    }
    expect(
      getTableConfig(tickets).columns.map((column) => column.name),
    ).toEqual(expect.arrayContaining(['code_hmac', 'code_suffix']));
    expect(
      getTableConfig(ticketSourceParticipants).columns.map(
        (column) => column.name,
      ),
    ).not.toEqual(
      expect.arrayContaining([
        'contact_name',
        'contact_email',
        'code_hmac',
        'code_suffix',
      ]),
    );
  });

  it('deduplicates files, ticket codes and stable external ids per event', () => {
    expect(
      getTableConfig(ticketImportBatches).indexes.some(
        (index) =>
          index.config.name === 'ticket_import_batches_event_file_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(
      getTableConfig(tickets).indexes.some(
        (index) =>
          index.config.name === 'tickets_event_code_hmac_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(
      getTableConfig(ticketSourceParticipants).indexes.some(
        (index) =>
          index.config.name ===
            'ticket_source_participants_event_external_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(
      getTableConfig(tickets).indexes.some(
        (index) =>
          index.config.name === 'tickets_event_external_id_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
  });

  it('uses composite event foreign keys for owned relationships', () => {
    const references = [
      ...getTableConfig(ticketImportRows).foreignKeys,
      ...getTableConfig(ticketSourceParticipants).foreignKeys,
      ...getTableConfig(ticketEvents).foreignKeys,
      ...getTableConfig(tickets).foreignKeys,
    ].map((key) =>
      key
        .reference()
        .columns.map((column) => column.name)
        .join(','),
    );
    expect(references).toEqual(
      expect.arrayContaining([
        'event_id,batch_id',
        'event_id,ticket_id',
        'event_id,holder_user_id',
        'event_id,transferred_from_ticket_id',
        'event_id,actor_id',
      ]),
    );
  });
});
