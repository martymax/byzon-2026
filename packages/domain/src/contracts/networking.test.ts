import { describe, expect, it } from 'vitest';

import {
  networkingDirectoryProfileSchema,
  networkingSettingsUpdateRequestSchema,
  todayHuntingSchema,
} from './networking.js';

const base = {
  expectedVersion: 1,
  networkingEnabled: true,
  introduction: 'Pomáhám firmám s produktem.',
  company: 'Synthetic s.r.o.',
  jobTitle: 'Product lead',
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
});
