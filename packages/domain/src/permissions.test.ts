import { describe, expect, it } from 'vitest';

import {
  eventPermissions,
  eventRoles,
  hasEventPermission,
  type EventPermission,
  type EventRole,
} from './permissions.js';

const allowed = (role: EventRole, permission: EventPermission): boolean =>
  hasEventPermission([role], permission, {
    ownsResource: true,
    networkingOptedIn: true,
    acceptedConnection: true,
    announcementRecipient: true,
    assignedSession: true,
    assignedRoom: true,
    moderatorCanAnnounce: true,
    auditedException: true,
  });

describe('event permission matrix', () => {
  it('keeps the full role and permission matrix explicit', () => {
    expect(eventRoles).toHaveLength(7);
    expect(eventPermissions).toHaveLength(28);
    expect(eventRoles).not.toContain('support_operator');
  });

  it.each([
    ['participant', 'agenda:own:write', true],
    ['participant', 'announcement:own:read', true],
    ['speaker', 'announcement:own:read', false],
    ['speaker', 'agenda:own:write', false],
    ['speaker', 'program:own-materials:write', true],
    ['checkin_operator', 'checkin:perform', true],
    ['checkin_operator', 'reservation:assigned:read', false],
    ['moderator', 'session:assigned:moderate', true],
    ['room_operator', 'reservation:assigned:read', true],
    ['room_operator', 'checkin:perform', false],
    ['organizer_admin', 'program:manage', true],
    ['organizer_admin', 'ticket:any:manage', true],
    ['organizer_admin', 'participant:operational:read', true],
    ['organizer_admin', 'role:manage', true],
    ['organizer_admin', 'operations:read', true],
    ['organizer_admin', 'audit:read', true],
    ['organizer_admin', 'event:settings:manage', true],
    ['organizer_admin', 'attendance:assigned:write', true],
    ['room_operator', 'attendance:assigned:write', true],
    ['room_operator', 'ticket:any:manage', false],
    ['checkin_operator', 'participant:operational:read', false],
    ['moderator', 'role:manage', false],
    ['organizer_admin', 'networking:directory:read', false],
    ['system_worker', 'program:published:read', false],
  ] satisfies [EventRole, EventPermission, boolean][])(
    '%s / %s is %s',
    (role, permission, expected) => {
      expect(allowed(role, permission)).toBe(expected);
    },
  );

  it('combines roles without implying participant rights for a speaker', () => {
    expect(
      hasEventPermission(['speaker'], 'agenda:own:write', {
        ownsResource: true,
      }),
    ).toBe(false);
    expect(
      hasEventPermission(['speaker', 'participant'], 'agenda:own:write', {
        ownsResource: true,
      }),
    ).toBe(true);
    expect(
      hasEventPermission(['speaker'], 'networking:directory:read', {
        networkingOptedIn: true,
      }),
    ).toBe(false);
    expect(
      hasEventPermission(
        ['speaker', 'participant'],
        'networking:directory:read',
        { networkingOptedIn: true },
      ),
    ).toBe(true);
  });

  it('fails closed when conditional policy context is absent', () => {
    expect(hasEventPermission(['participant'], 'agenda:own:write')).toBe(false);
    expect(hasEventPermission(['participant'], 'announcement:own:read')).toBe(
      false,
    );
    expect(
      hasEventPermission(['participant'], 'networking:directory:read'),
    ).toBe(false);
    expect(hasEventPermission(['moderator'], 'session:assigned:moderate')).toBe(
      false,
    );
    expect(
      hasEventPermission(['room_operator'], 'reservation:assigned:read'),
    ).toBe(false);
    expect(
      hasEventPermission(['room_operator'], 'attendance:assigned:write'),
    ).toBe(false);
  });

  it('keeps F4 admin permissions explicit and attendance assignment-scoped', () => {
    for (const permission of [
      'ticket:any:manage',
      'participant:operational:read',
      'role:manage',
      'operations:read',
      'audit:read',
      'event:settings:manage',
    ] as const) {
      expect(hasEventPermission(['organizer_admin'], permission)).toBe(true);
      expect(hasEventPermission(['room_operator'], permission)).toBe(false);
      expect(hasEventPermission(['participant'], permission)).toBe(false);
    }

    expect(
      hasEventPermission(['room_operator'], 'attendance:assigned:write', {
        assignedSession: true,
      }),
    ).toBe(true);
    expect(
      hasEventPermission(['room_operator'], 'attendance:assigned:write', {
        assignedRoom: true,
      }),
    ).toBe(false);
    expect(
      hasEventPermission(['organizer_admin'], 'attendance:assigned:write'),
    ).toBe(true);
  });

  it('requires recipient membership for participant announcement reads', () => {
    expect(
      hasEventPermission(['participant'], 'announcement:own:read', {
        announcementRecipient: true,
      }),
    ).toBe(true);
    expect(
      hasEventPermission(['participant'], 'announcement:own:read', {
        ownsResource: true,
      }),
    ).toBe(false);
    expect(
      hasEventPermission(['speaker'], 'announcement:own:read', {
        announcementRecipient: true,
      }),
    ).toBe(false);
    expect(
      hasEventPermission(['speaker', 'participant'], 'announcement:own:read', {
        announcementRecipient: true,
      }),
    ).toBe(true);
  });

  it('lets an admin act broadly but requires an audit marker for exceptions', () => {
    expect(hasEventPermission(['organizer_admin'], 'program:manage')).toBe(
      true,
    );
    expect(hasEventPermission(['organizer_admin'], 'agenda:any:override')).toBe(
      false,
    );
    expect(
      hasEventPermission(['organizer_admin'], 'agenda:any:override', {
        auditedException: true,
      }),
    ).toBe(true);
  });
});
