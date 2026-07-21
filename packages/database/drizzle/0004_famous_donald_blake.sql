CREATE TYPE "public"."ticket_import_batch_status" AS ENUM('uploaded', 'validated', 'awaiting_confirmation', 'applying', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('valid', 'activated', 'cancelled', 'refunded', 'transferred', 'blocked');--> statement-breakpoint
CREATE TABLE "ticket_claim_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"code_bucket_hmac" varchar(64) NOT NULL,
	"code_suffix" varchar(16),
	"result" varchar(32) NOT NULL,
	"actor_hash" varchar(64),
	"ip_hash" varchar(64) NOT NULL,
	"user_agent_hash" varchar(64) NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ticket_claim_attempts_hashes_check" CHECK ("ticket_claim_attempts"."code_bucket_hmac" ~ '^[0-9a-f]{64}$' and ("ticket_claim_attempts"."actor_hash" is null or "ticket_claim_attempts"."actor_hash" ~ '^[0-9a-f]{64}$') and "ticket_claim_attempts"."ip_hash" ~ '^[0-9a-f]{64}$' and "ticket_claim_attempts"."user_agent_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ticket_claim_attempts_expiry_check" CHECK ("ticket_claim_attempts"."expires_at" > "ticket_claim_attempts"."attempted_at")
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"actor_type" varchar(32) NOT NULL,
	"actor_id" uuid,
	"from_status" "ticket_status",
	"to_status" "ticket_status" NOT NULL,
	"reason" text,
	"request_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"source" varchar(64) NOT NULL,
	"source_filename" text NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"status" "ticket_import_batch_status" DEFAULT 'uploaded' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"validated_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_import_batches_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "ticket_import_batches_sha256_check" CHECK ("ticket_import_batches"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ticket_import_batches_row_count_check" CHECK ("ticket_import_batches"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ticket_import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"external_id" text,
	"order_external_id" text,
	"code_hmac" varchar(64),
	"code_suffix" varchar(16),
	"source_status" text,
	"mapped_status" "ticket_status",
	"validation_errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_import_rows_row_number_check" CHECK ("ticket_import_rows"."row_number" > 0),
	CONSTRAINT "ticket_import_rows_code_hmac_check" CHECK ("ticket_import_rows"."code_hmac" is null or "ticket_import_rows"."code_hmac" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"external_id" text,
	"order_external_id" text,
	"code_hmac" varchar(64) NOT NULL,
	"code_suffix" varchar(16) NOT NULL,
	"status" "ticket_status" DEFAULT 'valid' NOT NULL,
	"holder_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"transferred_from_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "tickets_code_hmac_check" CHECK ("tickets"."code_hmac" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tickets_claim_state_check" CHECK (("tickets"."status" = 'activated' and "tickets"."holder_user_id" is not null and "tickets"."claimed_at" is not null) or "tickets"."status" <> 'activated')
);
--> statement-breakpoint
ALTER TABLE "ticket_claim_attempts" ADD CONSTRAINT "ticket_claim_attempts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_event_fk" FOREIGN KEY ("event_id","ticket_id") REFERENCES "public"."tickets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_import_batch_event_fk" FOREIGN KEY ("event_id","import_batch_id") REFERENCES "public"."ticket_import_batches"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_membership_event_fk" FOREIGN KEY ("event_id","actor_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_import_batches" ADD CONSTRAINT "ticket_import_batches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_import_batches" ADD CONSTRAINT "ticket_import_batches_creator_membership_event_fk" FOREIGN KEY ("event_id","created_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_import_rows" ADD CONSTRAINT "ticket_import_rows_batch_event_fk" FOREIGN KEY ("event_id","batch_id") REFERENCES "public"."ticket_import_batches"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_holder_user_id_user_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_holder_membership_event_fk" FOREIGN KEY ("event_id","holder_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_transfer_source_event_fk" FOREIGN KEY ("event_id","transferred_from_ticket_id") REFERENCES "public"."tickets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_claim_attempts_event_id_idx" ON "ticket_claim_attempts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ticket_claim_attempts_expiry_idx" ON "ticket_claim_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ticket_claim_attempts_event_bucket_idx" ON "ticket_claim_attempts" USING btree ("event_id","code_bucket_hmac","attempted_at");--> statement-breakpoint
CREATE INDEX "ticket_events_event_id_idx" ON "ticket_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_occurred_idx" ON "ticket_events" USING btree ("ticket_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_import_batches_event_file_unique" ON "ticket_import_batches" USING btree ("event_id","file_sha256");--> statement-breakpoint
CREATE INDEX "ticket_import_batches_event_id_idx" ON "ticket_import_batches" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_import_rows_batch_row_unique" ON "ticket_import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "ticket_import_rows_event_id_idx" ON "ticket_import_rows" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ticket_import_rows_batch_id_idx" ON "ticket_import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_event_code_hmac_unique" ON "tickets" USING btree ("event_id","code_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_event_external_id_unique" ON "tickets" USING btree ("event_id","external_id") WHERE "tickets"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_event_id_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_event_status_idx" ON "tickets" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "tickets_event_holder_idx" ON "tickets" USING btree ("event_id","holder_user_id");--> statement-breakpoint
CREATE INDEX "tickets_event_order_idx" ON "tickets" USING btree ("event_id","order_external_id");