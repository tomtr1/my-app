import type { WeatherSnapshot } from './weather';
import { hourAt, isWet } from './weather';
import type { CalEvent } from './calendar';
import { bringList, isOnline } from './calendar';
import type { Readiness } from './fitness';
import type { FitnessDay } from './fitness-types';
import { fmtTime } from '../lib/dates';

export type HintTone = 'alert' | 'warn' | 'info' | 'good';

export interface Hint {
  id: string;
  tone: HintTone;
  icon: 'umbrella' | 'jacket' | 'sun' | 'snow' | 'heart' | 'moon' | 'bolt' | 'car' | 'bag' | 'water' | 'calendar' | 'alert' | 'food';
  text: string;
  priority: number; // higher first
}

export interface EventPrep {
  eventId: string;
  travelMin?: number | null;
  leaveAt?: number;
  weather?: { temp: number; pop: number; code: number };
  bring: string[];
  online: boolean;
}

export interface HintInput {
  now: Date;
  weather?: WeatherSnapshot | null;
  events: CalEvent[]; // today's events
  prep?: Record<string, EventPrep>;
  readiness?: Readiness | null;
  today?: FitnessDay;
  sleepGoalMin: number;
  kcalEaten?: number;
  kcalGoal?: number;
  waterMl?: number;
  waterGoalMl?: number;
}

const sameLocalDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * Turns weather × calendar × recovery × nutrition into a short, ranked list of
 * actionable hints. Pure function — fully unit-tested.
 */
