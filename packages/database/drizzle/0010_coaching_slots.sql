DO $$
DECLARE
	"v_event_id" uuid;
	"legacy_count" integer;
	"unreconciled_legacy_count" integer;
	"legacy_matching_count" integer;
	"legacy_state_count" integer;
BEGIN
	SELECT "id" INTO "v_event_id"
	FROM "events"
	WHERE "slug" = 'byzon-2026';

	IF "v_event_id" IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(
			hashtextextended('content-publish:' || "v_event_id"::text, 0)
		);
	END IF;

	SELECT count(*)
	INTO "legacy_count"
	FROM "content_import_provenance" AS "provenance"
	INNER JOIN "events" AS "event"
		ON "event"."id" = "provenance"."event_id"
	WHERE
		"event"."slug" = 'byzon-2026'
		AND "provenance"."source_name" = 'static-site/data/content.json'
		AND "provenance"."target_type" = 'session'
		AND "provenance"."source_path" IN (
			'program.days[0].stages[2].events[0]',
			'program.days[0].stages[2].events[1]',
			'program.days[0].stages[2].events[3]',
			'program.days[0].stages[2].events[4]',
			'program.days[0].stages[2].events[5]',
			'program.days[0].stages[2].events[7]',
			'program.days[0].stages[2].events[8]',
			'program.days[0].stages[2].events[9]',
			'program.days[0].stages[2].events[11]',
			'program.days[0].stages[2].events[12]',
			'program.days[0].stages[2].events[13]'
		);

	IF "legacy_count" NOT IN (0, 11) THEN
		RAISE EXCEPTION 'Legacy coaching import is incomplete'
			USING ERRCODE = 'check_violation';
	END IF;

	IF "legacy_count" = 0 AND "v_event_id" IS NOT NULL THEN
		SELECT count(*)
		INTO "unreconciled_legacy_count"
		FROM "sessions"
		WHERE
			"event_id" = "v_event_id"
			AND (
				"title" = 'Koučovací sloty'
				OR "slug" LIKE 'koucovaci-zona-koucovaci-sloty-%'
			);

		IF "unreconciled_legacy_count" <> 0 THEN
			RAISE EXCEPTION 'Legacy coaching source paths require reconciliation'
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;

	IF "legacy_count" = 11 THEN
		SELECT
			count(*),
			count(*) FILTER (
				WHERE EXISTS (
					SELECT 1
					FROM "agenda_items" AS "agenda_item"
					WHERE
						"agenda_item"."event_id" = "session"."event_id"
						AND "agenda_item"."session_id" = "session"."id"
				)
				OR EXISTS (
					SELECT 1
					FROM "reservations" AS "reservation"
					WHERE
						"reservation"."event_id" = "session"."event_id"
						AND "reservation"."session_id" = "session"."id"
				)
				OR EXISTS (
					SELECT 1
					FROM "waitlist_entries" AS "waitlist"
					WHERE
						"waitlist"."event_id" = "session"."event_id"
						AND "waitlist"."session_id" = "session"."id"
				)
			)
		INTO "legacy_matching_count", "legacy_state_count"
		FROM "content_import_provenance" AS "provenance"
		INNER JOIN "events" AS "event"
			ON "event"."id" = "provenance"."event_id"
		INNER JOIN "sessions" AS "session"
			ON "session"."event_id" = "provenance"."event_id"
			AND "session"."id" = "provenance"."target_id"
		WHERE
			"event"."slug" = 'byzon-2026'
			AND "provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "provenance"."source_path" IN (
				'program.days[0].stages[2].events[0]',
				'program.days[0].stages[2].events[1]',
				'program.days[0].stages[2].events[3]',
				'program.days[0].stages[2].events[4]',
				'program.days[0].stages[2].events[5]',
				'program.days[0].stages[2].events[7]',
				'program.days[0].stages[2].events[8]',
				'program.days[0].stages[2].events[9]',
				'program.days[0].stages[2].events[11]',
				'program.days[0].stages[2].events[12]',
				'program.days[0].stages[2].events[13]'
			)
			AND "session"."title" = 'Koučovací sloty'
			AND "session"."type" = 'other'
			AND "session"."capacity_mode" = 'none'
			AND "session"."capacity" IS NULL
			AND "session"."status" IN ('draft', 'archived');

		IF "legacy_matching_count" <> 11 THEN
			RAISE EXCEPTION 'Legacy coaching sessions require source reconciliation'
				USING ERRCODE = 'check_violation';
		END IF;
		IF "legacy_state_count" <> 0 THEN
			RAISE EXCEPTION 'Legacy coaching sessions contain participant state'
				USING ERRCODE = 'check_violation';
		END IF;

		UPDATE "sessions" AS "session"
		SET "status" = 'archived', "updated_at" = now()
		FROM "content_import_provenance" AS "provenance"
		INNER JOIN "events" AS "event"
			ON "event"."id" = "provenance"."event_id"
		WHERE
			"event"."slug" = 'byzon-2026'
			AND "session"."event_id" = "provenance"."event_id"
			AND "session"."id" = "provenance"."target_id"
			AND "session"."status" = 'draft'
			AND "provenance"."source_name" = 'static-site/data/content.json'
			AND "provenance"."target_type" = 'session'
			AND "provenance"."source_path" IN (
				'program.days[0].stages[2].events[0]',
				'program.days[0].stages[2].events[1]',
				'program.days[0].stages[2].events[3]',
				'program.days[0].stages[2].events[4]',
				'program.days[0].stages[2].events[5]',
				'program.days[0].stages[2].events[7]',
				'program.days[0].stages[2].events[8]',
				'program.days[0].stages[2].events[9]',
				'program.days[0].stages[2].events[11]',
				'program.days[0].stages[2].events[12]',
				'program.days[0].stages[2].events[13]'
			);
	END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE
	"v_event_id" uuid;
	"v_day_id" uuid;
	"candidate" record;
	"existing" record;
	"v_target_id" uuid;
