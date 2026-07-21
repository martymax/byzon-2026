import { and, desc, eq } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  deriveOnboardingState,
  normalizeOnboardingProfile,
  type OnboardingConsentDecision,
  type OnboardingLegalDocumentType,
  type OnboardingState,
} from '@byzon/domain';

export type OnboardingErrorCode =
  | 'EVENT_ACCESS_DENIED'
  | 'LEGAL_CONFIGURATION_MISSING'
  | 'STALE_LEGAL_DOCUMENT'
  | 'NETWORKING_DISABLED'
  | 'REQUEST_ID_REUSED';

export class OnboardingError extends Error {
  constructor(readonly code: OnboardingErrorCode) {
    super('Onboarding could not be completed');
    this.name = 'OnboardingError';
  }
}

export interface CompleteOnboardingInput {
  eventId: string;
  userId: string;
  requestId: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
  termsDocumentId: string;
  privacyNoticeDocumentId: string;
  networking: {
    enabled: boolean;
    consentDocumentId?: string;
  };
}

interface CurrentLegalDocuments {
  terms: string | null;
  privacyNotice: string | null;
  networkingConsent: string | null;
}

interface ExpectedDecision {
  legalDocumentId: string;
  decision: OnboardingConsentDecision;
}

type OnboardingDatabase = Pick<DatabaseTransaction, 'query' | 'select'>;

const loadCurrentLegalDocuments = async (
  db: OnboardingDatabase,
  eventId: string,
): Promise<CurrentLegalDocuments> => {
  const documents = await db.query.legalDocuments.findMany({
    columns: { id: true, type: true },
    where: and(
      eq(schema.legalDocuments.eventId, eventId),
      eq(schema.legalDocuments.isCurrent, true),
    ),
  });
  const byType = new Map(
    documents.map((document) => [document.type, document.id]),
  );
  return {
    terms: byType.get('terms') ?? null,
    privacyNotice: byType.get('privacy_notice') ?? null,
    networkingConsent: byType.get('networking_consent') ?? null,
  };
};

const loadEffectiveDecisions = async (
  db: OnboardingDatabase,
  eventId: string,
  userId: string,
): Promise<ExpectedDecision[]> => {
  const records = await db.query.consentRecords.findMany({
    columns: { legalDocumentId: true, decision: true },
    where: and(
      eq(schema.consentRecords.eventId, eventId),
      eq(schema.consentRecords.userId, userId),
    ),
    orderBy: [
      desc(schema.consentRecords.recordedAt),
      desc(schema.consentRecords.id),
    ],
  });
  const effective = new Map<string, OnboardingConsentDecision>();
  for (const record of records) {
    if (!effective.has(record.legalDocumentId)) {
      effective.set(record.legalDocumentId, record.decision);
    }
  }
  return [...effective].map(([legalDocumentId, decision]) => ({
    legalDocumentId,
    decision,
  }));
};

const hasActiveMembership = async (
  db: OnboardingDatabase,
  eventId: string,
  userId: string,
): Promise<boolean> => {
  const membership = await db.query.eventMemberships.findFirst({
    columns: { userId: true },
    where: and(
      eq(schema.eventMemberships.eventId, eventId),
      eq(schema.eventMemberships.userId, userId),
      eq(schema.eventMemberships.status, 'active'),
    ),
  });
  return Boolean(membership);
};

export const loadOnboardingState = async (
  db: Database,
  eventId: string,
  userId: string,
): Promise<OnboardingState | null> => {
  if (!(await hasActiveMembership(db, eventId, userId))) return null;
  const [profile, currentDocuments, decisions] = await Promise.all([
    db.query.participantProfiles.findFirst({
      columns: {
        firstName: true,
        lastName: true,
        contactEmail: true,
        networkingEnabled: true,
      },
      where: and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, userId),
      ),
    }),
    loadCurrentLegalDocuments(db, eventId),
    loadEffectiveDecisions(db, eventId, userId),
  ]);
  return deriveOnboardingState({
    profile: profile ?? null,
    currentDocuments,
    decisions,
  });
};

const requireDocument = (
  documents: CurrentLegalDocuments,
  type: OnboardingLegalDocumentType,
): string => {
  const documentId =
    type === 'privacy_notice'
      ? documents.privacyNotice
      : type === 'networking_consent'
        ? documents.networkingConsent
        : documents.terms;
  if (!documentId) throw new OnboardingError('LEGAL_CONFIGURATION_MISSING');
  return documentId;
};

