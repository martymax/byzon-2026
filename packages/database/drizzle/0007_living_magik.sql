CREATE TYPE "public"."reservation_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_entry_status" AS ENUM('waiting', 'promoted', 'cancelled');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'confirmed' NOT NULL,
	"source" varchar(32) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reservations_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "reservations_version_check" CHECK ("reservations"."version" >= 1),
	CONSTRAINT "reservations_source_check" CHECK ("reservations"."source" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "reservations_cancelled_state_check" CHECK (("reservations"."status" = 'confirmed' and "reservations"."cancelled_at" is null) or ("reservations"."status" = 'cancelled' and "reservations"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "waitlist_entry_status" DEFAULT 'waiting' NOT NULL,
	"position_sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "waitlist_entries_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "waitlist_entries_position_sequence_check" CHECK ("waitlist_entries"."position_sequence" > 0),
	CONSTRAINT "waitlist_entries_state_check" CHECK (("waitlist_entries"."status" = 'waiting' and "waitlist_entries"."promoted_at" is null and "waitlist_entries"."cancelled_at" is null) or ("waitlist_entries"."status" = 'promoted' and "waitlist_entries"."promoted_at" is not null and "waitlist_entries"."cancelled_at" is null) or ("waitlist_entries"."status" = 'cancelled' and "waitlist_entries"."promoted_at" is null and "waitlist_entries"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "company" varchar(160);--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_active_user_session_unique" ON "reservations" USING btree ("event_id","session_id","user_id") WHERE "reservations"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "reservations_event_session_status_idx" ON "reservations" USING btree ("event_id","session_id","status");--> statement-breakpoint
CREATE INDEX "reservations_event_user_status_idx" ON "reservations" USING btree ("event_id","user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_session_position_unique" ON "waitlist_entries" USING btree ("event_id","session_id","position_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_waiting_user_session_unique" ON "waitlist_entries" USING btree ("event_id","session_id","user_id") WHERE "waitlist_entries"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "waitlist_entries_event_session_status_position_idx" ON "waitlist_entries" USING btree ("event_id","session_id","status","position_sequence");--> statement-breakpoint
CREATE INDEX "waitlist_entries_event_user_status_idx" ON "waitlist_entries" USING btree ("event_id","user_id","status");