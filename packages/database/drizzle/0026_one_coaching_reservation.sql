DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "reservations" AS "reservation"
		INNER JOIN "sessions" AS "session"
			ON "session"."event_id" = "reservation"."event_id"
			AND "session"."id" = "reservation"."session_id"
		WHERE
			"reservation"."status" = 'confirmed'
			AND "session"."type" = 'coaching'
			AND "session"."status" NOT IN ('cancelled', 'archived')
		GROUP BY "reservation"."event_id", "reservation"."user_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'A participant already has multiple active coaching reservations'
			USING ERRCODE = 'check_violation';
	END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_single_coaching_reservation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	"target_is_active_coaching" boolean;
BEGIN
	IF NEW."status" <> 'confirmed' THEN
		RETURN NEW;
	END IF;

	SELECT
		"session"."type" = 'coaching'
		AND "session"."status" NOT IN ('cancelled', 'archived')
	INTO "target_is_active_coaching"
	FROM "sessions" AS "session"
	WHERE
		"session"."event_id" = NEW."event_id"
		AND "session"."id" = NEW."session_id";

	IF NOT coalesce("target_is_active_coaching", false) THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(
		hashtextextended(
			'coaching-reservation:' || NEW."event_id"::text || ':' || NEW."user_id"::text,
			0
		)
	);

	IF EXISTS (
		SELECT 1
		FROM "reservations" AS "reservation"
		INNER JOIN "sessions" AS "session"
			ON "session"."event_id" = "reservation"."event_id"
			AND "session"."id" = "reservation"."session_id"
		WHERE
			"reservation"."event_id" = NEW."event_id"
			AND "reservation"."user_id" = NEW."user_id"
			AND "reservation"."status" = 'confirmed'
			AND "reservation"."id" <> NEW."id"
			AND "session"."type" = 'coaching'
			AND "session"."status" NOT IN ('cancelled', 'archived')
	) THEN
		RAISE EXCEPTION 'A participant may reserve only one coaching slot per event'
			USING
				ERRCODE = '23505',
				CONSTRAINT = 'reservations_active_user_coaching_unique';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reservations_single_coaching_trigger"
BEFORE INSERT OR UPDATE OF "event_id", "session_id", "user_id", "status"
ON "reservations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_single_coaching_reservation"();
