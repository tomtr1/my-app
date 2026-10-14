import { describe, expect, it } from 'vitest';
import { buildHints, prepFor } from '../services/hints';
import type { WeatherSnapshot } from '../services/weather';
import type { CalEvent } from '../services/calendar';

const local = (h: number, m = 0) => new Date(2026, 9, 14, h, m);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;

function weather(rainFrom: number | null, opts: Partial<{ max: number; min: number; uv: number }> = {}): WeatherSnapshot {
  return {
    placeId: 'home', placeName: 'Home', lat: 53.5, lon: 10, fetchedAt: 0, alerts: [],
    now: { temp: 12, feels: 10, humidity: 70, precip: 0, code: 2, wind: 10, gusts: 20, isDay: true },
    hours: Array.from({ length: 24 }, (_, h) => ({
      time: iso(local(h)), temp: 12, pop: rainFrom !== null && h >= rainFrom ? 80 : 5, precip: rainFrom !== null && h >= rainFrom ? 1.2 : 0,
      code: rainFrom !== null && h >= rainFrom ? 63 : 2, wind: 10, uv: 2,
    })),
    days: [{ date: '2026-10-14', code: 63, max: opts.max ?? 15, min: opts.min ?? 8, pop: 80, precip: 5, sunrise: '', sunset: '', uv: opts.uv ?? 2, wind: 15 }],
  };
}

const ev = (id: string, title: string, h: number, durMin = 60, location?: string): CalEvent => ({
  id, title, start: local(h).getTime(), end: local(h).getTime() + durMin * 60_000, allDay: false, calendar: 'Work', color: '#fff', location,
});

describe('buildHints', () => {
  it('warns about rain tonight', () => {
    const h = buildHints({ now: local(8), weather: weather(18), events: [], sleepGoalMin: 480 });
    expect(h[0].icon).toBe('umbrella');
    expect(h[0].text).toMatch(/Rain from .* tonight/);
  });

  it('turns short sleep into a light-workout hint', () => {
    const h = buildHints({ now: local(8), events: [], sleepGoalMin: 480, today: { date: '2026-10-14', sources: [], sleepMin: 300 } });
    expect(h.find((x) => x.id === 'short-sleep')!.text).toContain('Only 5.0 h of sleep → keep today’s workout light');
  });

  it('detects tight transitions using travel time', () => {
    const a = ev('a', 'Meeting', 10, 60);
    const b = ev('b', 'Client visit', 11, 60, 'Elsewhere');
    const h = buildHints({ now: local(8), events: [a, b], sleepGoalMin: 480, prep: { b: { eventId: 'b', travelMin: 25, bring: [], online: false } } });
    expect(h.some((x) => x.id === 'tight:b')).toBe(true);
  });

  it('ranks official alerts first', () => {
    const w = weather(null);
    w.alerts = [{ id: '1', event: 'STORM', headline: 'Storm warning', description: '', severity: 'severe', onset: local(6).toISOString(), expires: local(22).toISOString() }];
    const h = buildHints({ now: local(8), weather: w, events: [], sleepGoalMin: 480, today: { date: '', sources: [], sleepMin: 300 } });
    expect(h[0].tone).toBe('alert');
  });

  it('does not nag about hydration in the morning', () => {
    const h = buildHints({ now: local(9), events: [], sleepGoalMin: 480, waterMl: 0, waterGoalMl: 2500 });
    expect(h.some((x) => x.id === 'water')).toBe(false);
    const h2 = buildHints({ now: local(15), events: [], sleepGoalMin: 480, waterMl: 0, waterGoalMl: 2500 });
    expect(h2.some((x) => x.id === 'water')).toBe(true);
  });
});

describe('prepFor', () => {
  it('computes departure and adds an umbrella when it rains at event time', () => {
    const e = ev('x', 'Gym session', 19, 60, 'FitX');
    const p = prepFor(e, { travelMin: 15, homeWeather: weather(18) });
    expect(p.leaveAt).toBe(e.start - 25 * 60_000);
    expect(p.bring[0]).toBe('Umbrella');
    expect(p.bring).toContain('Gym bag & water bottle');
  });

  it('online meetings need no travel', () => {
    const p = prepFor(ev('y', 'Sync call', 9, 30, 'https://zoom.us/j/1'), { travelMin: 30 });
    expect(p.online).toBe(true);
    expect(p.leaveAt).toBeUndefined();
  });
});
