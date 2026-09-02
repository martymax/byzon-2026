ALTER TABLE "sessions" ADD COLUMN "reservation_group_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_reservation_group_event_fk" FOREIGN KEY ("event_id","reservation_group_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_event_reservation_group_idx" ON "sessions" USING btree ("event_id","reservation_group_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_reservation_group_policy_check" CHECK ("sessions"."reservation_group_id" is null or "sessions"."capacity_mode" = 'reservation');--> statement-breakpoint
DO $$
DECLARE
	"candidate" record;
	"matching_count" integer;
	"participant_state_count" integer;
BEGIN
	LOCK TABLE "reservations" IN SHARE MODE;
	LOCK TABLE "waitlist_entries" IN SHARE MODE;

	FOR "candidate" IN
		SELECT DISTINCT "provenance"."event_id"
		FROM "content_import_provenance" AS "provenance"
		WHERE
			"provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "provenance"."source_path" IN (
				'program.days[1].stages[1].events[1]',
				'program.days[1].stages[1].events[3]'
			)
	LOOP
		SELECT count(*)
		INTO "matching_count"
		FROM "content_import_provenance" AS "provenance"
		INNER JOIN "sessions" AS "session"
			ON "session"."event_id" = "provenance"."event_id"
			AND "session"."id" = "provenance"."target_id"
		WHERE
			"provenance"."event_id" = "candidate"."event_id"
			AND "provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "session"."status" IN ('draft', 'published')
			AND (
				(
					"provenance"."source_path" = 'program.days[1].stages[1].events[1]'
					AND "session"."title" = 'Mastermind část 1'
					AND "session"."starts_at" = '2026-09-19T09:30:00+02:00'::timestamptz
				)
				OR (
					"provenance"."source_path" = 'program.days[1].stages[1].events[3]'
					AND "session"."title" = 'Mastermind část 2'
					AND "session"."starts_at" = '2026-09-19T11:15:00+02:00'::timestamptz
				)
			);

		IF "matching_count" <> 2 THEN
			RAISE EXCEPTION 'Mastermind reservation group validation failed for event %', "candidate"."event_id"
				USING ERRCODE = 'check_violation';
		END IF;

		SELECT count(*)
		INTO "participant_state_count"
		FROM (
			SELECT "reservation"."id"
			FROM "reservations" AS "reservation"
			WHERE
				"reservation"."event_id" = "candidate"."event_id"
				AND "reservation"."session_id" IN (
					SELECT "provenance"."target_id"
					FROM "content_import_provenance" AS "provenance"
					WHERE
						"provenance"."event_id" = "candidate"."event_id"
						AND "provenance"."source_name" = 'static-site/data/content.json'
						AND "provenance"."target_type" = 'session'
						AND "provenance"."source_path" IN (
							'program.days[1].stages[1].events[1]',
							'program.days[1].stages[1].events[3]'
						)
				)
			UNION ALL
			SELECT "waitlist"."id"
			FROM "waitlist_entries" AS "waitlist"
			WHERE
				"waitlist"."event_id" = "candidate"."event_id"
				AND "waitlist"."session_id" IN (
					SELECT "provenance"."target_id"
					FROM "content_import_provenance" AS "provenance"
					WHERE
						"provenance"."event_id" = "candidate"."event_id"
						AND "provenance"."source_name" = 'static-site/data/content.json'
						AND "provenance"."target_type" = 'session'
						AND "provenance"."source_path" IN (
							'program.days[1].stages[1].events[1]',
							'program.days[1].stages[1].events[3]'
						)
				)
		) AS "participant_state";

		IF "participant_state_count" <> 0 THEN
			RAISE EXCEPTION 'Mastermind reservation group contains participant state for event %', "candidate"."event_id"
				USING ERRCODE = 'check_violation';
		END IF;
	END LOOP;
END $$;--> statement-breakpoint
WITH "mastermind_group" AS (
	SELECT
		"provenance"."event_id",
		"provenance"."target_id",
		"group_root_provenance"."target_id" AS "group_id"
	FROM "content_import_provenance" AS "provenance"
	INNER JOIN "content_import_provenance" AS "group_root_provenance"
		ON "group_root_provenance"."event_id" = "provenance"."event_id"
		AND "group_root_provenance"."source_name" = 'static-site/data/content.json'
		AND "group_root_provenance"."target_type" = 'session'
		AND "group_root_provenance"."source_path" = 'program.days[1].stages[1].events[1]'
	WHERE
		"provenance"."source_name" = 'static-site/data/content.json'
		AND "provenance"."target_type" = 'session'
		AND "provenance"."source_path" IN (
			'program.days[1].stages[1].events[1]',
			'program.days[1].stages[1].events[3]'
		)
)
UPDATE "sessions" AS "session"
SET
	"type" = 'mastermind'::"session_type",
	"reservation_group_id" = "mastermind_group"."group_id",
	"capacity_mode" = 'reservation'::"capacity_mode",
	"capacity" = 6,
	"reservation_closes_at" = "group_root"."starts_at",
	"waitlist_mode" = 'disabled'::"waitlist_mode",
	"waitlist_offer_ttl_minutes" = null,
	"allow_release_after_deadline" = false,
	"version" = "session"."version" + 1,
	"updated_at" = now()
FROM "mastermind_group"
INNER JOIN "sessions" AS "group_root"
	ON "group_root"."event_id" = "mastermind_group"."event_id"
	AND "group_root"."id" = "mastermind_group"."group_id"
WHERE
	"session"."event_id" = "mastermind_group"."event_id"
	AND "session"."id" = "mastermind_group"."target_id";
