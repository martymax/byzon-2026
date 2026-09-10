ALTER TABLE "questions" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "moderation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_merge_same_session_fk" FOREIGN KEY ("event_id","session_id","merged_into_id") REFERENCES "public"."questions"("event_id","session_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_merged_into_idx" ON "questions" USING btree ("merged_into_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_merge_not_self" CHECK ("questions"."merged_into_id" <> "questions"."id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_moderation_version_check" CHECK ("questions"."moderation_version" > 0);