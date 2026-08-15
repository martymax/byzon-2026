export const eventRoles = [
  'participant',
  'speaker',
  'organizer_admin',
  'checkin_operator',
  'moderator',
  'room_operator',
  'system_worker',
] as const;

export type EventRole = (typeof eventRoles)[number];

export const eventPermissions = [
  'program:published:read',
  'agenda:own:write',
  'agenda:any:override',
  'networking:directory:read',
  'networking:reported-content:moderate',
  'program:manage',
  'profile:own:write',
  'privacy:own:write',
  'checkin:own-code:read',
  'checkin:perform',
  'checkin:undo',
  'reservation:own:read',
  'reservation:assigned:read',
  'reservation:any:read',
  'session:assigned:moderate',
  'announcement:own:read',
  'announcement:send',
  'ticket:any:manage',
  'participant:operational:read',
  'role:manage',
  'operations:read',
  'audit:read',
  'event:settings:manage',
  'personal-data:operational:export',
] as const;

export type EventPermission = (typeof eventPermissions)[number];

export interface PermissionContext {
  ownsResource?: boolean;
  networkingOptedIn?: boolean;
  announcementRecipient?: boolean;
  assignedSession?: boolean;
  assignedRoom?: boolean;
  auditedException?: boolean;
}

const rolePermissions = {
  participant: [
    'program:published:read',
    'agenda:own:write',
    'networking:directory:read',
    'profile:own:write',
    'privacy:own:write',
    'checkin:own-code:read',
    'reservation:own:read',
    'announcement:own:read',
  ],
  speaker: [
    'program:published:read',
    'agenda:own:write',
    'networking:directory:read',
    'profile:own:write',
    'privacy:own:write',
    'checkin:own-code:read',
    'reservation:own:read',
    'announcement:own:read',
  ],
  organizer_admin: [
    'program:published:read',
    'agenda:any:override',
    'networking:reported-content:moderate',
    'program:manage',
    'checkin:perform',
    'checkin:undo',
    'reservation:any:read',
    'session:assigned:moderate',
    'announcement:send',
    'ticket:any:manage',
    'participant:operational:read',
    'role:manage',
    'operations:read',
    'audit:read',
    'event:settings:manage',
    'personal-data:operational:export',
  ],
  checkin_operator: [
    'program:published:read',
    'checkin:perform',
    'checkin:undo',
  ],
  moderator: ['program:published:read', 'session:assigned:moderate'],
  room_operator: ['program:published:read', 'reservation:assigned:read'],
  system_worker: [],
} as const satisfies Record<EventRole, readonly EventPermission[]>;

const contextAllows = (
  role: EventRole,
  permission: EventPermission,
  context: PermissionContext,
): boolean => {
  switch (permission) {
    case 'announcement:own:read':
      return context.announcementRecipient === true;
    case 'agenda:own:write':
    case 'checkin:own-code:read':
    case 'reservation:own:read':
    case 'profile:own:write':
    case 'privacy:own:write':
      return context.ownsResource === true;
    case 'agenda:any:override':
    case 'personal-data:operational:export':
      return context.auditedException === true;
    case 'networking:directory:read':
      return context.networkingOptedIn === true;
    case 'reservation:assigned:read':
      return context.assignedRoom === true || context.assignedSession === true;
    case 'session:assigned:moderate':
      return role === 'organizer_admin' || context.assignedSession === true;
    case 'announcement:send':
      return role === 'organizer_admin';
    default:
      return true;
  }
};

export const hasEventPermission = (
  roles: readonly EventRole[],
  permission: EventPermission,
  context: PermissionContext = {},
): boolean =>
  roles.some(
    (role) =>
      rolePermissions[role].includes(permission as never) &&
      contextAllows(role, permission, context),
  );
