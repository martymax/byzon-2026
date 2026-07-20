CREATE TABLE "participant_profiles" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" varchar(128) NOT NULL,
	"last_name" varchar(128) NOT NULL,
	"contact_email" varchar(320) NOT NULL,
	"networking_enabled" boolean,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_profiles_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_profiles_event_id_idx" ON "participant_profiles" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "participant_profiles_user_id_idx" ON "participant_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_request_document_unique" ON "consent_records" USING btree ("event_id","user_id","request_id","legal_document_id");