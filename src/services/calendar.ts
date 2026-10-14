import ICAL from 'ical.js';
import { getText } from '../platform/http';
import { LifeNative } from '../platform/native';
import { isNativeIOS } from '../platform/platform';
import type { CalendarFeed } from '../store/settings';

export interface CalEvent {
  id: string;
  title: string;
  start: number; // epoch ms
  end: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendar: string;
  color: string;
  url?: string;
}

export interface CalendarSnapshot {
  events: CalEvent[];
  errors: string[];
  fetchedAt: number;
}

/**
 * Parses an iCalendar document and expands recurring events inside [from, to).
 * Handles VTIMEZONE definitions and RECURRENCE-ID overrides.
 */
export function parseIcs(ics: string, from: Date, to: Date, cal: { name: string; color: string }): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(String(tzid))) ICAL.TimezoneService.register(tz);
  }
  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (ve.hasProperty('recurrence-id')) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}:${ex.recurrenceId}`, ex);
  }

  const out: CalEvent[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time, idSuffix: string) => {
    const s = start.toJSDate().getTime();
    const e = end.toJSDate().getTime();
    if (e <= fromMs || s >= toMs) return;
    const status = String(ev.component.getFirstPropertyValue('status') ?? '');
    if (status.toUpperCase() === 'CANCELLED') return;
    out.push({
      id: `${ev.uid}${idSuffix}`,
      title: ev.summary || '(no title)',
      start: s,
      end: e,
      allDay: start.isDate,
      location: ev.location || undefined,
      notes: ev.description || undefined,
      calendar: cal.name,
      color: cal.color,
      url: (ev.component.getFirstPropertyValue('url') as string | null) ?? undefined,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate ?? ev.startDate, '');
      continue;
    }
    const it = ev.iterator();
    let next: ICAL.Time | null;
    let guard = 0;
    while ((next = it.next()) && guard++ < 2000) {
      const t = next.toJSDate().getTime();
      if (t >= toMs) break;
      const d = ev.getOccurrenceDetails(next);
      if (d.endDate.toJSDate().getTime() <= fromMs) continue;
      push(d.item, d.startDate, d.endDate, `@${t}`);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/^webcals?:\/\//i, 'https://');
}

export async function fetchCalendars(feeds: CalendarFeed[], useDevice: boolean, days = 14): Promise<CalendarSnapshot> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 1);
  const to = new Date(from.getTime() + (days + 1) * 86_400_000);
  const errors: string[] = [];
  const events: CalEvent[] = [];

  await Promise.all(
    feeds
      .filter((f) => f.enabled && f.url)
      .map(async (f) => {
        try {
          events.push(...parseIcs(await getText(normalizeUrl(f.url), { timeoutMs: 20000 }), from, to, f));
        } catch (e) {
          errors.push(`${f.name}: ${(e as Error).message}`);
        }
      }),
  );

  if (useDevice && isNativeIOS()) {
    // iPhone: every account added in iOS Settings (iCloud, Google, Exchange/Outlook) via EventKit.
    try {
      const { granted } = await LifeNative.calendarAuthorize();
      if (granted) {
        const r = await LifeNative.calendarEvents({ start: from.toISOString(), end: to.toISOString() });
        events.push(
          ...r.events.map((e) => ({
            id: `ek:${e.id}`,
            title: e.title,
            start: Date.parse(e.start),
            end: Date.parse(e.end),
            allDay: e.allDay,
            location: e.location,
            notes: e.notes,
            calendar: e.calendar,
            color: e.color ?? '#8b8bf5',
          })),
        );
      }
    } catch (e) {
      errors.push(`Device calendars: ${(e as Error).message}`);
    }
  }

  // De-duplicate events present in several sources (same title & start).
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const k = `${e.title.toLowerCase()}|${e.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { events: unique.sort((a, b) => a.start - b.start), errors, fetchedAt: Date.now() };
}

export function eventsOn(events: CalEvent[], day: Date): CalEvent[] {
  const s = new Date(day);
  s.setHours(0, 0, 0, 0);
  const e = s.getTime() + 86_400_000;
  return events.filter((ev) => ev.start < e && ev.end > s.getTime());
}

const ONLINE = /(zoom\.us|teams\.microsoft|meet\.google|webex|whereby|online|virtual|remote|call)/i;

export function isOnline(ev: Pick<CalEvent, 'location' | 'notes' | 'title'>): boolean {
  return ONLINE.test(`${ev.location ?? ''} ${ev.title}`) || (!ev.location && ONLINE.test(ev.notes ?? ''));
}

/** "Things to bring" derived from the event itself (weather/travel added by the enricher). */
export function bringList(ev: Pick<CalEvent, 'title' | 'notes'>): string[] {
  const t = `${ev.title} ${ev.notes ?? ''}`.toLowerCase();
  const out: string[] = [];
  const rules: Array<[RegExp, string]> = [
    [/\b(gym|training|workout|fitness|crossfit|yoga|pilates|lauf|run|swim|schwimm)/, 'Gym bag & water bottle'],
    [/\b(swim|schwimm|pool|sauna)/, 'Towel & swimwear'],
    [/\b(flight|flug|airport|flughafen)/, 'Passport / ID & boarding pass'],
    [/\b(doctor|arzt|dentist|zahnarzt|clinic|praxis|hospital)/, 'Insurance card'],
    [/\b(interview|pitch|presentation|präsentation|demo)/, 'Laptop, charger & notes'],
    [/\b(birthday|geburtstag)/, 'Gift / card'],
    [/\b(train|zug|bahn|ice\b)/, 'Ticket on phone'],
  ];
  for (const [re, item] of rules) if (re.test(t) && !out.includes(item)) out.push(item);
  // Lines like "Bring: x, y" / "Mitbringen: …" in the event notes
  const m = (ev.notes ?? '').match(/(?:bring|mitbringen|mitnehmen)\s*:?\s*(.+)/i);
  if (m) out.push(...m[1].split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 4));
  return out;
}
