import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const EXPECTED_SPREADSHEET_ID = '1SgNPggOliwIz-TZghhQuxcs1Qv3hqzRNAOWXcAhz0zw';
const EXPECTED_SHEET = 'Pátek';
const EXPECTED_RANGE = 'G1:I18';
const EXPECTED_LOCAL_DATE = '2026-09-18';
const EXPECTED_TIMEZONE = 'Europe/Prague';
const EXPECTED_DURATION_MINUTES = 30;
const EXPECTED_CAPACITY = 1;

export const coachingScheduleRelativePath =
  'packages/database/data/coaching-schedule-2026.json';

interface CoachingScheduleCoachSource {
  key: string;
  sourceHeader: string;
  displayName: string;
}

interface CoachingScheduleSlotSource {
  time: string;
  [coachKey: string]: boolean | string;
}

interface CoachingScheduleSource {
  source: {
    spreadsheetId: string;
    sheet: string;
    range: string;
    verifiedAt: string;
  };
  localDate: string;
  timezone: string;
  durationMinutes: number;
  capacity: number;
  coaches: CoachingScheduleCoachSource[];
  slots: CoachingScheduleSlotSource[];
}

export interface CoachingReservationSlot {
  coachKey: 'radim' | 'stana';
  coachName: string;
  sourceHeader: string;
  sourcePath: string;
  time: string;
  slug: string;
  title: string;
  sortOrder: number;
}

export interface CoachingScheduleSnapshot {
  capacity: 1;
  durationMinutes: 30;
  localDate: '2026-09-18';
  sourceName: string;
  sourceSha256: string;
  sourceVerifiedAt: string;
  timezone: 'Europe/Prague';
  slots: CoachingReservationSlot[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const minutesFor = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) {
    return null;
  }
  return hours * 60 + minutes;
};

const requireTimeRange = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new Error('coaching schedule slot time must be a string');
  }
  const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(value);
  const startsAt = match ? minutesFor(match[1]!) : null;
  const endsAt = match ? minutesFor(match[2]!) : null;
  if (
    startsAt === null ||
    endsAt === null ||
    endsAt - startsAt !== EXPECTED_DURATION_MINUTES
  ) {
    throw new Error(`coaching schedule requires 30-minute slots: ${value}`);
  }
  return value;
};

const requireSource = (value: unknown): CoachingScheduleSource => {
  if (
    !isObject(value) ||
    !isObject(value.source) ||
    !Array.isArray(value.coaches) ||
    !Array.isArray(value.slots)
  ) {
    throw new Error('coaching schedule is missing required fields');
  }
  return value as unknown as CoachingScheduleSource;
};

const requireExactSource = (source: CoachingScheduleSource): void => {
  if (
    source.source.spreadsheetId !== EXPECTED_SPREADSHEET_ID ||
    source.source.sheet !== EXPECTED_SHEET ||
    source.source.range !== EXPECTED_RANGE ||
    !/^\d{4}-\d{2}-\d{2}$/.test(source.source.verifiedAt) ||
    source.localDate !== EXPECTED_LOCAL_DATE ||
    source.timezone !== EXPECTED_TIMEZONE ||
    source.durationMinutes !== EXPECTED_DURATION_MINUTES ||
    source.capacity !== EXPECTED_CAPACITY
  ) {
    throw new Error('coaching schedule requires source reconciliation');
  }
  const expectedCoaches = [
    {
      key: 'radim',
      sourceHeader: 'Radim',
      displayName: 'Radim Roček',
    },
    {
      key: 'stana',
      sourceHeader: 'Stáňa',
      displayName: 'Stanislava Maunová',
    },
  ];
  if (JSON.stringify(source.coaches) !== JSON.stringify(expectedCoaches)) {
    throw new Error('coaching schedule coach columns require reconciliation');
  }
};

export const loadCoachingSchedule = async (
  repositoryRoot: string,
): Promise<CoachingScheduleSnapshot> => {
  const path = resolve(repositoryRoot, coachingScheduleRelativePath);
  const bytes = await readFile(path);
  const source = requireSource(JSON.parse(bytes.toString('utf8')));
  requireExactSource(source);
  if (source.slots.length !== 15) {
    throw new Error('coaching schedule row count requires reconciliation');
  }

  const seenTimes = new Set<string>();
  const availableSlots: CoachingReservationSlot[] = [];
  let previousEndsAt = -1;
  for (const [slotIndex, slot] of source.slots.entries()) {
    if (!isObject(slot)) {
      throw new Error('coaching schedule slot must be an object');
    }
    if (
      JSON.stringify(Object.keys(slot).sort()) !==
      JSON.stringify(['radim', 'stana', 'time'])
    ) {
      throw new Error('coaching schedule slot columns require reconciliation');
    }
    const time = requireTimeRange(slot.time);
    if (seenTimes.has(time)) {
      throw new Error(`duplicate coaching schedule time: ${time}`);
    }
    seenTimes.add(time);
    const [startsAtValue, endsAtValue] = time.split(/\s*-\s*/);
    const startsAt = minutesFor(startsAtValue!)!;
    const endsAt = minutesFor(endsAtValue!)!;
    if (startsAt < previousEndsAt) {
      throw new Error('coaching schedule slots must be chronological');
    }
    previousEndsAt = endsAt;
    for (const [coachIndex, coach] of source.coaches.entries()) {
      const available = slot[coach.key];
      if (typeof available !== 'boolean') {
        throw new Error(
          `coaching availability must be boolean: ${time}/${coach.key}`,
        );
      }
      if (!available) continue;
      const timeKey = time.split('-')[0]!.replace(/\D/g, '').padStart(4, '0');
      availableSlots.push({
        coachKey: coach.key as 'radim' | 'stana',
        coachName: coach.displayName,
        sourceHeader: coach.sourceHeader,
        sourcePath: `${source.source.sheet}!G${slotIndex + 4}:I${slotIndex + 4}#${coach.key}`,
        time,
        slug: `koucink-${coach.key}-${timeKey}`,
        title: `Koučink – ${coach.displayName}`,
        sortOrder: 2_000 + slotIndex * 10 + coachIndex,
      });
    }
  }
  const sourceName = `https://docs.google.com/spreadsheets/d/${source.source.spreadsheetId}/edit#gid=0`;
  return {
    capacity: EXPECTED_CAPACITY,
    durationMinutes: EXPECTED_DURATION_MINUTES,
    localDate: EXPECTED_LOCAL_DATE,
    sourceName,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceVerifiedAt: source.source.verifiedAt,
    timezone: EXPECTED_TIMEZONE,
    slots: availableSlots,
  };
};
