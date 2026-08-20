ALTER TABLE "content_publications" ADD COLUMN "reservation_windows" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
LOCK TABLE "sessions" IN SHARE MODE;--> statement-breakpoint
WITH "publication_windows" AS (
	SELECT
		"publication"."id" AS "publication_id",
		coalesce(
			jsonb_object_agg(
				"published_session"->>'id',
				jsonb_build_object(
					'reservationOpensAt', to_jsonb("session"."reservation_opens_at"),
					'reservationClosesAt', to_jsonb("session"."reservation_closes_at")
				)
				ORDER BY "published_session"->>'id'
			) FILTER (WHERE "session"."id" IS NOT NULL),
			'{}'::jsonb
		) AS "reservation_windows"
	FROM "content_publications" AS "publication"
	LEFT JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof("publication"."snapshot" #> '{program,sessions}') = 'array'
				THEN "publication"."snapshot" #> '{program,sessions}'
			ELSE '[]'::jsonb
		END
	) AS "published_session" ON true
	LEFT JOIN "sessions" AS "session"
		ON "session"."event_id" = "publication"."event_id"
		AND "session"."id" = ("published_session"->>'id')::uuid
	GROUP BY "publication"."id"
)
UPDATE "content_publications" AS "publication"
SET "reservation_windows" = "publication_windows"."reservation_windows"
FROM "publication_windows"
WHERE "publication_windows"."publication_id" = "publication"."id";--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_reservation_windows_object_check" CHECK (jsonb_typeof("content_publications"."reservation_windows") = 'object');--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_content_publication_immutable_fields"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'content publication snapshots cannot be deleted',
			CONSTRAINT = 'content_publications_immutable';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
		OR NEW."version" IS DISTINCT FROM OLD."version"
		OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
		OR NEW."reservation_windows" IS DISTINCT FROM OLD."reservation_windows"
		OR NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256"
		OR NEW."published_by" IS DISTINCT FROM OLD."published_by"
		OR NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'content publication snapshot fields are immutable',
			CONSTRAINT = 'content_publications_immutable';
	END IF;

	RETURN NEW;
END;
$$;
