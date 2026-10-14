import { describe, expect, it } from 'vitest';
import { bringList, isOnline, parseIcs } from '../services/calendar';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:standup@test
DTSTART;TZID=Europe/Berlin:20261012T093000
DTEND;TZID=Europe/Berlin:20261012T094500
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Standup
LOCATION:https://meet.google.com/abc
END:VEVENT
BEGIN:VEVENT
UID:standup@test
RECURRENCE-ID;TZID=Europe/Berlin:20261014T093000
DTSTART;TZID=Europe/Berlin:20261014T110000
DTEND;TZID=Europe/Berlin:20261014T111500
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:dentist@test
DTSTART:20261015T080000Z
DTEND:20261015T090000Z
SUMMARY:Zahnarzt
LOCATION:Hauptstraße 1, Hamburg
DESCRIPTION:Bring: Röntgenbild, Überweisung
END:VEVENT
BEGIN:VEVENT
UID:cancelled@test
DTSTART:20261015T120000Z
DTEND:20261015T130000Z
SUMMARY:Lunch
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:holiday@test
DTSTART;VALUE=DATE:20261016
DTEND;VALUE=DATE:20261017
SUMMARY:Holiday
END:VEVENT
END:VCALENDAR`;

describe('parseIcs', () => {
  const evs = parseIcs(ICS, new Date('2026-10-13T00:00:00Z'), new Date('2026-10-20T00:00:00Z'), { name: 'Work', color: '#fff' });

  it('expands recurrences inside the window only', () => {
    const standups = evs.filter((e) => e.title.startsWith('Standup'));
    expect(standups).toHaveLength(4); // 13,14(moved),15,16 — the 12th is before the window
  });

  it('applies RECURRENCE-ID overrides and timezones', () => {
    const moved = evs.find((e) => e.title === 'Standup (moved)')!;
    expect(new Date(moved.start).toISOString()).toBe('2026-10-14T09:00:00.000Z'); // 11:00 CEST
    const normal = evs.find((e) => e.title === 'Standup')!;
    expect(new Date(normal.start).toISOString()).toBe('2026-10-13T07:30:00.000Z');
  });

  it('drops cancelled events and keeps all-day ones', () => {
    expect(evs.some((e) => e.title === 'Lunch')).toBe(false);
    const hol = evs.find((e) => e.title === 'Holiday')!;
    expect(hol.allDay).toBe(true);
  });

  it('extracts prep info', () => {
    const d = evs.find((e) => e.title === 'Zahnarzt')!;
    expect(bringList(d)).toEqual(['Insurance card', 'Röntgenbild', 'Überweisung']);
    expect(isOnline(evs.find((e) => e.title === 'Standup')!)).toBe(true);
    expect(isOnline(d)).toBe(false);
  });
});
