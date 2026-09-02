ALTER TABLE "speaker_profiles" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "speaker_profiles" ADD COLUMN "facebook_url" text;--> statement-breakpoint
UPDATE "speaker_profiles"
SET "instagram_url" = CASE "slug"
  WHEN 'markus-krug' THEN 'https://www.instagram.com/markuskrug/'
  WHEN 'lukas-hejlik' THEN 'https://www.instagram.com/lukashejlik/'
  WHEN 'margareta-krizova' THEN 'https://www.instagram.com/krizovamargee/'
  WHEN 'andrea-bohacikova' THEN 'https://www.instagram.com/andyb_original/'
  WHEN 'vladimir-macoun' THEN 'https://www.instagram.com/vladimiroviny'
  WHEN 'konstancie-zelezna' THEN 'https://www.instagram.com/konstancie_z/'
END
WHERE "event_id" IN (SELECT "id" FROM "events" WHERE "slug" = 'byzon-2026')
  AND "slug" IN (
    'markus-krug',
    'lukas-hejlik',
    'margareta-krizova',
    'andrea-bohacikova',
    'vladimir-macoun',
    'konstancie-zelezna'
  );--> statement-breakpoint
UPDATE "speaker_profiles"
SET "facebook_url" = 'https://www.facebook.com/share/1GykyVK6xN/'
WHERE "event_id" IN (SELECT "id" FROM "events" WHERE "slug" = 'byzon-2026')
  AND "slug" = 'vladimir-macoun';
