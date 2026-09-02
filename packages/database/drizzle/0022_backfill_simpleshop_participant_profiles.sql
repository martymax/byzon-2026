WITH "imported_users" AS (
	SELECT
		"event_id",
		"user_id",
		min("created_at") AS "imported_at"
	FROM "ticket_source_participants"
	GROUP BY "event_id", "user_id"
),
"normalized_imported_users" AS (
	SELECT
		"imported_users"."event_id",
		"imported_users"."user_id",
		"imported_users"."imported_at",
		"user"."email",
		regexp_replace(
			coalesce(nullif(btrim("user"."name"), ''), 'Nový účastník'),
			'[[:space:]]+',
			' ',
			'g'
		) AS "display_name"
	FROM "imported_users"
	INNER JOIN "user" ON "user"."id" = "imported_users"."user_id"
)
INSERT INTO "participant_profiles" (
	"event_id",
	"user_id",
	"first_name",
	"last_name",
	"contact_email",
	"networking_enabled",
	"created_at",
	"updated_at"
)
SELECT
	"event_id",
	"user_id",
	left(split_part("display_name", ' ', 1), 128),
	left(
		CASE
			WHEN strpos("display_name", ' ') > 0
				THEN btrim(substr("display_name", strpos("display_name", ' ') + 1))
			ELSE 'Účastník'
		END,
		128
	),
	"email",
	false,
	"imported_at",
	"imported_at"
FROM "normalized_imported_users"
ON CONFLICT ("event_id", "user_id") DO NOTHING;
