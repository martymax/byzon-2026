CREATE TABLE "ticket_source_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"order_external_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"source_status" text NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_source_participants_status_check" CHECK ("ticket_source_participants"."source_status" = 'paid'),
	CONSTRAINT "ticket_source_participants_version_check" CHECK ("ticket_source_participants"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "ticket_import_rows" ADD COLUMN "preview_status" varchar(32);--> statement-breakpoint
ALTER TABLE "ticket_source_participants" ADD CONSTRAINT "ticket_source_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_source_participants" ADD CONSTRAINT "ticket_source_participants_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_source_participants" ADD CONSTRAINT "ticket_source_participants_batch_event_fk" FOREIGN KEY ("event_id","import_batch_id") REFERENCES "public"."ticket_import_batches"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_source_participants_event_external_unique" ON "ticket_source_participants" USING btree ("event_id","external_id");--> statement-breakpoint
CREATE INDEX "ticket_source_participants_event_user_idx" ON "ticket_source_participants" USING btree ("event_id","user_id");--> statement-breakpoint
ALTER TABLE "ticket_import_rows" ADD CONSTRAINT "ticket_import_rows_preview_status_check" CHECK ("ticket_import_rows"."preview_status" is null or "ticket_import_rows"."preview_status" in ('new', 'unchanged', 'status_changed', 'excluded', 'conflict', 'unknown'));