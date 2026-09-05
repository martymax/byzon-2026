INSERT INTO "event_features" (
	"event_id",
	"announcements_enabled"
)
SELECT
	"id",
	true
FROM "events"
WHERE "slug" = 'byzon-2026'
ON CONFLICT ("event_id") DO UPDATE
SET
	"announcements_enabled" = true,
	"updated_at" = now();
