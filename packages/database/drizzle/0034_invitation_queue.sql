CREATE TABLE "invitation_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"delivery" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"prepared_at" timestamp with time zone,
	"recipient_hash" varchar(64),
	"token_hash" varchar(64),
	"finished_at" timestamp with time zone,
	"last_error" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_deliveries_status_check" CHECK ("invitation_deliveries"."status" in ('pending', 'processing', 'delivered', 'failed', 'skipped')),
	CONSTRAINT "invitation_deliveries_delivery_check" CHECK ("invitation_deliveries"."delivery" in ('participant', 'team')),
	CONSTRAINT "invitation_deliveries_attempts_check" CHECK ("invitation_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invitation_batches" ADD CONSTRAINT "invitation_batches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_batches" ADD CONSTRAINT "invitation_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_deliveries" ADD CONSTRAINT "invitation_deliveries_batch_id_invitation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."invitation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_deliveries" ADD CONSTRAINT "invitation_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_deliveries" ADD CONSTRAINT "invitation_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_batches_event_idx" ON "invitation_batches" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_deliveries_dispatch_idx" ON "invitation_deliveries" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "invitation_deliveries_batch_idx" ON "invitation_deliveries" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_deliveries_active_user_unique" ON "invitation_deliveries" USING btree ("event_id","user_id") WHERE "invitation_deliveries"."status" in ('pending', 'processing');