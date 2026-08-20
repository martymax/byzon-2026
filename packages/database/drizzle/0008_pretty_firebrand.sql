CREATE TYPE "public"."agenda_item_source" AS ENUM('manual', 'organizer');--> statement-breakpoint
CREATE TABLE "agenda_items" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source" "agenda_item_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agenda_items_pk" PRIMARY KEY("event_id","user_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "participant_agendas" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_agendas_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "participant_agendas_version_check" CHECK ("participant_agendas"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_participant_agenda_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."participant_agendas"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_agendas" ADD CONSTRAINT "participant_agendas_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_items_event_session_idx" ON "agenda_items" USING btree ("event_id","session_id");--> statement-breakpoint
CREATE INDEX "participant_agendas_user_id_idx" ON "participant_agendas" USING btree ("user_id");--> statement-breakpoint
DO $$
DECLARE
	"candidate" record;
	"provenance_count" integer;
	"matching_count" integer;
	"over_capacity_count" integer;
BEGIN
	LOCK TABLE "reservations" IN SHARE MODE;

	FOR "candidate" IN
		SELECT DISTINCT "provenance"."event_id"
		FROM "content_import_provenance" AS "provenance"
		WHERE
			"provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "provenance"."source_path" IN (
				'program.days[0].stages[1].events[10]',
				'program.days[1].stages[0].events[2]',
				'program.days[1].stages[0].events[4]'
			)
	LOOP
		SELECT count(*)
		INTO "provenance_count"
		FROM "content_import_provenance" AS "provenance"
		WHERE
			"provenance"."event_id" = "candidate"."event_id"
			AND "provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "provenance"."source_path" IN (
				'program.days[0].stages[1].events[10]',
				'program.days[1].stages[0].events[2]',
				'program.days[1].stages[0].events[4]'
			);

		SELECT
			count(*),
			count(*) FILTER (
				WHERE (
					SELECT count(*)
					FROM "reservations" AS "reservation"
					WHERE
						"reservation"."event_id" = "session"."event_id"
						AND "reservation"."session_id" = "session"."id"
						AND "reservation"."status" = 'confirmed'
				) > CASE
					WHEN "provenance"."source_path" = 'program.days[0].stages[1].events[10]' THEN 12
					ELSE 20
				END
			)
		INTO "matching_count", "over_capacity_count"
		FROM "content_import_provenance" AS "provenance"
		INNER JOIN "sessions" AS "session"
			ON "session"."event_id" = "provenance"."event_id"
			AND "session"."id" = "provenance"."target_id"
		WHERE
			"provenance"."event_id" = "candidate"."event_id"
			AND "provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "session"."status" = 'draft'
			AND (
				(
					"provenance"."source_path" = 'program.days[0].stages[1].events[10]'
					AND "session"."title" = 'Expertní Board 21 - mastermind session'
					AND "session"."starts_at" = '2026-09-18T15:15:00+02:00'::timestamptz
				)
				OR (
					"provenance"."source_path" = 'program.days[1].stages[0].events[2]'
					AND "session"."title" = 'Workshop: Leonid Kushnir'
					AND "session"."starts_at" = '2026-09-19T09:30:00+02:00'::timestamptz
				)
				OR (
					"provenance"."source_path" = 'program.days[1].stages[0].events[4]'
					AND "session"."title" = 'Workshop: Blanka Mrázková'
					AND "session"."starts_at" = '2026-09-19T11:15:00+02:00'::timestamptz
				)
			);

		IF "provenance_count" <> 3 OR "matching_count" <> 3 THEN
			RAISE EXCEPTION 'Reservation policy backfill validation failed for event %', "candidate"."event_id"
				USING ERRCODE = 'check_violation';
		END IF;

		IF "over_capacity_count" <> 0 THEN
			RAISE EXCEPTION 'Reservation policy backfill would reduce capacity below confirmed reservations for event %', "candidate"."event_id"
				USING ERRCODE = 'check_violation';
		END IF;
	END LOOP;
END $$;--> statement-breakpoint
UPDATE "sessions" AS "session"
SET
	"type" = CASE
		WHEN "provenance"."source_path" = 'program.days[0].stages[1].events[10]' THEN 'mastermind'::"session_type"
		ELSE 'workshop'::"session_type"
	END,
	"capacity_mode" = 'reservation'::"capacity_mode",
	"capacity" = CASE
		WHEN "provenance"."source_path" = 'program.days[0].stages[1].events[10]' THEN 12
		ELSE 20
	END,
	"reservation_closes_at" = "session"."starts_at",
	"waitlist_mode" = 'disabled'::"waitlist_mode",
	"updated_at" = now()
FROM "content_import_provenance" AS "provenance"
WHERE
	"provenance"."event_id" = "session"."event_id"
	AND "provenance"."target_id" = "session"."id"
	AND "provenance"."source_name" = 'static-site/data/content.json'
	AND "provenance"."target_type" = 'session'
	AND "provenance"."source_path" IN (
		'program.days[0].stages[1].events[10]',
		'program.days[1].stages[0].events[2]',
		'program.days[1].stages[0].events[4]'
	)
	AND "session"."status" = 'draft'
	AND (
		(
			"provenance"."source_path" = 'program.days[0].stages[1].events[10]'
			AND "session"."title" = 'Expertní Board 21 - mastermind session'
			AND "session"."starts_at" = '2026-09-18T15:15:00+02:00'::timestamptz
		)
		OR (
			"provenance"."source_path" = 'program.days[1].stages[0].events[2]'
			AND "session"."title" = 'Workshop: Leonid Kushnir'
			AND "session"."starts_at" = '2026-09-19T09:30:00+02:00'::timestamptz
		)
		OR (
			"provenance"."source_path" = 'program.days[1].stages[0].events[4]'
			AND "session"."title" = 'Workshop: Blanka Mrázková'
			AND "session"."starts_at" = '2026-09-19T11:15:00+02:00'::timestamptz
		)
	);
