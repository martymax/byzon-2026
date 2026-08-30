CREATE TYPE "public"."rating_target_type" AS ENUM('session', 'event');--> statement-breakpoint
CREATE TYPE "public"."networking_field_visibility" AS ENUM('hidden', 'directory');--> statement-breakpoint
CREATE TYPE "public"."networking_moderation_status" AS ENUM('visible', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."today_hunting_value" AS ENUM('know_how', 'team', 'investors', 'business_partners', 'suppliers', 'clients');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_text_length_check" CHECK (char_length("questions"."text") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" uuid NOT NULL,
	"target_type" "rating_target_type" NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_score_check" CHECK ("ratings"."score" between 1 and 5),
	CONSTRAINT "ratings_target_consistency_check" CHECK (("ratings"."target_type" = 'event' and "ratings"."session_id" is null) or ("ratings"."target_type" = 'session' and "ratings"."session_id" is not null)),
	CONSTRAINT "ratings_comment_length_check" CHECK ("ratings"."comment" is null or char_length("ratings"."comment") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "job_title" varchar(160);--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "linkedin_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "today_hunting" "today_hunting_value"[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "moderation_status" "networking_moderation_status" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "phone_visibility" "networking_field_visibility" DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "email_visibility" "networking_field_visibility" DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "linkedin_visibility" "networking_field_visibility" DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "networking_anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_membership_fk" FOREIGN KEY ("event_id","author_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_membership_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_session_created_idx" ON "questions" USING btree ("event_id","session_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_event_unique" ON "ratings" USING btree ("event_id","user_id","target_type") WHERE "ratings"."target_type" = 'event' and "ratings"."session_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_user_session_unique" ON "ratings" USING btree ("event_id","session_id","user_id","target_type") WHERE "ratings"."target_type" = 'session' and "ratings"."session_id" is not null;--> statement-breakpoint
CREATE INDEX "ratings_event_created_idx" ON "ratings" USING btree ("event_id","created_at");