BEGIN
	SELECT "event"."id", "day"."id"
	INTO "v_event_id", "v_day_id"
	FROM "events" AS "event"
	INNER JOIN "event_days" AS "day"
		ON "day"."event_id" = "event"."id"
		AND "day"."local_date" = '2026-09-18'
	WHERE "event"."slug" = 'byzon-2026';

	IF "v_event_id" IS NOT NULL THEN
		FOR "candidate" IN
			SELECT *
			FROM (VALUES
				('01a02180-5975-7214-ab86-c17f11477e64'::uuid, '01a02180-f637-72d2-888c-1c2fbe45abdb'::uuid, 'koucink-radim-0915', 'Koučink – Radim Roček', '2026-09-18T09:15:00+02:00'::timestamptz, '2026-09-18T09:45:00+02:00'::timestamptz, 2000, 'Pátek!G4:I4#radim'),
				('01a02180-5975-75c4-b300-a4e9d5f3702f'::uuid, '01a02180-f638-7e92-a409-da0ada208f08'::uuid, 'koucink-stana-0915', 'Koučink – Stanislava Maunová', '2026-09-18T09:15:00+02:00'::timestamptz, '2026-09-18T09:45:00+02:00'::timestamptz, 2001, 'Pátek!G4:I4#stana'),
				('01a02180-5975-79bb-afba-4c0f6baa4c83'::uuid, '01a02180-f638-7a71-86ee-f9b73a48a7e4'::uuid, 'koucink-radim-0945', 'Koučink – Radim Roček', '2026-09-18T09:45:00+02:00'::timestamptz, '2026-09-18T10:15:00+02:00'::timestamptz, 2010, 'Pátek!G5:I5#radim'),
				('01a02180-5975-72b9-ad49-82ea4d40619e'::uuid, '01a02180-f638-7fe0-9ad3-e3f84941d203'::uuid, 'koucink-stana-0945', 'Koučink – Stanislava Maunová', '2026-09-18T09:45:00+02:00'::timestamptz, '2026-09-18T10:15:00+02:00'::timestamptz, 2011, 'Pátek!G5:I5#stana'),
				('01a02180-5975-7c1e-8c4e-301cfb33d302'::uuid, '01a02180-f638-74cc-a348-de4d7a61280b'::uuid, 'koucink-radim-1015', 'Koučink – Radim Roček', '2026-09-18T10:15:00+02:00'::timestamptz, '2026-09-18T10:45:00+02:00'::timestamptz, 2020, 'Pátek!G6:I6#radim'),
				('01a02180-5975-7f7a-bff0-42ef7265aada'::uuid, '01a02180-f638-71b2-9d98-bc6f3e1b795d'::uuid, 'koucink-stana-1015', 'Koučink – Stanislava Maunová', '2026-09-18T10:15:00+02:00'::timestamptz, '2026-09-18T10:45:00+02:00'::timestamptz, 2021, 'Pátek!G6:I6#stana'),
				('01a02180-5975-7b12-b8a8-148c3a223a6a'::uuid, '01a02180-f638-7316-9e8f-848c5ec4c8a4'::uuid, 'koucink-radim-1045', 'Koučink – Radim Roček', '2026-09-18T10:45:00+02:00'::timestamptz, '2026-09-18T11:15:00+02:00'::timestamptz, 2030, 'Pátek!G7:I7#radim'),
				('01a02180-5975-774f-87fe-5849dbae2135'::uuid, '01a02180-f638-7c7e-8f5d-52e429f24f8c'::uuid, 'koucink-stana-1045', 'Koučink – Stanislava Maunová', '2026-09-18T10:45:00+02:00'::timestamptz, '2026-09-18T11:15:00+02:00'::timestamptz, 2031, 'Pátek!G7:I7#stana'),
				('01a02180-5975-7f01-bc9f-a43a7529e9d6'::uuid, '01a02180-f638-735f-8932-1f27f7e78f6f'::uuid, 'koucink-radim-1115', 'Koučink – Radim Roček', '2026-09-18T11:15:00+02:00'::timestamptz, '2026-09-18T11:45:00+02:00'::timestamptz, 2040, 'Pátek!G8:I8#radim'),
				('01a02180-5975-70bb-82a9-faef9204260f'::uuid, '01a02180-f638-74a5-a043-515831c1e78f'::uuid, 'koucink-stana-1115', 'Koučink – Stanislava Maunová', '2026-09-18T11:15:00+02:00'::timestamptz, '2026-09-18T11:45:00+02:00'::timestamptz, 2041, 'Pátek!G8:I8#stana'),
				('01a02180-5975-7ba9-8fdf-6dce3a9c2b58'::uuid, '01a02180-f638-7340-9726-cbe4ad36c04c'::uuid, 'koucink-radim-1145', 'Koučink – Radim Roček', '2026-09-18T11:45:00+02:00'::timestamptz, '2026-09-18T12:15:00+02:00'::timestamptz, 2050, 'Pátek!G9:I9#radim'),
				('01a02180-5975-7b39-ab6f-d2a55a1be302'::uuid, '01a02180-f638-730a-80e8-efbddcb09f54'::uuid, 'koucink-stana-1145', 'Koučink – Stanislava Maunová', '2026-09-18T11:45:00+02:00'::timestamptz, '2026-09-18T12:15:00+02:00'::timestamptz, 2051, 'Pátek!G9:I9#stana'),
				('01a02180-5975-7c8a-ab40-7e05b3779963'::uuid, '01a02180-f638-7b61-8df4-5df6268da039'::uuid, 'koucink-radim-1215', 'Koučink – Radim Roček', '2026-09-18T12:15:00+02:00'::timestamptz, '2026-09-18T12:45:00+02:00'::timestamptz, 2060, 'Pátek!G10:I10#radim'),
				('01a02180-5975-703a-b4ca-2eb5a23ae76c'::uuid, '01a02180-f638-79e8-809a-57da3e946e23'::uuid, 'koucink-stana-1215', 'Koučink – Stanislava Maunová', '2026-09-18T12:15:00+02:00'::timestamptz, '2026-09-18T12:45:00+02:00'::timestamptz, 2061, 'Pátek!G10:I10#stana'),
				('01a02180-5975-7fc6-95b9-381d0e6b06df'::uuid, '01a02180-f638-7042-89f1-d4db9b3f9dce'::uuid, 'koucink-radim-1315', 'Koučink – Radim Roček', '2026-09-18T13:15:00+02:00'::timestamptz, '2026-09-18T13:45:00+02:00'::timestamptz, 2080, 'Pátek!G12:I12#radim'),
				('01a02180-5975-7898-9697-712e3bc8d22e'::uuid, '01a02180-f638-71b9-be6a-ba19d2cf35fe'::uuid, 'koucink-stana-1315', 'Koučink – Stanislava Maunová', '2026-09-18T13:15:00+02:00'::timestamptz, '2026-09-18T13:45:00+02:00'::timestamptz, 2081, 'Pátek!G12:I12#stana'),
				('01a02180-5975-7458-a9a4-c8cd1a539af1'::uuid, '01a02180-f638-7b29-818a-833dfb46cf18'::uuid, 'koucink-radim-1345', 'Koučink – Radim Roček', '2026-09-18T13:45:00+02:00'::timestamptz, '2026-09-18T14:15:00+02:00'::timestamptz, 2090, 'Pátek!G13:I13#radim'),
				('01a02180-5975-76ee-8f1d-c403802b0e29'::uuid, '01a02180-f638-76ff-9eec-203a63b7c381'::uuid, 'koucink-stana-1345', 'Koučink – Stanislava Maunová', '2026-09-18T13:45:00+02:00'::timestamptz, '2026-09-18T14:15:00+02:00'::timestamptz, 2091, 'Pátek!G13:I13#stana'),
				('01a02180-5976-7f60-8b9b-e973a6149639'::uuid, '01a02180-f638-7af5-9a49-b882285d6cca'::uuid, 'koucink-radim-1415', 'Koučink – Radim Roček', '2026-09-18T14:15:00+02:00'::timestamptz, '2026-09-18T14:45:00+02:00'::timestamptz, 2100, 'Pátek!G14:I14#radim'),
				('01a02180-5976-7bb9-9f45-cddb049acbc1'::uuid, '01a02180-f638-7f3d-a24c-70b56ea8e4a1'::uuid, 'koucink-stana-1415', 'Koučink – Stanislava Maunová', '2026-09-18T14:15:00+02:00'::timestamptz, '2026-09-18T14:45:00+02:00'::timestamptz, 2101, 'Pátek!G14:I14#stana'),
				('01a02180-5976-79af-bdfa-e2b7a27f906a'::uuid, '01a02180-f638-772e-b540-b71746aae679'::uuid, 'koucink-radim-1445', 'Koučink – Radim Roček', '2026-09-18T14:45:00+02:00'::timestamptz, '2026-09-18T15:15:00+02:00'::timestamptz, 2110, 'Pátek!G15:I15#radim'),
				('01a02180-5976-7b1f-a1ae-91b2078549e0'::uuid, '01a02180-f638-73b9-835d-2687a42e1bdc'::uuid, 'koucink-stana-1445', 'Koučink – Stanislava Maunová', '2026-09-18T14:45:00+02:00'::timestamptz, '2026-09-18T15:15:00+02:00'::timestamptz, 2111, 'Pátek!G15:I15#stana'),
				('01a02180-5976-77c0-bf10-7738346a9dec'::uuid, '01a02180-f638-7af2-b033-dd27cfd7094b'::uuid, 'koucink-radim-1515', 'Koučink – Radim Roček', '2026-09-18T15:15:00+02:00'::timestamptz, '2026-09-18T15:45:00+02:00'::timestamptz, 2120, 'Pátek!G16:I16#radim'),
				('01a02180-5976-79c4-abd8-c75f95060333'::uuid, '01a02180-f638-7666-b514-0d90cfab8ed3'::uuid, 'koucink-stana-1515', 'Koučink – Stanislava Maunová', '2026-09-18T15:15:00+02:00'::timestamptz, '2026-09-18T15:45:00+02:00'::timestamptz, 2121, 'Pátek!G16:I16#stana'),
				('01a02180-5976-7603-8064-91c13d76dc7d'::uuid, '01a02180-f638-7f8c-bd43-c2f951175d35'::uuid, 'koucink-stana-1545', 'Koučink – Stanislava Maunová', '2026-09-18T15:45:00+02:00'::timestamptz, '2026-09-18T16:15:00+02:00'::timestamptz, 2131, 'Pátek!G17:I17#stana'),
				('01a02180-5976-7f0e-9657-383b8744bdcb'::uuid, '01a02180-f638-774b-8c3d-d85cac82d0ed'::uuid, 'koucink-stana-1615', 'Koučink – Stanislava Maunová', '2026-09-18T16:15:00+02:00'::timestamptz, '2026-09-18T16:45:00+02:00'::timestamptz, 2141, 'Pátek!G18:I18#stana')
			) AS "coaching"(
				"session_id",
				"provenance_id",
				"slug",
				"title",
				"starts_at",
				"ends_at",
				"sort_order",
				"source_path"
			)
		LOOP
			SELECT *
			INTO "existing"
			FROM "sessions" AS "session"
			WHERE
				"session"."event_id" = "v_event_id"
				AND "session"."slug" = "candidate"."slug";

			IF FOUND THEN
				IF
					"existing"."day_id" IS DISTINCT FROM "v_day_id"
					OR "existing"."room_id" IS NOT NULL
					OR "existing"."title" IS DISTINCT FROM "candidate"."title"
					OR "existing"."summary" IS DISTINCT FROM 'Koučovací zóna · Individuální 30minutový koučink'
					OR "existing"."type" IS DISTINCT FROM 'coaching'::"session_type"
					OR "existing"."starts_at" IS DISTINCT FROM "candidate"."starts_at"
					OR "existing"."ends_at" IS DISTINCT FROM "candidate"."ends_at"
					OR "existing"."status" IS DISTINCT FROM 'draft'::"session_status"
					OR "existing"."capacity_mode" IS DISTINCT FROM 'reservation'::"capacity_mode"
					OR "existing"."capacity" IS DISTINCT FROM 1
					OR "existing"."reservation_opens_at" IS NOT NULL
					OR "existing"."reservation_closes_at" IS DISTINCT FROM "candidate"."starts_at"
					OR "existing"."waitlist_mode" IS DISTINCT FROM 'disabled'::"waitlist_mode"
					OR "existing"."waitlist_offer_ttl_minutes" IS NOT NULL
					OR "existing"."allow_release_after_deadline" IS DISTINCT FROM false
					OR "existing"."sort_order" IS DISTINCT FROM "candidate"."sort_order"
				THEN
					RAISE EXCEPTION 'Existing coaching session requires source reconciliation: %', "candidate"."slug"
						USING ERRCODE = 'check_violation';
				END IF;
				"v_target_id" := "existing"."id";
			ELSE
				INSERT INTO "sessions" (
					"id", "event_id", "day_id", "room_id", "slug", "title", "summary",
					"type", "starts_at", "ends_at", "status", "capacity_mode", "capacity",
					"reservation_closes_at", "waitlist_mode", "sort_order"
				) VALUES (
					"candidate"."session_id", "v_event_id", "v_day_id", NULL, "candidate"."slug",
					"candidate"."title", 'Koučovací zóna · Individuální 30minutový koučink', 'coaching',
					"candidate"."starts_at", "candidate"."ends_at", 'draft', 'reservation', 1,
					"candidate"."starts_at", 'disabled', "candidate"."sort_order"
				)
				RETURNING "id" INTO "v_target_id";
			END IF;

			INSERT INTO "content_import_provenance" (
				"id", "event_id", "source_name", "source_path", "source_sha256",
				"target_type", "target_id"
			) VALUES (
				"candidate"."provenance_id",
				"v_event_id",
				'https://docs.google.com/spreadsheets/d/1SgNPggOliwIz-TZghhQuxcs1Qv3hqzRNAOWXcAhz0zw/edit#gid=0',
				"candidate"."source_path",
				'b2743415963f645c11815d582f4a800a83094d78bb6c83763f06e56ec3822e48',
				'session',
				"v_target_id"
			)
			ON CONFLICT ("event_id", "source_name", "source_path", "target_type")
			DO UPDATE SET
				"source_sha256" = excluded."source_sha256",
				"target_id" = excluded."target_id",
				"imported_at" = now();
		END LOOP;
	END IF;
END $$;
