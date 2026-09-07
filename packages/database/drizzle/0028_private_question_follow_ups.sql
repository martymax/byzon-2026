CREATE TYPE "public"."question_mode" AS ENUM('disabled', 'moderated_follow_up');--> statement-breakpoint
CREATE TABLE "question_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"speaker_profile_id" uuid NOT NULL,
	"answered_by_user_id" uuid NOT NULL,
	"speaker_name" text NOT NULL,
	"text" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "question_answers_text_length_check" CHECK (char_length("question_answers"."text") between 1 and 4000),
	CONSTRAINT "question_answers_speaker_name_check" CHECK (char_length("question_answers"."speaker_name") between 1 and 257),
	CONSTRAINT "question_answers_version_check" CHECK ("question_answers"."version" > 0),
	CONSTRAINT "question_answers_time_check" CHECK ("question_answers"."updated_at" >= "question_answers"."published_at")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "question_mode" "question_mode" DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_features" ADD COLUMN "question_followups_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "questions_event_session_id_unique" ON "questions" USING btree ("event_id","session_id","id");--> statement-breakpoint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_question_event_session_fk" FOREIGN KEY ("event_id","session_id","question_id") REFERENCES "public"."questions"("event_id","session_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_speaker_event_fk" FOREIGN KEY ("event_id","speaker_profile_id") REFERENCES "public"."speaker_profiles"("event_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_membership_fk" FOREIGN KEY ("event_id","answered_by_user_id") REFERENCES "public"."event_memberships"("event_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_answers_question_unique" ON "question_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_answers_session_idx" ON "question_answers" USING btree ("event_id","session_id");--> statement-breakpoint
