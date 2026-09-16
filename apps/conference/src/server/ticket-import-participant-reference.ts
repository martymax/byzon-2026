import { createHash } from 'node:crypto';

export interface ImportedParticipantReference {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly version: number;
  readonly orderExternalId: string;
  readonly membershipStatus: string;
}

export const identityRepairMappingKey = (externalId: string): string =>
  `identity_repair:${externalId}`;

// Bind a repair preview to the original assignment, including account email
// changes that do not increment the source-reference version.
export const participantReferenceDigest = (
  reference: ImportedParticipantReference,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        reference.id,
        reference.userId,
        reference.email,
        reference.version,
        reference.orderExternalId,
        reference.membershipStatus,
      ]),
    )
    .digest('hex');
