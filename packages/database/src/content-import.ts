import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

import { and, count, eq, inArray, like, or } from 'drizzle-orm';

import {
  acquireTransactionLock,
  type Database,
  type DatabaseTransaction,
  withTransaction,
} from './client.js';
import { loadCoachingSchedule } from './coaching-schedule.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

type FindingCode =
  | 'invalid_time'
  | 'missing_field'
  | 'unmapped_field'
  | 'unmapped_person'
  | 'unknown_type';

export interface ContentImportFinding {
  code: FindingCode;
  path: string;
  detail: string;
  value?: unknown;
}

export interface ContentImportReport {
  eventSlug: string;
  source: string;
  sourceSha256: string;
  dryRun: boolean;
  counts: Record<string, number>;
  findings: ContentImportFinding[];
}

interface SourceSpeaker {
  slug: string;
  name: string;
  photo: string;
  role?: string;
  bio: string[];
  links?: { linkedin?: string; web?: string; instagram?: string };
}

interface SourceEvent {
  time: string;
  title: string;
  type?: string;
  meta?: string;
  span?: string;
  compact?: boolean;
}

interface ContentSource {
  location: {
    title: string;
    name: string;
    text: string;
    image: string;
    map_query: string;
  };
  speakers: { list: SourceSpeaker[] };
  partners: { logos: Array<{ name: string; src: string; on_dark?: boolean }> };
  program: {
    days: Array<{
      date: string;
      stages: Array<{ name: string; events: SourceEvent[] }>;
    }>;
  };
}

interface PreparedAsset {
  sourcePath: string;
  absolutePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

interface PreparedSession {
  sourceName: string;
  sourceSha256: string;
  sourcePath: string;
  dayPath: string;
  slug: string;
  title: string;
  summary: string | null;
  startsAt: Date;
  endsAt: Date;
  type: 'break' | 'coaching' | 'mastermind' | 'meal' | 'other' | 'workshop';
  capacityMode: 'none' | 'reservation';
  capacity: number | null;
  sortOrder: number;
  speakerSlugs: string[];
}

const SOURCE_NAME = 'static-site/data/content.json';
const LEGACY_COACHING_STAGE = 'Koučovací zóna';
const LEGACY_COACHING_TITLE = 'Koučovací sloty';
const EXPECTED_LEGACY_COACHING_SESSIONS = 11;
const PRAGUE_OFFSET = '+02:00';
const knownDates: Record<string, string> = {
  '18. září 2026': '2026-09-18',
  '19. září 2026': '2026-09-19',
};

const confirmedReservationPolicies = new Map<
  string,
  {
    capacity: number;
    time: string;
    title: string;
    type: 'mastermind' | 'workshop';
  }
>([
  [
    'program.days[0].stages[1].events[10]',
    {
      capacity: 12,
      time: '15:15 - 16:45',
      title:
        'Co o svých lidech skutečně víte? Měříte výkon, potenciál nebo jen dojmy?',
      type: 'mastermind',
    },
  ],
  [
    'program.days[1].stages[0].events[2]',
    {
      capacity: 20,
      time: '9:30 - 11:00',
      title: 'Workshop: Leonid Kushnir',
      type: 'workshop',
    },
  ],
  [
    'program.days[1].stages[0].events[4]',
    {
      capacity: 20,
      time: '11:15 - 12:45',
      title: 'Workshop: Blanka Mrázková',
      type: 'workshop',
    },
  ],
]);

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSource(value: unknown): ContentSource {
  if (
    !isObject(value) ||
    !isObject(value.location) ||
    !isObject(value.speakers) ||
    !isObject(value.partners) ||
    !isObject(value.program)
  ) {
    throw new Error('content source is missing required top-level objects');
  }
  if (
    !Array.isArray(value.speakers.list) ||
    !Array.isArray(value.partners.logos) ||
    !Array.isArray(value.program.days)
  ) {
    throw new Error('content source is missing required collections');
  }
  return value as unknown as ContentSource;
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 128);
}

