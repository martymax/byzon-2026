CREATE TYPE "public"."privacy_request_kind" AS ENUM('data_deletion');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('pending', 'completed', 'rejected');--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "privacy_request_kind" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"support_reference" varchar(64),
	CONSTRAINT "privacy_requests_resolution_check" CHECK (("privacy_requests"."status" = 'pending' AND "privacy_requests"."resolved_at" IS NULL AND "privacy_requests"."support_reference" IS NULL) OR ("privacy_requests"."status" = 'completed' AND "privacy_requests"."resolved_at" IS NOT NULL AND "privacy_requests"."support_reference" IS NULL) OR ("privacy_requests"."status" = 'rejected' AND "privacy_requests"."resolved_at" IS NOT NULL AND "privacy_requests"."support_reference" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_event_user_kind_unique" ON "privacy_requests" USING btree ("event_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "privacy_requests_event_id_idx" ON "privacy_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_user_id_idx" ON "privacy_requests" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_version_check" CHECK ("participant_profiles"."version" >= 1);