export function buildHints(i: HintInput): Hint[] {
  const out: Hint[] = [];
  const nowMs = i.now.getTime();
  const w = i.weather;

  // --- severe weather (official warnings) ---
  for (const a of w?.alerts ?? []) {
    if (Date.parse(a.expires) < nowMs) continue;
    out.push({ id: `alert:${a.id}`, tone: 'alert', icon: 'alert', text: `${a.headline || a.event} — until ${fmtTime(a.expires)}`, priority: a.severity === 'extreme' ? 100 : a.severity === 'severe' ? 95 : 70 });
  }

  // --- weather for the rest of today ---
  if (w) {
    const rest = w.hours.filter((h) => {
      const t = new Date(h.time);
      return t.getTime() >= nowMs - 30 * 60_000 && sameLocalDay(t, i.now);
    });
    const evening = rest.filter((h) => new Date(h.time).getHours() >= 17);
    const wetEvening = evening.filter((h) => h.pop >= 55 || h.precip >= 0.5);
    const wetDay = rest.filter((h) => h.pop >= 60 || h.precip >= 0.6);
    if (wetEvening.length) {
      const first = wetEvening[0];
      out.push({ id: 'rain-evening', tone: 'warn', icon: 'umbrella', text: `Rain from ${fmtTime(first.time)} tonight (${Math.max(...wetEvening.map((h) => h.pop))} %) → bring a jacket or umbrella`, priority: 60 });
    } else if (wetDay.length) {
      const first = wetDay[0];
      out.push({ id: 'rain-day', tone: 'warn', icon: 'umbrella', text: `Rain likely around ${fmtTime(first.time)} (${first.pop} %) → take an umbrella`, priority: 58 });
    }
    const today = w.days[0];
    if (today) {
      if (today.min <= 0) out.push({ id: 'frost', tone: 'warn', icon: 'snow', text: `Frost down to ${Math.round(today.min)}° → icy roads, dress warm`, priority: 55 });
      else if (today.max <= 8 && !wetDay.length) out.push({ id: 'cold', tone: 'info', icon: 'jacket', text: `Cold day (max ${Math.round(today.max)}°) → warm jacket`, priority: 30 });
      if (today.max >= 28) out.push({ id: 'heat', tone: 'warn', icon: 'water', text: `Hot (${Math.round(today.max)}°) → drink extra water, train early or late`, priority: 50 });
      if (today.uv >= 6) out.push({ id: 'uv', tone: 'info', icon: 'sun', text: `UV index ${Math.round(today.uv)} → sunscreen around midday`, priority: 35 });
      if (w.now.gusts >= 60) out.push({ id: 'wind', tone: 'warn', icon: 'bolt', text: `Strong gusts up to ${Math.round(w.now.gusts)} km/h`, priority: 52 });
    }
  }

  // --- recovery / sleep ---
  const r = i.readiness;
  const sleep = i.today?.sleepMin;
  if (sleep !== undefined && sleep < 6 * 60) {
    out.push({ id: 'short-sleep', tone: 'warn', icon: 'moon', text: `Only ${(sleep / 60).toFixed(1)} h of sleep → keep today’s workout light and aim for an early night`, priority: 65 });
  } else if (r && r.load === 'Rest') {
    out.push({ id: 'rest', tone: 'warn', icon: 'heart', text: `Recovery ${r.score} % → rest day: walk, mobility, no intensity`, priority: 62 });
  } else if (r && r.load === 'Push') {
    out.push({ id: 'push', tone: 'good', icon: 'bolt', text: `Recovery ${r.score} % → great day for a hard session`, priority: 40 });
  }
  if (r?.rhrDelta !== undefined && r.rhrDelta >= 5) {
    out.push({ id: 'rhr', tone: 'warn', icon: 'heart', text: `Resting HR +${r.rhrDelta.toFixed(0)} bpm above baseline → possible stress or illness, take it easy`, priority: 63 });
  }

  // --- calendar ---
  const upcoming = i.events.filter((e) => !e.allDay && e.end > nowMs).sort((a, b) => a.start - b.start);
  const timed = i.events.filter((e) => !e.allDay);
  if (timed.length >= 5) {
    out.push({ id: 'busy', tone: 'info', icon: 'calendar', text: `Busy day — ${timed.length} events. Block 20 min for a break.`, priority: 32 });
  }
  for (let k = 1; k < upcoming.length; k++) {
    const gap = (upcoming[k].start - upcoming[k - 1].end) / 60_000;
    const prepNext = i.prep?.[upcoming[k].id];
    if (gap >= 0 && prepNext?.travelMin && prepNext.travelMin > gap) {
      out.push({ id: `tight:${upcoming[k].id}`, tone: 'warn', icon: 'car', text: `Tight: ${prepNext.travelMin} min travel but only ${Math.round(gap)} min between “${upcoming[k - 1].title}” and “${upcoming[k].title}”`, priority: 66 });
    }
  }
  for (const e of upcoming.slice(0, 4)) {
    const p = i.prep?.[e.id];
    if (!p) continue;
    if (p.leaveAt && p.travelMin && !p.online && p.leaveAt > nowMs - 10 * 60_000 && p.leaveAt - nowMs < 4 * 3_600_000) {
      out.push({ id: `leave:${e.id}`, tone: p.leaveAt - nowMs < 20 * 60_000 ? 'warn' : 'info', icon: 'car', text: `Leave by ${fmtTime(new Date(p.leaveAt))} for “${e.title}” (${p.travelMin} min)`, priority: 64 });
    }
    if (p.weather && !p.online && (isWet(p.weather.code) || p.weather.pop >= 55) && !out.some((h) => h.icon === 'umbrella')) {
      out.push({ id: `evrain:${e.id}`, tone: 'warn', icon: 'umbrella', text: `Rain expected at “${e.title}” (${fmtTime(new Date(e.start))}) → umbrella`, priority: 57 });
    }
    if (p.bring.length) {
      out.push({ id: `bring:${e.id}`, tone: 'info', icon: 'bag', text: `For “${e.title}”: ${p.bring.join(', ')}`, priority: 45 });
    }
  }

  // --- nutrition / hydration (afternoon nudges only) ---
  const h = i.now.getHours();
  if (i.waterGoalMl && i.waterMl !== undefined && h >= 14 && i.waterMl < i.waterGoalMl * 0.4) {
    out.push({ id: 'water', tone: 'info', icon: 'water', text: `Only ${(i.waterMl / 1000).toFixed(1)} L water so far → have a glass now`, priority: 28 });
  }
  if (i.kcalGoal && i.kcalEaten !== undefined && h >= 19 && i.kcalEaten < i.kcalGoal * 0.6 && i.kcalEaten > 0) {
    out.push({ id: 'under-eat', tone: 'info', icon: 'food', text: `${Math.round(i.kcalGoal - i.kcalEaten)} kcal left today — don’t skip dinner`, priority: 25 });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** Per-event preparation: travel time, departure time, weather at location, things to bring. */
export function prepFor(
  e: CalEvent,
  opts: { travelMin?: number | null; locWeather?: WeatherSnapshot | null; homeWeather?: WeatherSnapshot | null; bufferMin?: number },
): EventPrep {
  const online = isOnline(e);
  const wx = opts.locWeather ?? opts.homeWeather;
  const hour = wx ? hourAt(wx.hours, new Date(e.start)) : undefined;
  const bring = bringList(e);
  if (hour && !online) {
    if (isWet(hour.code) || hour.pop >= 55) bring.unshift('Umbrella');
    else if (hour.temp <= 5) bring.unshift('Warm jacket');
  }
  const travel = online ? 0 : opts.travelMin;
  return {
    eventId: e.id,
    online,
    travelMin: travel,
    leaveAt: travel ? e.start - (travel + (opts.bufferMin ?? 10)) * 60_000 : undefined,
    weather: hour ? { temp: hour.temp, pop: hour.pop, code: hour.code } : undefined,
    bring: [...new Set(bring)],
  };
}
