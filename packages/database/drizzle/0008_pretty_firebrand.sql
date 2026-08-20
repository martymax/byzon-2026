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
	AND "session"."status" = 'draft';
