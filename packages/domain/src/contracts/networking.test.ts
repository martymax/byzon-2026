import { describe, expect, it } from 'vitest';

import {
  networkingDirectoryProfileSchema,
  networkingDirectoryQuerySchema,
  networkingSettingsUpdateRequestSchema,
  todayHuntingSchema,
} from './networking.js';

const base = {
  expectedVersion: 1,
  networkingEnabled: true,
  introduction: 'Pomáhám firmám s produktem.',
  company: 'Synthetic s.r.o.',
  jobTitle: 'Product lead',
  participantNumber: '042',
  todayHunting: ['know_how', 'clients'] as const,
  contactEmail: 'participant@example.test',
  phone: '+420777123456',
  linkedinUrl: 'https://www.linkedin.com/in/synthetic',
  emailVisibility: 'directory' as const,
  phoneVisibility: 'directory' as const,
  linkedinVisibility: 'directory' as const,
};

describe('networking contracts', () => {
  it('accepts only the six fixed today_hunting values and unique selections', () => {
    expect(todayHuntingSchema.safeParse('custom').success).toBe(false);
    expect(
      networkingSettingsUpdateRequestSchema.safeParse({
        ...base,
        todayHunting: ['know_how', 'know_how'],
      }).success,
    ).toBe(false);
    expect(
      networkingSettingsUpdateRequestSchema.parse(base).todayHunting,
    ).toEqual(['know_how', 'clients']);
  });

  it('makes every completed public-profile field follow the explicit opt-in', () => {
    expect(
      networkingSettingsUpdateRequestSchema.safeParse({
        ...base,
        phoneVisibility: 'hidden',
      }).success,
    ).toBe(false);
    expect(
      networkingSettingsUpdateRequestSchema.safeParse({
        ...base,
        networkingEnabled: false,
        emailVisibility: 'hidden',
        phoneVisibility: 'hidden',
        linkedinVisibility: 'hidden',
      }).success,
    ).toBe(true);
  });

  it('projects hidden contacts as null and rejects extra internal fields', () => {
    const profile = {
      profileId: '019fa200-0000-7000-8000-000000000001',
      displayName: 'Ada Synthetic',
      company: 'Synthetic s.r.o.',
      jobTitle: 'Product lead',
      introduction: '',
      participantNumber: '042',
      todayHunting: ['team'],
      contacts: { email: null, phone: null, linkedinUrl: null },
    };
    expect(networkingDirectoryProfileSchema.parse(profile).contacts).toEqual({
      email: null,
      phone: null,
      linkedinUrl: null,
    });
    expect(
      networkingDirectoryProfileSchema.safeParse({
        ...profile,
        userId: profile.profileId,
      }).success,
    ).toBe(false);
  });

  it('accepts a canonical participant number and preserves leading zeroes', () => {
    expect(
      networkingSettingsUpdateRequestSchema.parse(base).participantNumber,
    ).toBe('042');
    for (const participantNumber of ['', '12a', '123456789']) {
      expect(
        networkingSettingsUpdateRequestSchema.safeParse({
          ...base,
          participantNumber,
        }).success,
      ).toBe(false);
    }
    expect(
      networkingSettingsUpdateRequestSchema.safeParse({
        ...base,
        participantNumber: null,
      }).success,
    ).toBe(true);
  });

  it('validates exact participant-number directory filters', () => {
    expect(
      networkingDirectoryQuerySchema.parse({ participantNumber: '042' }),
    ).toEqual({ participantNumber: '042' });
    expect(
      networkingDirectoryQuerySchema.safeParse({ participantNumber: '42a' })
        .success,
    ).toBe(false);
  });
});
