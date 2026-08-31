import { describe, expect, it } from 'vitest';

import {
  networkingVisibilityForOptIn,
  projectNetworkingContacts,
} from './networking';

describe('networking public-profile visibility', () => {
  it('derives one visibility from the explicit participant opt-in', () => {
    expect(networkingVisibilityForOptIn(false)).toBe('hidden');
    expect(networkingVisibilityForOptIn(true)).toBe('directory');
  });

  it('publishes every completed public contact field after directory filtering', () => {
    expect(
      projectNetworkingContacts({
        contactEmail: 'participant@example.test',
        phone: '+420777123456',
        linkedinUrl: 'https://www.linkedin.com/in/synthetic',
      }),
    ).toEqual({
      email: 'participant@example.test',
      phone: '+420777123456',
      linkedinUrl: 'https://www.linkedin.com/in/synthetic',
    });
  });
});
