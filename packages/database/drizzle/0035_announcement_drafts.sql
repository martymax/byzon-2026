CREATE TABLE "announcement_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"draft_json" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"sent_announcement_id" uuid,
	CONSTRAINT "announcement_drafts_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "announcement_drafts_version_check" CHECK ("announcement_drafts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD COLUMN "source_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD COLUMN "source_draft_version" integer;--> statement-breakpoint
ALTER TABLE "announcement_drafts" ADD CONSTRAINT "announcement_drafts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_drafts" ADD CONSTRAINT "announcement_drafts_creator_event_fk" FOREIGN KEY ("event_id","created_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_drafts" ADD CONSTRAINT "announcement_drafts_editor_event_fk" FOREIGN KEY ("event_id","updated_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_drafts_event_id_idx" ON "announcement_drafts" USING btree ("event_id","id");--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD CONSTRAINT "announcement_previews_draft_event_fk" FOREIGN KEY ("event_id","source_draft_id") REFERENCES "public"."announcement_drafts"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_previews" ADD CONSTRAINT "announcement_previews_source_draft_check" CHECK (("announcement_previews"."source_draft_id" is null and "announcement_previews"."source_draft_version" is null) or ("announcement_previews"."source_draft_id" is not null and "announcement_previews"."source_draft_version" is not null and "announcement_previews"."source_draft_version" > 0));