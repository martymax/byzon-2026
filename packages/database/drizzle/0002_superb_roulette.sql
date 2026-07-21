CREATE TYPE "public"."asset_status" AS ENUM('uploading', 'quarantined', 'ready', 'rejected', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."capacity_mode" AS ENUM('none', 'reservation', 'registration_estimate');--> statement-breakpoint
CREATE TYPE "public"."content_page_kind" AS ENUM('practical', 'marketing', 'other');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."publication_sync_status" AS ENUM('sync_pending', 'syncing', 'synced', 'sync_failed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('draft', 'published', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('talk', 'panel', 'workshop', 'mastermind', 'coaching', 'networking', 'break', 'meal', 'gala', 'other');--> statement-breakpoint
CREATE TYPE "public"."waitlist_mode" AS ENUM('disabled', 'auto_confirm', 'offer_with_deadline');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"bucket_key" text NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"original_filename" text NOT NULL,
	"declared_mime_type" varchar(255),
	"sniffed_mime_type" varchar(255),
	"size_bytes" integer,
	"checksum_sha256" varchar(64),
	"status" "asset_status" DEFAULT 'uploading' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assets_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "assets_size_bytes_check" CHECK ("assets"."size_bytes" is null or "assets"."size_bytes" > 0),
	CONSTRAINT "assets_checksum_sha256_check" CHECK ("assets"."checksum_sha256" is null or "assets"."checksum_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assets_ready_metadata_check" CHECK ("assets"."status" <> 'ready' or ("assets"."sniffed_mime_type" is not null and "assets"."size_bytes" is not null and "assets"."checksum_sha256" is not null)),
	CONSTRAINT "assets_public_ready_check" CHECK ("assets"."is_public" = false or "assets"."status" = 'ready')
);
--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"kind" "content_page_kind" DEFAULT 'practical' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body_markdown" text NOT NULL,
	"hero_asset_id" uuid,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pages_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "content_pages_sort_order_check" CHECK ("content_pages"."sort_order" >= 0),
	CONSTRAINT "content_pages_version_check" CHECK ("content_pages"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_status" "publication_sync_status" DEFAULT 'sync_pending' NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"last_sync_error" text,
	CONSTRAINT "content_publications_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "content_publications_version_check" CHECK ("content_publications"."version" > 0),
	CONSTRAINT "content_publications_checksum_check" CHECK ("content_publications"."checksum_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "content_publications_snapshot_object_check" CHECK (jsonb_typeof("content_publications"."snapshot") = 'object'),
	CONSTRAINT "content_publications_sync_attempts_check" CHECK ("content_publications"."sync_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_days_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "event_days_sort_order_check" CHECK ("event_days"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "faq_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"category" varchar(128),
	"question" text NOT NULL,
	"answer_markdown" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faq_items_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "faq_items_sort_order_check" CHECK ("faq_items"."sort_order" >= 0),
	CONSTRAINT "faq_items_version_check" CHECK ("faq_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"description_markdown" text,
	"website_url" text,
	"category" varchar(128),
	"tier" varchar(128),
	"logo_asset_id" uuid,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "partners_sort_order_check" CHECK ("partners"."sort_order" >= 0),
	CONSTRAINT "partners_version_check" CHECK ("partners"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"room_id" uuid,
	"slug" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"description" text,
	"type" "session_type" DEFAULT 'other' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"capacity_mode" "capacity_mode" DEFAULT 'none' NOT NULL,
	"capacity" integer,
	"reservation_opens_at" timestamp with time zone,
	"reservation_closes_at" timestamp with time zone,
	"waitlist_mode" "waitlist_mode" DEFAULT 'disabled' NOT NULL,
	"waitlist_offer_ttl_minutes" integer,
	"allow_release_after_deadline" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "sessions_time_range_check" CHECK ("sessions"."ends_at" > "sessions"."starts_at"),
	CONSTRAINT "sessions_sort_order_check" CHECK ("sessions"."sort_order" >= 0),
	CONSTRAINT "sessions_version_check" CHECK ("sessions"."version" > 0),
	CONSTRAINT "sessions_capacity_policy_check" CHECK (("sessions"."capacity_mode" = 'none' and "sessions"."capacity" is null) or ("sessions"."capacity_mode" <> 'none' and "sessions"."capacity" is not null and "sessions"."capacity" > 0)),
	CONSTRAINT "sessions_reservation_window_check" CHECK ("sessions"."reservation_opens_at" is null or "sessions"."reservation_closes_at" is null or "sessions"."reservation_closes_at" > "sessions"."reservation_opens_at"),
	CONSTRAINT "sessions_waitlist_capacity_mode_check" CHECK ("sessions"."waitlist_mode" = 'disabled' or "sessions"."capacity_mode" = 'reservation'),
	CONSTRAINT "sessions_waitlist_ttl_check" CHECK (("sessions"."waitlist_mode" = 'offer_with_deadline' and "sessions"."waitlist_offer_ttl_minutes" is not null and "sessions"."waitlist_offer_ttl_minutes" > 0) or ("sessions"."waitlist_mode" <> 'offer_with_deadline' and "sessions"."waitlist_offer_ttl_minutes" is null))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capacity" integer,
	"is_available" boolean DEFAULT true NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "rooms_capacity_check" CHECK ("rooms"."capacity" is null or "rooms"."capacity" > 0),
	CONSTRAINT "rooms_sort_order_check" CHECK ("rooms"."sort_order" >= 0),
	CONSTRAINT "rooms_version_check" CHECK ("rooms"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "session_speakers" (
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"speaker_profile_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"role" varchar(128),
	CONSTRAINT "session_speakers_pk" PRIMARY KEY("event_id","session_id","speaker_profile_id"),
	CONSTRAINT "session_speakers_sort_order_check" CHECK ("session_speakers"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "speaker_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"slug" varchar(128) NOT NULL,
	"first_name" varchar(128) NOT NULL,
	"last_name" varchar(128) NOT NULL,
	"company" text,
	"job_title" text,
	"bio_markdown" text,
	"linkedin_url" text,
	"website_url" text,
	"photo_asset_id" uuid,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaker_profiles_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "speaker_profiles_sort_order_check" CHECK ("speaker_profiles"."sort_order" >= 0),
	CONSTRAINT "speaker_profiles_version_check" CHECK ("speaker_profiles"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"postal_code" varchar(32),
	"country_code" varchar(2),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"map_query" text,
	"navigation_markdown" text,
	"accessibility_markdown" text,
	"hero_asset_id" uuid,
	"is_available" boolean DEFAULT true NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "venues_sort_order_check" CHECK ("venues"."sort_order" >= 0),
	CONSTRAINT "venues_version_check" CHECK ("venues"."version" > 0),
	CONSTRAINT "venues_latitude_check" CHECK ("venues"."latitude" is null or "venues"."latitude" between -90 and 90),
	CONSTRAINT "venues_longitude_check" CHECK ("venues"."longitude" is null or "venues"."longitude" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_membership_event_fk" FOREIGN KEY ("event_id","owner_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_hero_asset_event_fk" FOREIGN KEY ("event_id","hero_asset_id") REFERENCES "public"."assets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_publisher_membership_event_fk" FOREIGN KEY ("event_id","published_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_asset_event_fk" FOREIGN KEY ("event_id","logo_asset_id") REFERENCES "public"."assets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_day_event_fk" FOREIGN KEY ("event_id","day_id") REFERENCES "public"."event_days"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_event_fk" FOREIGN KEY ("event_id","room_id") REFERENCES "public"."rooms"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_venue_event_fk" FOREIGN KEY ("event_id","venue_id") REFERENCES "public"."venues"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_session_event_fk" FOREIGN KEY ("event_id","session_id") REFERENCES "public"."sessions"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_speaker_event_fk" FOREIGN KEY ("event_id","speaker_profile_id") REFERENCES "public"."speaker_profiles"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD CONSTRAINT "speaker_profiles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD CONSTRAINT "speaker_profiles_photo_asset_event_fk" FOREIGN KEY ("event_id","photo_asset_id") REFERENCES "public"."assets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD CONSTRAINT "speaker_profiles_membership_event_fk" FOREIGN KEY ("event_id","user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_hero_asset_event_fk" FOREIGN KEY ("event_id","hero_asset_id") REFERENCES "public"."assets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_bucket_key_unique" ON "assets" USING btree ("bucket_key");--> statement-breakpoint
CREATE INDEX "assets_event_id_idx" ON "assets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "assets_owner_user_id_idx" ON "assets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "assets_event_status_idx" ON "assets" USING btree ("event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_event_slug_unique" ON "content_pages" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "content_pages_event_id_idx" ON "content_pages" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_publications_event_version_unique" ON "content_publications" USING btree ("event_id","version");--> statement-breakpoint
CREATE INDEX "content_publications_event_id_idx" ON "content_publications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "content_publications_event_published_at_idx" ON "content_publications" USING btree ("event_id","published_at");--> statement-breakpoint
CREATE INDEX "content_publications_sync_status_idx" ON "content_publications" USING btree ("sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "event_days_event_date_unique" ON "event_days" USING btree ("event_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "event_days_event_sort_order_unique" ON "event_days" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE INDEX "event_days_event_id_idx" ON "event_days" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "faq_items_event_id_idx" ON "faq_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "faq_items_event_sort_order_idx" ON "faq_items" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_event_slug_unique" ON "partners" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "partners_event_id_idx" ON "partners" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_event_slug_unique" ON "sessions" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "sessions_event_id_idx" ON "sessions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "sessions_event_day_time_idx" ON "sessions" USING btree ("event_id","day_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_event_room_time_idx" ON "sessions" USING btree ("event_id","room_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_event_slug_unique" ON "rooms" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "rooms_event_id_idx" ON "rooms" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rooms_event_venue_idx" ON "rooms" USING btree ("event_id","venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_speakers_session_order_unique" ON "session_speakers" USING btree ("event_id","session_id","sort_order");--> statement-breakpoint
CREATE INDEX "session_speakers_event_id_idx" ON "session_speakers" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "session_speakers_speaker_idx" ON "session_speakers" USING btree ("event_id","speaker_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_profiles_event_slug_unique" ON "speaker_profiles" USING btree ("event_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_profiles_event_user_unique" ON "speaker_profiles" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "speaker_profiles_event_id_idx" ON "speaker_profiles" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "speaker_profiles_user_id_idx" ON "speaker_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_event_slug_unique" ON "venues" USING btree ("event_id","slug");--> statement-breakpoint
CREATE INDEX "venues_event_id_idx" ON "venues" USING btree ("event_id");--> statement-breakpoint
CREATE FUNCTION "protect_content_publication_immutable_fields"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'content publication snapshots cannot be deleted',
			CONSTRAINT = 'content_publications_immutable';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
		OR NEW."version" IS DISTINCT FROM OLD."version"
		OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
		OR NEW."checksum_sha256" IS DISTINCT FROM OLD."checksum_sha256"
		OR NEW."published_by" IS DISTINCT FROM OLD."published_by"
		OR NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'content publication snapshot fields are immutable',
			CONSTRAINT = 'content_publications_immutable';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_publications_immutable_trigger"
BEFORE UPDATE OR DELETE ON "content_publications"
FOR EACH ROW EXECUTE FUNCTION "protect_content_publication_immutable_fields"();