function splitName(name: string): [string, string] | null {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return [parts.slice(0, -1).join(' '), parts.at(-1)!];
}

function parseTimeRange(
  localDate: string,
  value: string,
): { startsAt: Date; endsAt: Date } | null {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, startHourText, startMinuteText, endHourText, endMinuteText] = match;
  const startHour = Number(startHourText);
  const startMinute = Number(startMinuteText);
  const endHour = Number(endHourText);
  const endMinute = Number(endMinuteText);
  if (
    startHour > 24 ||
    endHour > 24 ||
    startMinute > 59 ||
    endMinute > 59 ||
    (startHour === 24 && startMinute !== 0) ||
    (endHour === 24 && endMinute !== 0)
  )
    return null;
  const instant = (hour: number, minute: number) => {
    const date = new Date(`${localDate}T00:00:00${PRAGUE_OFFSET}`);
    date.setUTCMinutes(date.getUTCMinutes() + hour * 60 + minute);
    return date;
  };
  const startsAt = instant(startHour, startMinute);
  const endsAt = instant(endHour, endMinute);
  return endsAt > startsAt ? { startsAt, endsAt } : null;
}

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  const mime = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }[extension];
  if (!mime) throw new Error(`unsupported imported asset type: ${path}`);
  return mime;
}

async function prepareAsset(
  repositoryRoot: string,
  sourcePath: string,
): Promise<PreparedAsset> {
  if (!sourcePath.startsWith('/assets/'))
    throw new Error(`asset path must be local: ${sourcePath}`);
  const staticPublicRoot = resolve(repositoryRoot, 'static-site/public');
  const absolutePath = resolve(staticPublicRoot, sourcePath.slice(1));
  const expectedRoot = resolve(staticPublicRoot, 'assets') + '/';
  if (!absolutePath.startsWith(expectedRoot))
    throw new Error(`asset path escapes assets directory: ${sourcePath}`);
  const [bytes, metadata] = await Promise.all([
    readFile(absolutePath),
    stat(absolutePath),
  ]);
  if (!metadata.isFile() || metadata.size <= 0)
    throw new Error(`asset is not a non-empty file: ${sourcePath}`);
  return {
    sourcePath,
    absolutePath,
    filename: basename(absolutePath),
    mimeType: mimeFor(sourcePath),
    sizeBytes: metadata.size,
    checksumSha256: sha256(bytes),
  };
}

async function upsertProvenance(
  transaction: DatabaseTransaction,
  eventId: string,
  sourcePath: string,
  sourceSha256: string,
  targetType: string,
  targetId: string,
  sourceName = SOURCE_NAME,
) {
  await transaction
    .insert(schema.contentImportProvenance)
    .values({
      id: generateUuidV7(),
      eventId,
      sourceName,
      sourcePath,
      sourceSha256,
      targetType,
      targetId,
    })
    .onConflictDoUpdate({
      target: [
        schema.contentImportProvenance.eventId,
        schema.contentImportProvenance.sourceName,
        schema.contentImportProvenance.sourcePath,
        schema.contentImportProvenance.targetType,
      ],
      set: { sourceSha256, targetType, targetId, importedAt: new Date() },
    });
}

