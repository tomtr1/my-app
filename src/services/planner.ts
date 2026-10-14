import type { Settings } from '../store/settings';
import type { CalEvent } from './calendar';
import { eventsOn } from './calendar';
import type { WeatherSnapshot } from './weather';
import { wmo } from './weather';
import type { EventPrep, Hint } from './hints';
import type { Readiness } from './fitness';
import { atTime, addDays, fmtTime, ymd } from '../lib/dates';
import { hashInt } from '../lib/num';
import type { LocalNotice } from '../platform/notify';

export const MORNING_ID = 1001;

/** The morning-summary text for a given day — also shown on the Today tab. */
export function morningSummary(day: Date, opts: { weather?: WeatherSnapshot | null; events: CalEvent[]; readiness?: Readiness | null; hints?: Hint[] }): { title: string; body: string } {
  const parts: string[] = [];
  const wd = opts.weather?.days.find((d) => d.date === ymd(day));
  if (wd) parts.push(`${wmo(wd.code).label}, ${Math.round(wd.min)}–${Math.round(wd.max)}°${wd.pop >= 40 ? `, rain ${wd.pop} %` : ''}`);
  const evs = eventsOn(opts.events, day);
  const timed = evs.filter((e) => !e.allDay);
  if (timed.length) parts.push(`${timed.length} event${timed.length > 1 ? 's' : ''}, first ${fmtTime(new Date(timed[0].start))} ${timed[0].title}`);
  const allDay = evs.filter((e) => e.allDay);
  if (allDay.length) parts.push(`Today: ${allDay.map((e) => e.title).join(', ')}`);
  if (opts.readiness) parts.push(`Recovery ${opts.readiness.score} % → ${opts.readiness.load.toLowerCase()}`);
  const top = opts.hints?.filter((h) => h.tone === 'alert' || h.tone === 'warn').slice(0, 2) ?? [];
  for (const h of top) parts.push(h.text);
  return { title: 'Your day at a glance', body: parts.join(' · ') || 'Nothing scheduled — enjoy the day.' };
}

/** Computes all local notifications for the next ~36 hours. */
export function planNotifications(
  s: Settings,
  data: { now: Date; weather?: WeatherSnapshot | null; events: CalEvent[]; prep: Record<string, EventPrep>; readiness?: Readiness | null; hints?: Hint[] },
): LocalNotice[] {
  const out: LocalNotice[] = [];
  const { now } = data;
  if (s.notifications.morningSummary) {
    let at = atTime(s.notifications.morningTime, now);
    if (at <= now) at = atTime(s.notifications.morningTime, addDays(now, 1));
    const isToday = ymd(at) === ymd(now);
    const m = morningSummary(at, { ...data, readiness: isToday ? data.readiness : null, hints: isToday ? data.hints : [] });
    out.push({ id: MORNING_ID, title: m.title, body: m.body, at });
  }
  if (s.notifications.eventReminders) {
    const horizon = now.getTime() + 36 * 3_600_000;
    for (const e of data.events) {
      if (e.allDay || e.start <= now.getTime() || e.start > horizon) continue;
      const p = data.prep[e.id];
      const travel = p?.online ? 0 : (p?.travelMin ?? 0);
      const at = new Date(e.start - (s.notifications.leadMinutes + travel) * 60_000);
      if (at <= now) continue;
      const bits = [`${fmtTime(new Date(e.start))}${e.location ? ` · ${e.location}` : ''}`];
      if (travel) bits.push(`Leave now — ${travel} min travel`);
      if (p?.online) bits.push('Online meeting');
      if (p?.bring.length) bits.push(`Bring: ${p.bring.join(', ')}`);
      out.push({ id: hashInt(`ev:${e.id}`), title: e.title, body: bits.join(' · '), at });
    }
  }
  return out;
}
