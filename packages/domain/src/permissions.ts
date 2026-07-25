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
  'networking:reports:moderate',
  'networking:connection:message',
  'networking:reported-content:moderate',
  'program:own-materials:write',
  'program:manage',
  'checkin:own-code:read',
  'checkin:perform',
  'checkin:undo',
  'reservation:own:read',
  'reservation:assigned:read',
  'reservation:any:read',
  'session:assigned:answer',
  'session:assigned:moderate',
  'announcement:own:read',
  'announcement:send',
  'personal-data:own:export',
  'personal-data:operational:export',
] as const;

export type EventPermission = (typeof eventPermissions)[number];

export interface PermissionContext {
  ownsResource?: boolean;
  networkingOptedIn?: boolean;
  acceptedConnection?: boolean;
  announcementRecipient?: boolean;
  assignedSession?: boolean;
  assignedRoom?: boolean;
  moderatorCanAnnounce?: boolean;
  auditedException?: boolean;
}

const rolePermissions = {
  participant: [
    'program:published:read',
    'agenda:own:write',
    'networking:directory:read',
    'networking:connection:message',
    'checkin:own-code:read',
    'reservation:own:read',
    'announcement:own:read',
    'personal-data:own:export',
  ],
  speaker: [
    'program:published:read',
    'program:own-materials:write',
    'checkin:own-code:read',
    'reservation:own:read',
    'session:assigned:answer',
    'personal-data:own:export',
  ],
  organizer_admin: [
    'program:published:read',
    'agenda:any:override',
    'networking:reports:moderate',
    'networking:reported-content:moderate',
    'program:manage',
    'checkin:perform',
    'checkin:undo',
    'reservation:any:read',
    'session:assigned:answer',
    'session:assigned:moderate',
    'announcement:send',
    'personal-data:operational:export',
  ],
  checkin_operator: [
    'program:published:read',
    'checkin:perform',
    'checkin:undo',
  ],
  moderator: [
    'program:published:read',
    'networking:reports:moderate',
    'session:assigned:moderate',
    'announcement:send',
  ],
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
    case 'personal-data:own:export':
    case 'program:own-materials:write':
      return context.ownsResource === true;
    case 'agenda:any:override':
    case 'personal-data:operational:export':
      return context.auditedException === true;
    case 'networking:directory:read':
      return context.networkingOptedIn === true;
    case 'networking:connection:message':
      return (
        context.networkingOptedIn === true &&
        context.acceptedConnection === true
      );
    case 'reservation:assigned:read':
      return context.assignedRoom === true || context.assignedSession === true;
    case 'session:assigned:answer':
    case 'session:assigned:moderate':
      return role === 'organizer_admin' || context.assignedSession === true;
    case 'announcement:send':
      return (
        role === 'organizer_admin' || context.moderatorCanAnnounce === true
      );
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
