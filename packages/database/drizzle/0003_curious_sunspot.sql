CREATE TABLE "content_import_provenance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"source_name" varchar(255) NOT NULL,
	"source_path" text NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_import_provenance_source_sha256_check" CHECK ("content_import_provenance"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "content_import_provenance_target_type_check" CHECK ("content_import_provenance"."target_type" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "content_import_provenance" ADD CONSTRAINT "content_import_provenance_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_import_provenance_event_source_unique" ON "content_import_provenance" USING btree ("event_id","source_name","source_path","target_type");--> statement-breakpoint
CREATE INDEX "content_import_provenance_event_target_idx" ON "content_import_provenance" USING btree ("event_id","target_type","target_id");
