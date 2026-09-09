import { describe, expect, it } from 'vitest';
import {
  participantTourDestination,
  participantTourHref,
  preserveParticipantTourNavigation,
  resolveParticipantTour,
} from './participant-tour';
const id = 'a02d41a0-c21e-4308-80da-2ff4e1da04bc';

describe('contextual guide navigation', () => {
  it('resumes only a known step on its matching route and validates the selected activity', () => {
    expect(
      resolveParticipantTour(
        '/app/program',
        new URLSearchParams('pruvodce=program'),
      )?.step.id,
    ).toBe('program');
    expect(
      resolveParticipantTour(
        '/app/profil',
        new URLSearchParams('pruvodce=program'),
      ),
    ).toBeNull();
    expect(
      resolveParticipantTour(
        '/app/program',
        new URLSearchParams('pruvodce=unknown'),
      ),
    ).toBeNull();
    expect(participantTourHref('detail', 'https://example.com')).toBe(
      '/app/program?pruvodce=program',
    );
    expect(
      resolveParticipantTour(
        '/app/agenda',
        new URLSearchParams(`pruvodce=agenda&aktivita=${id}`),
      )?.sessionId,
    ).toBe(id);
  });
  it('continues through announcement filters and message details', () => {
    const current = `https://app.example/app/oznameni?pruvodce=announcements&aktivita=${id}`;
    expect(
      preserveParticipantTourNavigation('/app/oznameni?view=unread', current),
    ).toBe(`/app/oznameni?view=unread&pruvodce=announcements&aktivita=${id}`);
    expect(
      participantTourDestination(
        `/app/oznameni/${id}`,
        'https://app.example',
        null,
      ),
    ).toBe(`/app/oznameni/${id}?pruvodce=announcements`);
    expect(
      resolveParticipantTour(
        `/app/oznameni/${id}`,
        new URLSearchParams('pruvodce=announcements'),
      )?.step.id,
    ).toBe('announcements');
    expect(
      preserveParticipantTourNavigation(
        '/app/oznameni?view=unread',
        'https://app.example/app/oznameni',
      ),
    ).toBe('/app/oznameni?view=unread');
  });
  it('keeps real activity links and program filters, without converting external links or actions', () => {
    expect(
      participantTourDestination(
        `/app/program/${id}?coaching=choose`,
        'https://app.example',
        null,
      ),
    ).toBe(`/app/program/${id}?coaching=choose&pruvodce=detail`);
    expect(
      participantTourDestination(
        '/app/program?day=friday',
        'https://app.example',
        id,
      ),
    ).toBe(`/app/program?day=friday&pruvodce=program&aktivita=${id}`);
    for (const href of [
      'https://elsewhere.example/app/agenda',
      '/api/v1/me/agenda/actions',
      '/app/soukromi',
      '/app/program#day',
    ])
      expect(
        participantTourDestination(href, 'https://app.example', null),
      ).toBeNull();
  });
});