const expectedDecisions = (
  input: CompleteOnboardingInput,
  documents: CurrentLegalDocuments,
): ExpectedDecision[] => {
  const terms = requireDocument(documents, 'terms');
  const privacyNotice = requireDocument(documents, 'privacy_notice');
  if (
    input.termsDocumentId !== terms ||
    input.privacyNoticeDocumentId !== privacyNotice
  ) {
    throw new OnboardingError('STALE_LEGAL_DOCUMENT');
  }
  const decisions: ExpectedDecision[] = [
    { legalDocumentId: terms, decision: 'accepted' },
    { legalDocumentId: privacyNotice, decision: 'acknowledged' },
  ];
  if (input.networking.enabled) {
    const networkingConsent = requireDocument(documents, 'networking_consent');
    if (input.networking.consentDocumentId !== networkingConsent) {
      throw new OnboardingError('STALE_LEGAL_DOCUMENT');
    }
    decisions.push({
      legalDocumentId: networkingConsent,
      decision: 'accepted',
    });
  }
  return decisions;
};

const sameDecisions = (
  actual: readonly ExpectedDecision[],
  expected: readonly ExpectedDecision[],
): boolean =>
  actual.length === expected.length &&
  expected.every((candidate) =>
    actual.some(
      (record) =>
        record.legalDocumentId === candidate.legalDocumentId &&
        record.decision === candidate.decision,
    ),
  );

export interface CompleteOnboardingOptions {
  now?: () => Date;
  generateId?: () => string;
}

export const completeOnboarding = async (
  db: Database,
  input: CompleteOnboardingInput,
  options: CompleteOnboardingOptions = {},
): Promise<{ status: 'complete' }> => {
  const profile = normalizeOnboardingProfile(input);
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? generateUuidV7;

  return withTransaction(db, async (transaction) => {
    await acquireTransactionLock(
      transaction,
      `onboarding:${input.eventId}:${input.userId}`,
    );
    if (
      !(await hasActiveMembership(transaction, input.eventId, input.userId))
    ) {
      throw new OnboardingError('EVENT_ACCESS_DENIED');
    }

    if (input.networking.enabled) {
      const features = await transaction.query.eventFeatures.findFirst({
        columns: { networkingEnabled: true },
        where: eq(schema.eventFeatures.eventId, input.eventId),
      });
      if (features?.networkingEnabled !== true) {
        throw new OnboardingError('NETWORKING_DISABLED');
      }
    }

    const documents = await loadCurrentLegalDocuments(
      transaction,
      input.eventId,
    );
    const decisions = expectedDecisions(input, documents);
    const retriedRecords = await transaction.query.consentRecords.findMany({
      columns: { legalDocumentId: true, decision: true },
      where: and(
        eq(schema.consentRecords.eventId, input.eventId),
        eq(schema.consentRecords.userId, input.userId),
        eq(schema.consentRecords.requestId, input.requestId),
      ),
    });
    if (retriedRecords.length > 0) {
      const storedProfile =
        await transaction.query.participantProfiles.findFirst({
          columns: {
            firstName: true,
            lastName: true,
            contactEmail: true,
            networkingEnabled: true,
          },
          where: and(
            eq(schema.participantProfiles.eventId, input.eventId),
            eq(schema.participantProfiles.userId, input.userId),
          ),
        });
      if (
        !sameDecisions(retriedRecords, decisions) ||
        storedProfile?.firstName !== profile.firstName ||
        storedProfile.lastName !== profile.lastName ||
        storedProfile.contactEmail !== profile.contactEmail ||
        storedProfile.networkingEnabled !== input.networking.enabled
      ) {
        throw new OnboardingError('REQUEST_ID_REUSED');
      }
      return { status: 'complete' };
    }

    const completedAt = now();
    await transaction
      .insert(schema.participantProfiles)
      .values({
        eventId: input.eventId,
        userId: input.userId,
        ...profile,
        networkingEnabled: input.networking.enabled,
        onboardingCompletedAt: completedAt,
        updatedAt: completedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.participantProfiles.eventId,
          schema.participantProfiles.userId,
        ],
        set: {
          ...profile,
          networkingEnabled: input.networking.enabled,
          onboardingCompletedAt: completedAt,
          updatedAt: completedAt,
        },
      });
    await transaction.insert(schema.consentRecords).values(
      decisions.map((decision) => ({
        id: generateId(),
        eventId: input.eventId,
        userId: input.userId,
        requestId: input.requestId,
        source: 'onboarding',
        ...decision,
      })),
    );
    await writeAuditLog(
      transaction,
      {
        eventId: input.eventId,
        actorId: input.userId,
        actorType: 'user',
        action: 'onboarding.completed',
        targetType: 'event_membership',
        targetId: input.userId,
        requestId: input.requestId,
        after: {
          state: 'complete',
          legalDocumentIds: decisions.map(
            ({ legalDocumentId }) => legalDocumentId,
          ),
          networkingEnabled: input.networking.enabled,
        },
      },
      { generateId },
    );

    return { status: 'complete' };
  });
};
