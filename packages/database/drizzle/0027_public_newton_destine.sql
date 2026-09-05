ALTER TABLE "participant_profiles" ADD COLUMN "participant_number" varchar(8);--> statement-breakpoint
CREATE UNIQUE INDEX "participant_profiles_event_number_unique" ON "participant_profiles" USING btree ("event_id","participant_number") WHERE "participant_profiles"."participant_number" is not null;--> statement-breakpoint
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_participant_number_check" CHECK ("participant_profiles"."participant_number" is null or "participant_profiles"."participant_number" ~ '^[0-9]{1,8}$');
