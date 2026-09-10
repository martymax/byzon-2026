CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"deduplication_key" varchar(256) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"rendered" jsonb,
	"delivered_at" timestamp with time zone,
	"last_error" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_attempts_check" CHECK ("email_deliveries"."attempts" >= 0),
	CONSTRAINT "email_deliveries_expiry_check" CHECK ("email_deliveries"."expires_at" > "email_deliveries"."created_at")
);
--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "email_salutation" varchar(128);--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD COLUMN "rating_emails_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_profile_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."participant_profiles"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_dedup_unique" ON "email_deliveries" USING btree ("event_id","user_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "email_deliveries_dispatch_idx" ON "email_deliveries" USING btree ("status","available_at");