async function upsertAsset(
  transaction: DatabaseTransaction,
  eventId: string,
  asset: PreparedAsset,
  purpose: string,
  sourceSha256: string,
): Promise<string> {
  const bucketKey = `public-static/${eventId}${asset.sourcePath}`;
  const existing = await transaction.query.assets.findFirst({
    where: and(
      eq(schema.assets.eventId, eventId),
      eq(schema.assets.bucketKey, bucketKey),
    ),
  });
  const id = existing?.id ?? generateUuidV7();
  if (existing && !existing.isPublic)
    throw new Error(
      `refusing to overwrite private asset metadata: ${asset.sourcePath}`,
    );
  await transaction
    .insert(schema.assets)
    .values({
      id,
      eventId,
      bucketKey,
      purpose,
      originalFilename: asset.filename,
      declaredMimeType: asset.mimeType,
      sniffedMimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      checksumSha256: asset.checksumSha256,
      status: 'ready',
      isPublic: true,
    })
    .onConflictDoUpdate({
      target: schema.assets.bucketKey,
      set: {
        purpose,
        originalFilename: asset.filename,
        declaredMimeType: asset.mimeType,
        sniffedMimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        checksumSha256: asset.checksumSha256,
        status: 'ready',
        updatedAt: new Date(),
      },
    });
  await upsertProvenance(
    transaction,
    eventId,
    asset.sourcePath,
    sourceSha256,
    'asset',
    id,
  );
  return id;
}

function addFinding(
  findings: ContentImportFinding[],
  code: FindingCode,
  path: string,
  detail: string,
  value?: unknown,
) {
  findings.push({
    code,
    path,
    detail,
    ...(value === undefined ? {} : { value }),
  });
}

async function archiveLegacyCoachingSessions(
  transaction: DatabaseTransaction,
  eventId: string,
  sourcePaths: readonly string[],
): Promise<void> {
  const provenance = await transaction.query.contentImportProvenance.findMany({
    columns: { sourcePath: true, targetId: true },
    where: and(
      eq(schema.contentImportProvenance.eventId, eventId),
      eq(schema.contentImportProvenance.sourceName, SOURCE_NAME),
      eq(schema.contentImportProvenance.targetType, 'session'),
      inArray(schema.contentImportProvenance.sourcePath, sourcePaths),
    ),
  });
  if (provenance.length === 0) {
    const unreconciledLegacySession =
      await transaction.query.programSessions.findFirst({
        columns: { id: true },
        where: and(
          eq(schema.programSessions.eventId, eventId),
          or(
            eq(schema.programSessions.title, LEGACY_COACHING_TITLE),
            like(
              schema.programSessions.slug,
              'koucovaci-zona-koucovaci-sloty-%',
            ),
          ),
        ),
      });
    if (unreconciledLegacySession) {
      throw new Error(
        'legacy coaching source paths require reconciliation before replacement',
      );
    }
    return;
  }
  if (provenance.length !== sourcePaths.length) {
    throw new Error(
      'legacy coaching import is incomplete and requires reconciliation',
    );
  }
  for (const row of provenance) {
    const session = await transaction.query.programSessions.findFirst({
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, row.targetId),
      ),
    });
    if (
      !session ||
      session.title !== LEGACY_COACHING_TITLE ||
      session.type !== 'other' ||
      session.capacityMode !== 'none' ||
      session.capacity !== null ||
      !['draft', 'archived'].includes(session.status)
    ) {
      throw new Error(
        `legacy coaching session requires reconciliation: ${row.sourcePath}`,
      );
    }
    const agendaItem = await transaction.query.agendaItems.findFirst({
      columns: { sessionId: true },
      where: and(
        eq(schema.agendaItems.eventId, eventId),
        eq(schema.agendaItems.sessionId, session.id),
      ),
    });
    const reservation = await transaction.query.reservations.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, session.id),
      ),
    });
    const waitlist = await transaction.query.waitlistEntries.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.waitlistEntries.eventId, eventId),
        eq(schema.waitlistEntries.sessionId, session.id),
      ),
    });
    if (agendaItem || reservation || waitlist) {
      throw new Error(
        `legacy coaching session has participant state: ${row.sourcePath}`,
      );
    }
    if (session.status === 'draft') {
      await transaction
        .update(schema.programSessions)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(
          and(
            eq(schema.programSessions.eventId, eventId),
            eq(schema.programSessions.id, session.id),
            eq(schema.programSessions.status, 'draft'),
          ),
        );
    }
  }
}

