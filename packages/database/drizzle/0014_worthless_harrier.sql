CREATE TYPE "public"."operational_export_state" AS ENUM('queued', 'processing', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('open', 'invite_only', 'closed');--> statement-breakpoint
CREATE TABLE "event_admin_versions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"assignments_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_operational_settings" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"registration_mode" "registration_mode" DEFAULT 'invite_only' NOT NULL,
	"reservation_changes_allowed" boolean DEFAULT true NOT NULL,
	"support_message" varchar(240) DEFAULT 'V případě potíží kontaktujte organizační tým BYZON.' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_operational_settings_version_check" CHECK ("event_operational_settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "operational_export_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"report" varchar(64) NOT NULL,
	"format" varchar(8) NOT NULL,
	"range_from" timestamp with time zone,
	"range_to" timestamp with time zone,
	"reason" text NOT NULL,
	"state" "operational_export_state" DEFAULT 'queued' NOT NULL,
	"object_key" text,
	"checksum_sha256" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_export_requests_format_check" CHECK ("operational_export_requests"."format" in ('csv', 'json')),
	CONSTRAINT "operational_export_requests_expiry_check" CHECK ("operational_export_requests"."expires_at" > "operational_export_requests"."created_at"),
	CONSTRAINT "operational_export_requests_range_check" CHECK ("operational_export_requests"."range_from" is null or "operational_export_requests"."range_to" is null or "operational_export_requests"."range_to" >= "operational_export_requests"."range_from")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_admin_versions" ADD CONSTRAINT "event_admin_versions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_operational_settings" ADD CONSTRAINT "event_operational_settings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_operational_settings" ADD CONSTRAINT "event_operational_settings_updater_event_fk" FOREIGN KEY ("event_id","updated_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_export_requests" ADD CONSTRAINT "operational_export_requests_requester_event_fk" FOREIGN KEY ("event_id","requested_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_export_requests_dispatch_idx" ON "operational_export_requests" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "operational_export_requests_event_idx" ON "operational_export_requests" USING btree ("event_id","created_at");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_version_check" CHECK ("tickets"."version" > 0);