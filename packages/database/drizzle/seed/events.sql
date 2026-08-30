-- Idempotent baseline seed. The isolation event is intentionally archived and
-- must never be exposed as an active/public event.
INSERT INTO "events" (
  "id",
  "slug",
  "name",
  "starts_at",
  "ends_at",
  "timezone",
  "status"
)
VALUES
  (
    '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
    'byzon-2026',
    'BYZON 2026',
    '2026-09-18T06:00:00Z',
    '2026-09-19T16:30:00Z',
    'Europe/Prague',
    'draft'
  ),
  (
    '019f7e6f-62ef-7270-b102-0e023ebd6663',
    'byzon-isolation-test',
    'BYZON – isolation test event',
    '2027-01-01T08:00:00Z',
    '2027-01-01T16:00:00Z',
    'Europe/Prague',
    'archived'
  )
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "event_features" ("event_id")
SELECT "id"
FROM "events"
WHERE "slug" IN ('byzon-2026', 'byzon-isolation-test')
ON CONFLICT ("event_id") DO NOTHING;

INSERT INTO "event_operational_settings" ("event_id")
SELECT "id"
FROM "events"
WHERE "slug" IN ('byzon-2026', 'byzon-isolation-test')
ON CONFLICT ("event_id") DO NOTHING;

INSERT INTO "event_admin_versions" ("event_id")
SELECT "id"
FROM "events"
WHERE "slug" IN ('byzon-2026', 'byzon-isolation-test')
ON CONFLICT ("event_id") DO NOTHING;
