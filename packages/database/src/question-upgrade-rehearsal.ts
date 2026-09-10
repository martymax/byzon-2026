/** Isolated upgrade rehearsal. Never migrates or drops the supplied database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const source = process.env.TEST_DATABASE_URL;
if (!source)
  throw new Error(
    'TEST_DATABASE_URL with CREATE DATABASE permission is required',
  );
const name = `byzon_question_upgrade_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: source });
await admin.connect();
let created = false;
let client: pg.Client | undefined;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const target = new URL(source);
  target.pathname = `/${name}`;
  client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  const db = drizzle(client);
  const migrationDir = fileURLToPath(new URL('../drizzle', import.meta.url));
  const previous = await mkdtemp(join(tmpdir(), 'byzon-question-upgrade-'));
  await cp(migrationDir, previous, { recursive: true });
  const journal = JSON.parse(
    await readFile(join(previous, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx < 28);
  await writeFile(
    join(previous, 'meta/_journal.json'),
    JSON.stringify(journal),
  );
  await migrate(db, { migrationsFolder: previous });
  const inventory = JSON.parse(
    await readFile(
      new URL('../data/question-session-inventory-2026.json', import.meta.url),
      'utf8',
    ),
  ) as {
    sessions: {
      sessionSlug: string;
      sourcePath: string;
      roomSlug: string;
      localDate: string;
      time: string;
      title: string;
    }[];
  };
  const eventId = randomUUID(),
    dayId = randomUUID(),
    venueId = randomUUID();
  await client.query(
    "insert into events(id,slug,name,timezone,starts_at,ends_at,status) values($1,'byzon-2026','Upgrade rehearsal','Europe/Prague','2026-09-18T06:00Z','2026-09-19T20:00Z','live')",
    [eventId],
  );
  await client.query(
    'insert into event_features(event_id,questions_enabled) values($1,true)',
    [eventId],
  );
  await client.query(
    "insert into event_days(id,event_id,local_date,title,sort_order) values($1,$2,'2026-09-18','Friday',0)",
    [dayId, eventId],
  );
  await client.query(
    "insert into venues(id,event_id,slug,name,status,sort_order) values($1,$2,'venue','Venue','published',0)",
    [venueId, eventId],
  );
  const rooms = new Map<string, string>();
  for (const slug of new Set(inventory.sessions.map((s) => s.roomSlug))) {
    const id = randomUUID();
    rooms.set(slug, id);
    await client.query(
      "insert into rooms(id,event_id,venue_id,slug,name,status,sort_order) values($1,$2,$3,$4::text,$4::text,'published',0)",
      [id, eventId, venueId, slug],
    );
  }
  const ids: string[] = [];
  for (const [index, s] of inventory.sessions.entries()) {
    const id = randomUUID();
    ids.push(id);
    const times = [...s.time.matchAll(/(\d{1,2}):(\d{2})/g)].map(
      (m) => `${s.localDate}T${m[1]!.padStart(2, '0')}:${m[2]}:00+02:00`,
    );
    await client.query(
      "insert into sessions(id,event_id,day_id,room_id,slug,title,type,status,starts_at,ends_at,sort_order,questions_enabled) values($1,$2,$3,$4,$5,$6,'talk','published',$7,$8,$9,true)",
      [
        id,
        eventId,
        dayId,
        rooms.get(s.roomSlug),
        index === 0 ? 'legacy-import-slug' : s.sessionSlug,
        s.title,
        times[0],
        times[1],
        index,
      ],
    );
    if (index === 0)
      await client.query(
        "insert into content_import_provenance(id,event_id,source_name,source_path,source_sha256,target_type,target_id) values($1,$2,'static-site/data/content.json',$3,$4,'session',$5)",
        [randomUUID(), eventId, s.sourcePath, 'a'.repeat(64), id],
      );
  }
  for (const slug of ['eb21-mastermind', 'jak-na-networking'])
    await client.query(
      "insert into sessions(id,event_id,day_id,room_id,slug,title,type,status,starts_at,ends_at,sort_order) values($1,$2,$3,$4,$5::text,$5::text,'other','published','2026-09-18T06:00Z','2026-09-18T07:00Z',50)",
      [randomUUID(), eventId, dayId, [...rooms.values()][0], slug],
    );
  await migrate(db, { migrationsFolder: migrationDir });
  const supported = await client.query<{
    id: string;
    questions_enabled: boolean;
  }>(
    "select id,questions_enabled from sessions where question_mode='moderated_follow_up'",
  );
  assert.deepEqual(supported.rows.map((r) => r.id).sort(), ids.sort());
  assert(supported.rows.every((r) => !r.questions_enabled));
  const flags = await client.query(
    'select questions_enabled,question_followups_enabled from event_features where event_id=$1',
    [eventId],
  );
  assert.deepEqual(flags.rows, [
    { questions_enabled: false, question_followups_enabled: false },
  ]);
  const excluded = await client.query(
    "select count(*)::integer as count from sessions where question_mode='disabled'",
  );
  assert.equal(excluded.rows[0].count, 2);
  await migrate(db, { migrationsFolder: migrationDir });
  console.log(
    JSON.stringify({
      result: 'passed',
      upgrade: '0027 -> 0028',
      supported: supported.rows.length,
      excluded: 2,
      legacyProvenance: true,
      collection: false,
      followUps: false,
      repeatMigration: true,
    }),
  );
} finally {
  await client?.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
