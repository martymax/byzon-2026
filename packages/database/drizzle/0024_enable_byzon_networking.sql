INSERT INTO "event_features" (
	"event_id",
	"networking_enabled"
)
SELECT
	"id",
	true
FROM "events"
WHERE "slug" = 'byzon-2026'
ON CONFLICT ("event_id") DO UPDATE
SET
	"networking_enabled" = true,
	"updated_at" = now();
