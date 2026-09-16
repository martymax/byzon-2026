CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"deduplication_key" text NOT NULL,
	"kind" varchar(64) NOT NULL,
	"recipient" text,
	"sender" text,
	"subject" text,
	"html" text,
	"text" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_dedup_unique" ON "email_messages" USING btree ("event_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "email_messages_event_sent_idx" ON "email_messages" USING btree ("event_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "email_messages_user_idx" ON "email_messages" USING btree ("user_id");
--> statement-breakpoint
-- Only actually sent notifications: skipped messages also have status=delivered.
INSERT INTO "email_messages" (id, event_id, user_id, deduplication_key, kind, recipient, subject, html, text, sent_at, created_at)
SELECT id, event_id, user_id, 'notification:' || id::text, payload->>'kind',
  rendered->>'to', rendered->>'subject', rendered->>'html', rendered->>'text', date_trunc('milliseconds', delivered_at), created_at
FROM email_deliveries
WHERE status = 'delivered' AND last_error IS NULL AND delivered_at IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Earlier invitations have delivery evidence but no saved address or body.
-- Do not reconstruct their content using today's templates or recipient profile.
INSERT INTO "email_messages" (id, event_id, user_id, deduplication_key, kind, sent_at, created_at)
SELECT a.id, a.event_id, u.id, 'audit:' || a.id::text,
  CASE a.action WHEN 'team.invitation_sent' THEN 'team-invitation' ELSE 'participant-invitation' END,
  date_trunc('milliseconds', a.created_at), a.created_at
FROM audit_logs a
INNER JOIN "user" u ON u.id::text = a.target_id
WHERE a.action IN ('team.invitation_sent', 'participant.invitation_sent')
ON CONFLICT DO NOTHING;
