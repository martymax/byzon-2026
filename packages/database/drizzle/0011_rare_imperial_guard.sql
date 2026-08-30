CREATE TYPE "public"."checkin_device_state" AS ENUM('trusted', 'revoked');--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"holder_user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"checked_in_by" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undo_reason" text,
	CONSTRAINT "check_ins_event_id_id_unique" UNIQUE("event_id","id"),
	CONSTRAINT "check_ins_undo_consistency_check" CHECK (("check_ins"."undone_at" is null and "check_ins"."undone_by" is null and "check_ins"."undo_reason" is null) or ("check_ins"."undone_at" is not null and "check_ins"."undone_by" is not null and char_length("check_ins"."undo_reason") between 8 and 240))
);
--> statement-breakpoint
CREATE TABLE "checkin_lookups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_lookups_expiry_check" CHECK ("checkin_lookups"."expires_at" > "checkin_lookups"."created_at")
);
--> statement-breakpoint
CREATE TABLE "checkin_stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_stations_event_id_id_unique" UNIQUE("event_id","id")
);
--> statement-breakpoint
CREATE TABLE "operator_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"state" "checkin_device_state" DEFAULT 'trusted' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_devices_event_id_id_unique" UNIQUE("event_id","id")
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_ticket_event_fk" FOREIGN KEY ("event_id","ticket_id") REFERENCES "public"."tickets"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_holder_event_fk" FOREIGN KEY ("event_id","holder_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_station_event_fk" FOREIGN KEY ("event_id","station_id") REFERENCES "public"."checkin_stations"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_device_event_fk" FOREIGN KEY ("event_id","device_id") REFERENCES "public"."operator_devices"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_operator_event_fk" FOREIGN KEY ("event_id","checked_in_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_undo_operator_event_fk" FOREIGN KEY ("event_id","undone_by") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_lookups" ADD CONSTRAINT "checkin_lookups_ticket_event_fk" FOREIGN KEY ("event_id","ticket_id") REFERENCES "public"."tickets"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_lookups" ADD CONSTRAINT "checkin_lookups_operator_event_fk" FOREIGN KEY ("event_id","operator_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_lookups" ADD CONSTRAINT "checkin_lookups_device_event_fk" FOREIGN KEY ("event_id","device_id") REFERENCES "public"."operator_devices"("event_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_stations" ADD CONSTRAINT "checkin_stations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_devices" ADD CONSTRAINT "operator_devices_station_event_fk" FOREIGN KEY ("event_id","station_id") REFERENCES "public"."checkin_stations"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_active_ticket_unique" ON "check_ins" USING btree ("event_id","ticket_id") WHERE "check_ins"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "check_ins_event_occurred_idx" ON "check_ins" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "check_ins_holder_idx" ON "check_ins" USING btree ("event_id","holder_user_id");--> statement-breakpoint
CREATE INDEX "checkin_lookups_event_id_idx" ON "checkin_lookups" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "checkin_lookups_expiry_idx" ON "checkin_lookups" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_stations_event_name_unique" ON "checkin_stations" USING btree ("event_id","name");--> statement-breakpoint
CREATE INDEX "checkin_stations_event_id_idx" ON "checkin_stations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "operator_devices_event_id_idx" ON "operator_devices" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "operator_devices_station_id_idx" ON "operator_devices" USING btree ("station_id");