export async function importContentJson(options: {
  db: Database;
  eventSlug: string;
  sourceFile: string;
  repositoryRoot: string;
  dryRun?: boolean;
}): Promise<ContentImportReport> {
  const bytes = await readFile(options.sourceFile);
  const sourceSha256 = sha256(bytes);
  const source = requireSource(JSON.parse(bytes.toString('utf8')));
  const coachingSchedule = await loadCoachingSchedule(options.repositoryRoot);
  const findings: ContentImportFinding[] = [];
  const assetsByPath = new Map<string, PreparedAsset>();
  const assetPaths = [
    source.location.image,
    ...source.speakers.list.map((speaker) => speaker.photo),
    ...source.partners.logos.map((partner) => partner.src),
  ];
  for (const path of new Set(assetPaths))
    assetsByPath.set(path, await prepareAsset(options.repositoryRoot, path));

  const preparedSessions: PreparedSession[] = [];
  const replacedCoachingSourcePaths = new Set<string>();
  const matchedReservationPolicies = new Set<string>();
  const speakerSlugByName = new Map(
    source.speakers.list.map((speaker) => [speaker.name, speaker.slug]),
  );
  let skippedSessionCount = 0;
  source.program.days.forEach((day, dayIndex) => {
    const localDate = knownDates[day.date];
    if (!localDate)
      throw new Error(
        `unrecognized event date at program.days[${dayIndex}].date: ${day.date}`,
      );
    day.stages.forEach((stage, stageIndex) => {
      addFinding(
        findings,
        'unmapped_field',
        `program.days[${dayIndex}].stages[${stageIndex}].name`,
        'Program section was preserved in provenance but not guessed to be a physical room.',
        stage.name,
      );
      stage.events.forEach((event, eventIndex) => {
        const path = `program.days[${dayIndex}].stages[${stageIndex}].events[${eventIndex}]`;
        if (
          dayIndex === 0 &&
          stage.name === LEGACY_COACHING_STAGE &&
          event.title === LEGACY_COACHING_TITLE
        ) {
          replacedCoachingSourcePaths.add(path);
          return;
        }
        const range = parseTimeRange(localDate, event.time);
        if (!range) {
          skippedSessionCount += 1;
          addFinding(
            findings,
            'invalid_time',
            `${path}.time`,
            'Session was not imported because its time range is not parseable.',
            event.time,
          );
          return;
        }
        let type: PreparedSession['type'] = 'other';
        if (event.type === 'break' || event.type === 'meal') type = event.type;
        else if (event.type)
          addFinding(
            findings,
            'unknown_type',
            `${path}.type`,
            'Presentation type was not treated as a reservation policy and was imported as other.',
            event.type,
          );
        const reservationPolicy = confirmedReservationPolicies.get(path);
        if (
          reservationPolicy &&
          (event.title !== reservationPolicy.title ||
            event.time !== reservationPolicy.time)
        ) {
          throw new Error(
            `confirmed reservation policy requires source reconciliation: ${path}`,
          );
        }
        if (reservationPolicy) {
          type = reservationPolicy.type;
          matchedReservationPolicies.add(path);
        }
        if (event.span !== undefined)
          addFinding(
            findings,
            'unmapped_field',
            `${path}.span`,
            'Presentation-only span was not imported.',
            event.span,
          );
        if (event.compact !== undefined)
          addFinding(
            findings,
            'unmapped_field',
            `${path}.compact`,
            'Presentation-only compact flag was not imported.',
            event.compact,
          );
        const speakerSlugs = new Set<string>();
        const directSpeaker = speakerSlugByName.get(event.title);
        if (directSpeaker) speakerSlugs.add(directSpeaker);
        for (const name of event.meta
          ?.split(',')
          .map((value) => value.trim()) ?? []) {
          const slug = speakerSlugByName.get(name);
          if (slug) speakerSlugs.add(slug);
        }
        preparedSessions.push({
          sourceName: SOURCE_NAME,
          sourceSha256,
          sourcePath: path,
          dayPath: `program.days[${dayIndex}]`,
          slug: `${slugify(stage.name)}-${slugify(event.title)}-${event.time.replace(/\D/g, '')}`,
          title: event.title,
          summary: event.meta ?? null,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          type,
          capacityMode: reservationPolicy ? 'reservation' : 'none',
          capacity: reservationPolicy?.capacity ?? null,
          sortOrder: stageIndex * 100 + eventIndex,
          speakerSlugs: [...speakerSlugs],
        });
      });
    });
  });
  if (replacedCoachingSourcePaths.size !== EXPECTED_LEGACY_COACHING_SESSIONS) {
    throw new Error(
      'legacy coaching source requires reconciliation before replacement',
    );
  }
  if (matchedReservationPolicies.size !== confirmedReservationPolicies.size) {
    throw new Error(
      'confirmed reservation policies require source reconciliation',
    );
  }

  const coachingDayIndex = source.program.days.findIndex(
    (day) => knownDates[day.date] === coachingSchedule.localDate,
  );
  if (coachingDayIndex < 0) {
    throw new Error('coaching schedule day is missing from the content source');
  }
  for (const slot of coachingSchedule.slots) {
    const range = parseTimeRange(coachingSchedule.localDate, slot.time);
    if (!range) {
      throw new Error(`invalid reconciled coaching slot: ${slot.time}`);
    }
    preparedSessions.push({
      sourceName: coachingSchedule.sourceName,
      sourceSha256: coachingSchedule.sourceSha256,
      sourcePath: slot.sourcePath,
      dayPath: `program.days[${coachingDayIndex}]`,
      slug: slot.slug,
      title: slot.title,
      summary: 'Koučovací zóna · Individuální 30minutový koučink',
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      type: 'coaching',
      capacityMode: 'reservation',
      capacity: coachingSchedule.capacity,
      sortOrder: slot.sortOrder,
      speakerSlugs: [],
    });
  }

  const speakerNames = new Set(
    source.speakers.list.map((speaker) => speaker.name),
  );
  for (const session of preparedSessions) {
    const candidates = [
      session.title,
      ...(session.summary?.split(',').map((value) => value.trim()) ?? []),
    ];
    for (const candidate of candidates) {
      if (
        session.type !== 'coaching' &&
        /^[\p{Lu}][\p{L}-]+\s+[\p{Lu}][\p{L}-]+/u.test(candidate) &&
        !speakerNames.has(candidate) &&
        ![...speakerNames].some((name) => candidate.includes(name))
      )
        addFinding(
          findings,
          'unmapped_person',
          session.sourcePath,
          'Program person has no exact speaker profile match.',
          candidate,
        );
    }
  }
  source.speakers.list.forEach((speaker, index) => {
    if (!speaker.role?.trim())
      addFinding(
        findings,
        'missing_field',
        `speakers.list[${index}].role`,
        'Speaker role is missing and remains null.',
      );
    if (speaker.links?.instagram)
      addFinding(
        findings,
        'unmapped_field',
        `speakers.list[${index}].links.instagram`,
        'Instagram is not represented by the current speaker schema.',
        speaker.links.instagram,
      );
  });
  source.partners.logos.forEach((partner, index) => {
    for (const field of ['description', 'websiteUrl', 'category', 'tier'])
      addFinding(
        findings,
        'missing_field',
        `partners.logos[${index}].${field}`,
        `Partner ${field} is missing and remains null.`,
      );
    if (partner.on_dark !== undefined)
      addFinding(
        findings,
        'unmapped_field',
        `partners.logos[${index}].on_dark`,
        'Presentation-only logo contrast flag was not imported.',
        partner.on_dark,
      );
  });

  const counts: Record<string, number> = {
    assets: assetsByPath.size,
    speakers: source.speakers.list.length,
    partners: source.partners.logos.length,
    venues: 1,
    contentPages: 1,
    eventDays: source.program.days.length,
    sessions: preparedSessions.length,
    coachingSessions: coachingSchedule.slots.length,
    replacedSessions: replacedCoachingSourcePaths.size,
    skippedSessions: skippedSessionCount,
  };
  if (options.dryRun)
    return {
      eventSlug: options.eventSlug,
      source: options.sourceFile,
      sourceSha256,
      dryRun: true,
      counts,
      findings,
    };

  await withTransaction(options.db, async (transaction) => {
    await acquireTransactionLock(
      transaction,
      `content-import:${options.eventSlug}`,
    );
    const event = await transaction.query.events.findFirst({
      where: eq(schema.events.slug, options.eventSlug),
    });
    if (!event) throw new Error(`event not found: ${options.eventSlug}`);
    const eventId = event.id;
    const unchangedImport =
      await transaction.query.contentImportProvenance.findFirst({
        where: and(
          eq(schema.contentImportProvenance.eventId, eventId),
          eq(schema.contentImportProvenance.sourceName, SOURCE_NAME),
          eq(schema.contentImportProvenance.sourceSha256, sourceSha256),
        ),
      });
    const unchangedCoachingImport =
      await transaction.query.contentImportProvenance.findFirst({
        where: and(
          eq(schema.contentImportProvenance.eventId, eventId),
          eq(
            schema.contentImportProvenance.sourceName,
            coachingSchedule.sourceName,
          ),
          eq(
            schema.contentImportProvenance.sourceSha256,
            coachingSchedule.sourceSha256,
          ),
        ),
      });
    if (unchangedImport && unchangedCoachingImport) return;
    await acquireTransactionLock(transaction, `content-publish:${eventId}`);

    await archiveLegacyCoachingSessions(
      transaction,
      eventId,
      [...replacedCoachingSourcePaths].sort(),
    );
    const assetIds = new Map<string, string>();
    const speakerIds = new Map<string, string>();
    for (const asset of assetsByPath.values())
      assetIds.set(
        asset.sourcePath,
        await upsertAsset(
          transaction,
          eventId,
          asset,
          asset.sourcePath === source.location.image
            ? 'venue_image'
            : 'public_content',
          sourceSha256,
        ),
      );

    for (const [index, speaker] of source.speakers.list.entries()) {
      const names = splitName(speaker.name);
      if (!names)
        throw new Error(`speaker name cannot be split: ${speaker.name}`);
      const existing = await transaction.query.speakerProfiles.findFirst({
        where: and(
          eq(schema.speakerProfiles.eventId, eventId),
          eq(schema.speakerProfiles.slug, speaker.slug),
        ),
      });
      if (existing && existing.status !== 'draft')
        throw new Error(
          `refusing to overwrite non-draft speaker: ${speaker.slug}`,
        );
      const id = existing?.id ?? generateUuidV7();
      await transaction
        .insert(schema.speakerProfiles)
        .values({
          id,
          eventId,
          slug: speaker.slug,
          firstName: names[0],
          lastName: names[1],
          jobTitle: speaker.role?.trim() || null,
          bioMarkdown: speaker.bio.join('\n\n'),
          linkedinUrl: speaker.links?.linkedin ?? null,
          websiteUrl: speaker.links?.web ?? null,
          photoAssetId: assetIds.get(speaker.photo),
          status: 'draft',
          sortOrder: index,
        })
        .onConflictDoUpdate({
          target: [schema.speakerProfiles.eventId, schema.speakerProfiles.slug],
          set: {
            firstName: names[0],
            lastName: names[1],
            jobTitle: speaker.role?.trim() || null,
            bioMarkdown: speaker.bio.join('\n\n'),
            linkedinUrl: speaker.links?.linkedin ?? null,
            websiteUrl: speaker.links?.web ?? null,
            photoAssetId: assetIds.get(speaker.photo),
            sortOrder: index,
            updatedAt: new Date(),
          },
        });
      await upsertProvenance(
        transaction,
        eventId,
        `speakers.list[${index}]`,
        sourceSha256,
        'speaker_profile',
        id,
      );
      speakerIds.set(speaker.slug, id);
    }

    for (const [index, partner] of source.partners.logos.entries()) {
      const slug = slugify(partner.name);
      const existing = await transaction.query.partners.findFirst({
        where: and(
          eq(schema.partners.eventId, eventId),
          eq(schema.partners.slug, slug),
        ),
      });
      if (existing && existing.status !== 'draft')
        throw new Error(`refusing to overwrite non-draft partner: ${slug}`);
      const id = existing?.id ?? generateUuidV7();
      await transaction
        .insert(schema.partners)
        .values({
          id,
          eventId,
          slug,
          name: partner.name,
          logoAssetId: assetIds.get(partner.src),
          status: 'draft',
          sortOrder: index,
        })
        .onConflictDoUpdate({
          target: [schema.partners.eventId, schema.partners.slug],
          set: {
            name: partner.name,
            logoAssetId: assetIds.get(partner.src),
            sortOrder: index,
            updatedAt: new Date(),
          },
        });
      await upsertProvenance(
        transaction,
        eventId,
        `partners.logos[${index}]`,
        sourceSha256,
        'partner',
        id,
      );
    }

    const venueSlug = 'clarion-congress-hotel-ceske-budejovice';
    const existingVenue = await transaction.query.venues.findFirst({
      where: and(
        eq(schema.venues.eventId, eventId),
        eq(schema.venues.slug, venueSlug),
      ),
    });
    if (existingVenue && existingVenue.status !== 'draft')
      throw new Error(`refusing to overwrite non-draft venue: ${venueSlug}`);
    const venueId = existingVenue?.id ?? generateUuidV7();
    await transaction
      .insert(schema.venues)
      .values({
        id: venueId,
        eventId,
        slug: venueSlug,
        name: source.location.name,
        mapQuery: source.location.map_query,
        navigationMarkdown: source.location.text,
        heroAssetId: assetIds.get(source.location.image),
        status: 'draft',
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: [schema.venues.eventId, schema.venues.slug],
        set: {
          name: source.location.name,
          mapQuery: source.location.map_query,
          navigationMarkdown: source.location.text,
          heroAssetId: assetIds.get(source.location.image),
          updatedAt: new Date(),
        },
      });
    await upsertProvenance(
      transaction,
      eventId,
      'location',
      sourceSha256,
      'venue',
      venueId,
    );

    const pageSlug = 'misto-a-doprava';
    const existingPage = await transaction.query.contentPages.findFirst({
      where: and(
        eq(schema.contentPages.eventId, eventId),
        eq(schema.contentPages.slug, pageSlug),
      ),
    });
    if (existingPage && existingPage.status !== 'draft')
      throw new Error(
        `refusing to overwrite non-draft content page: ${pageSlug}`,
      );
    const pageId = existingPage?.id ?? generateUuidV7();
    await transaction
      .insert(schema.contentPages)
      .values({
        id: pageId,
        eventId,
        slug: pageSlug,
        kind: 'practical',
        title: source.location.title,
        bodyMarkdown: source.location.text,
        heroAssetId: assetIds.get(source.location.image),
        status: 'draft',
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: [schema.contentPages.eventId, schema.contentPages.slug],
        set: {
          title: source.location.title,
          bodyMarkdown: source.location.text,
          heroAssetId: assetIds.get(source.location.image),
          updatedAt: new Date(),
        },
      });
    await upsertProvenance(
      transaction,
      eventId,
      'location',
      sourceSha256,
      'content_page',
      pageId,
    );

    const dayIds = new Map<string, string>();
    for (const [index, day] of source.program.days.entries()) {
      const localDate = knownDates[day.date]!;
      const existing = await transaction.query.eventDays.findFirst({
        where: and(
          eq(schema.eventDays.eventId, eventId),
          eq(schema.eventDays.localDate, localDate),
        ),
      });
      const id = existing?.id ?? generateUuidV7();
      await transaction
        .insert(schema.eventDays)
        .values({ id, eventId, localDate, title: day.date, sortOrder: index })
        .onConflictDoUpdate({
          target: [schema.eventDays.eventId, schema.eventDays.localDate],
          set: { title: day.date, sortOrder: index, updatedAt: new Date() },
        });
      dayIds.set(`program.days[${index}]`, id);
      await upsertProvenance(
        transaction,
        eventId,
        `program.days[${index}]`,
        sourceSha256,
        'event_day',
        id,
      );
    }

    for (const session of preparedSessions) {
      const existing = await transaction.query.programSessions.findFirst({
        where: and(
          eq(schema.programSessions.eventId, eventId),
          eq(schema.programSessions.slug, session.slug),
        ),
      });
      if (existing && existing.status !== 'draft')
        throw new Error(
          `refusing to overwrite non-draft session: ${session.slug}`,
        );
      const id = existing?.id ?? generateUuidV7();
      let importedCapacity = session.capacity;
      if (session.capacityMode === 'reservation') {
        if (session.capacity === null) {
          throw new Error(
            `reservable session is missing capacity: ${session.slug}`,
          );
        }
        if (existing?.capacityMode === 'reservation') {
          importedCapacity = existing.capacity ?? session.capacity;
        } else if (existing) {
          // Restoring a source policy must not undercut reservations retained
          // while the session was temporarily non-reservable.
          const [confirmed] = await transaction
            .select({ value: count() })
            .from(schema.reservations)
            .where(
              and(
                eq(schema.reservations.eventId, eventId),
                eq(schema.reservations.sessionId, existing.id),
                eq(schema.reservations.status, 'confirmed'),
              ),
            );
          importedCapacity = Math.max(session.capacity, confirmed?.value ?? 0);
        }
      }
      await transaction
        .insert(schema.programSessions)
        .values({
          id,
          eventId,
          dayId: dayIds.get(session.dayPath)!,
          roomId: null,
          slug: session.slug,
          title: session.title,
          summary: session.summary,
          type: session.type,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          status: 'draft',
          capacityMode: session.capacityMode,
          capacity: importedCapacity,
          reservationClosesAt:
            session.capacityMode === 'reservation' ? session.startsAt : null,
          waitlistMode: 'disabled',
          sortOrder: session.sortOrder,
        })
        .onConflictDoUpdate({
          target: [schema.programSessions.eventId, schema.programSessions.slug],
          // Keep an audited numeric capacity while the source continues to
          // classify the session as reservable. The remaining reservation
          // policy stays source-managed so a newly confirmed/removed policy
          // and a moved session cutoff are synchronized by repeat imports.
          set: {
            dayId: dayIds.get(session.dayPath)!,
            roomId: null,
            title: session.title,
            summary: session.summary,
            type: session.type,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            capacityMode: session.capacityMode,
            capacity: importedCapacity,
            reservationClosesAt:
              session.capacityMode === 'reservation' ? session.startsAt : null,
            waitlistMode: 'disabled',
            waitlistOfferTtlMinutes: null,
            sortOrder: session.sortOrder,
            updatedAt: new Date(),
          },
        });
      await upsertProvenance(
        transaction,
        eventId,
        session.sourcePath,
        session.sourceSha256,
        'session',
        id,
        session.sourceName,
      );
      await transaction
        .delete(schema.sessionSpeakers)
        .where(
          and(
            eq(schema.sessionSpeakers.eventId, eventId),
            eq(schema.sessionSpeakers.sessionId, id),
          ),
        );
      if (session.speakerSlugs.length > 0) {
        await transaction.insert(schema.sessionSpeakers).values(
          session.speakerSlugs.map((speakerSlug, sortOrder) => ({
            eventId,
            sessionId: id,
            speakerProfileId: speakerIds.get(speakerSlug)!,
            sortOrder,
          })),
        );
      }
    }
  });
  return {
    eventSlug: options.eventSlug,
    source: options.sourceFile,
    sourceSha256,
    dryRun: false,
    counts,
    findings,
  };
}
