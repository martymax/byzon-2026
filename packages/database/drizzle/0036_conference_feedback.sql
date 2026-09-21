CREATE TABLE "conference_feedback_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step" varchar(32) DEFAULT 'intro' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conference_feedback_token_hash_check" CHECK ("conference_feedback_responses"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "conference_feedback_answers_object_check" CHECK (jsonb_typeof("conference_feedback_responses"."answers") = 'object')
);
--> statement-breakpoint
ALTER TABLE "conference_feedback_responses" ADD CONSTRAINT "conference_feedback_profile_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."participant_profiles"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conference_feedback_event_user_unique" ON "conference_feedback_responses" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conference_feedback_token_hash_unique" ON "conference_feedback_responses" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "conference_feedback_event_updated_idx" ON "conference_feedback_responses" USING btree ("event_id","updated_at");