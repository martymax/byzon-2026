CREATE TYPE "public"."announcement_audience_kind" AS ENUM('event', 'session');--> statement-breakpoint
CREATE TABLE "announcement_previews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"draft_json" jsonb NOT NULL,
	"recipient_user_ids_json" jsonb NOT NULL,
	"recipient_count" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_announcement_id" uuid,
	CONSTRAINT "announcement_previews_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "announcement_previews_version_check" CHECK ("announcement_previews"."version" > 0),
	CONSTRAINT "announcement_previews_count_check" CHECK ("announcement_previews"."recipient_count" >= 0),
	CONSTRAINT "announcement_previews_expiry_check" CHECK ("announcement_previews"."expires_at" > "announcement_previews"."created_at"),
	CONSTRAINT "announcement_previews_recipients_array_check" CHECK (jsonb_typeof("announcement_previews"."recipient_user_ids_json") = 'array')
);
--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"event_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_recipients_pk" PRIMARY KEY("event_id","announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"summary" varchar(512) NOT NULL,
	"body_text" text NOT NULL,
	"severity" varchar(16) DEFAULT 'critical' NOT NULL,
	"audience_kind" "announcement_audience_kind" NOT NULL,
	"session_id" uuid,
	"session_title" varchar(512),
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "announcements_severity_check" CHECK ("announcements"."severity" = 'critical'),
	CONSTRAINT "announcements_audience_session_check" CHECK (("announcements"."audience_kind" = 'event' and "announcements"."session_id" is null and "announcements"."session_title" is null) or ("announcements"."audience_kind" = 'session' and "announcements"."session_id" is not null and "announcements"."session_title" is not null))
);
--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD CONSTRAINT "announcement_previews_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD CONSTRAINT "announcement_previews_creator_event_fk" FOREIGN KEY ("event_id","created_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_event_fk" FOREIGN KEY ("event_id","announcement_id") REFERENCES "public"."announcements"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_preview_event_fk" FOREIGN KEY ("event_id","preview_id") REFERENCES "public"."announcement_previews"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_creator_event_fk" FOREIGN KEY ("event_id","created_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_previews_event_created_idx" ON "announcement_previews" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "announcement_recipients_user_unread_idx" ON "announcement_recipients" USING btree ("event_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_event_preview_unique" ON "announcements" USING btree ("event_id","preview_id");--> statement-breakpoint
CREATE INDEX "announcements_event_published_idx" ON "announcements" USING btree ("event_id","published_at");