CREATE INDEX "questions_author_created_idx" ON "questions" USING btree ("event_id","author_user_id","created_at","id");
--> statement-breakpoint
-- AQ-00 reviewed allowlist. Provenance preserves identity when an earlier import used a different slug.
WITH approved(slug, source_path, room_slug, starts_at, ends_at) AS (VALUES
    ('byzon-stage-lidskost-jako-konkurencni-vyhoda-9151000', 'program.days[0].stages[0].events[2]', 'byzon-stage', '2026-09-18T07:15:00Z'::timestamptz, '2026-09-18T08:00:00Z'::timestamptz),
    ('byzon-stage-proc-vam-lide-veri-i-kdyz-jim-nic-neprodavate-10451115', 'program.days[0].stages[0].events[5]', 'byzon-stage', '2026-09-18T08:45:00Z'::timestamptz, '2026-09-18T09:15:00Z'::timestamptz),
    ('byzon-stage-lide-duveruji-lidem-konkurencni-vyhoda-kterou-nejde-koupit-reklamou-11151145', 'program.days[0].stages[0].events[6]', 'byzon-stage', '2026-09-18T09:15:00Z'::timestamptz, '2026-09-18T09:45:00Z'::timestamptz),
    ('byzon-stage-host-to-pozna-lidskost-jako-nejdulezitejsi-ingredience-gastro-byznysu-11451215', 'program.days[0].stages[0].events[7]', 'byzon-stage', '2026-09-18T09:45:00Z'::timestamptz, '2026-09-18T10:15:00Z'::timestamptz),
    ('byzon-stage-co-vas-dostalo-sem-vas-dal-nedostane-13151345', 'program.days[0].stages[0].events[9]', 'byzon-stage', '2026-09-18T11:15:00Z'::timestamptz, '2026-09-18T11:45:00Z'::timestamptz),
    ('byzon-stage-co-mi-nikdo-nerekl-o-tom-byt-ceo-13451415', 'program.days[0].stages[0].events[10]', 'byzon-stage', '2026-09-18T11:45:00Z'::timestamptz, '2026-09-18T12:15:00Z'::timestamptz),
    ('byzon-stage-simon-srp-14151445', 'program.days[0].stages[0].events[11]', 'byzon-stage', '2026-09-18T12:15:00Z'::timestamptz, '2026-09-18T12:45:00Z'::timestamptz),
    ('byzon-stage-lidskost-pod-tlakem-kolik-lidskosti-si-muze-firma-dovolit-15151545', 'program.days[0].stages[0].events[13]', 'byzon-stage', '2026-09-18T13:15:00Z'::timestamptz, '2026-09-18T13:45:00Z'::timestamptz),
    ('byzon-stage-jak-vyjednavat-lidsky-a-ziskavat-zakazniky-jinak-nez-slevami-15451615', 'program.days[0].stages[0].events[14]', 'byzon-stage', '2026-09-18T13:45:00Z'::timestamptz, '2026-09-18T14:15:00Z'::timestamptz),
    ('byzon-stage-nejdrazsi-konkurencni-vyhoda-lidskost-16151645', 'program.days[0].stages[0].events[15]', 'byzon-stage', '2026-09-18T14:15:00Z'::timestamptz, '2026-09-18T14:45:00Z'::timestamptz),
    ('byzon-stage-zradci-lidskosti-moderovana-diskuze-17001745', 'program.days[0].stages[0].events[17]', 'byzon-stage', '2026-09-18T15:00:00Z'::timestamptz, '2026-09-18T15:45:00Z'::timestamptz),
    ('leadership-stage-human-magic-a-co-ta-lidskost-vlastne-je-10451115', 'program.days[0].stages[1].events[2]', 'leadership-stage', '2026-09-18T08:45:00Z'::timestamptz, '2026-09-18T09:15:00Z'::timestamptz),
    ('leadership-stage-kdyz-lidskost-nekonci-u-bran-fabriky-jak-stavet-byznys-komunitu-a-lepsi-spolecnost-11151145', 'program.days[0].stages[1].events[3]', 'leadership-stage', '2026-09-18T09:15:00Z'::timestamptz, '2026-09-18T09:45:00Z'::timestamptz),
    ('leadership-stage-prestante-lidi-motivovat-11451215', 'program.days[0].stages[1].events[4]', 'leadership-stage', '2026-09-18T09:45:00Z'::timestamptz, '2026-09-18T10:15:00Z'::timestamptz),
    ('leadership-stage-tyrkysova-firma-co-se-stane-kdyz-svemu-tymu-opravdu-verite-13151345', 'program.days[0].stages[1].events[6]', 'leadership-stage', '2026-09-18T11:15:00Z'::timestamptz, '2026-09-18T11:45:00Z'::timestamptz),
    ('leadership-stage-jak-lidsky-ziskat-genz-a-vest-s-energii-13451415', 'program.days[0].stages[1].events[7]', 'leadership-stage', '2026-09-18T11:45:00Z'::timestamptz, '2026-09-18T12:15:00Z'::timestamptz),
    ('leadership-stage-jakub-zikmund-14151445', 'program.days[0].stages[1].events[8]', 'leadership-stage', '2026-09-18T12:15:00Z'::timestamptz, '2026-09-18T12:45:00Z'::timestamptz)
)
UPDATE sessions AS s SET question_mode = 'moderated_follow_up', questions_enabled = false
FROM events e
WHERE e.id = s.event_id AND e.slug = 'byzon-2026'
AND EXISTS (
  SELECT 1 FROM approved a
  WHERE s.starts_at = a.starts_at AND s.ends_at = a.ends_at
    AND EXISTS (SELECT 1 FROM rooms r WHERE r.id = s.room_id AND r.event_id = s.event_id AND r.slug = a.room_slug)
    AND (s.slug = a.slug OR EXISTS (
      SELECT 1 FROM content_import_provenance p
      WHERE p.event_id = s.event_id AND p.target_id = s.id
        AND p.source_name = 'static-site/data/content.json'
        AND p.source_path = a.source_path AND p.target_type = 'session'
    ))
);
--> statement-breakpoint
-- Collection must be explicitly enabled after readiness checks on the new runtime.
UPDATE event_features SET questions_enabled = false WHERE event_id IN (SELECT id FROM events WHERE slug = 'byzon-2026');
