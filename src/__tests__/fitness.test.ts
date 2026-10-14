import { describe, expect, it } from 'vitest';
import { readiness, weeklyInsights } from '../services/fitness';
import { mergeDays, type FitnessDay } from '../services/fitness-types';
import { mapGarminDay } from '../services/garmin';
import { addDays, ymd } from '../lib/dates';

function history(n: number, f: (i: number) => Partial<FitnessDay>, end = new Date(2026, 9, 14)) {
  const out: Record<string, FitnessDay> = {};
  for (let i = 0; i < n; i++) {
    const d = ymd(addDays(end, -i));
    out[d] = { date: d, sources: ['garmin'], ...f(i) };
  }
  return out;
}

describe('readiness', () => {
  it('prefers WHOOP recovery when present', () => {
    const days = history(5, () => ({ recovery: 81, hrvMs: 60 }));
    const r = readiness({ days }, 480, '2026-10-14')!;
    expect(r.source).toBe('whoop');
    expect(r.score).toBe(81);
    expect(r.tone).toBe('good');
  });

  it('computes from HRV/RHR/sleep vs baseline', () => {
    const days = history(29, (i) => (i === 0 ? { hrvMs: 72, restingHr: 46, sleepMin: 470 } : { hrvMs: 60, restingHr: 50, sleepMin: 450 }));
    const r = readiness({ days }, 480, '2026-10-14')!;
    expect(r.hrvDeltaPct).toBeCloseTo(20, 0);
    expect(r.rhrDelta).toBeCloseTo(-4, 0);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.load).toBe('Push');
  });

  it('short sleep caps the training load', () => {
    const days = history(29, (i) => (i === 0 ? { hrvMs: 70, restingHr: 48, sleepMin: 280 } : { hrvMs: 60, restingHr: 50, sleepMin: 450 }));
    const r = readiness({ days }, 480, '2026-10-14')!;
    expect(['Light', 'Rest']).toContain(r.load);
  });
});

describe('mergeDays', () => {
  it('earlier sources win, later ones fill gaps', () => {
    const m = mergeDays([
      { date: 'd', sources: ['garmin'], steps: 9000, restingHr: 50 },
      { date: 'd', sources: ['whoop'], steps: 8000, recovery: 70, restingHr: 49 },
    ]);
    expect(m).toMatchObject({ steps: 9000, restingHr: 50, recovery: 70, sources: ['garmin', 'whoop'] });
  });
});

describe('garmin mapping', () => {
  it('maps the daily summary, sleep and HRV payloads', () => {
    const d = mapGarminDay(
      '2026-10-14',
      { totalSteps: 11773, restingHeartRate: 41, averageStressLevel: -1, bodyBatteryMostRecentValue: 64, bodyBatteryHighestValue: 92, moderateIntensityMinutes: 20, vigorousIntensityMinutes: 10 },
      { dailySleepDTO: { sleepTimeSeconds: 27000, deepSleepSeconds: 5400, sleepScores: { overall: { value: 84 } } } },
      { hrvSummary: { lastNightAvg: 98 } },
      null,
      [{ generic: { vo2MaxPreciseValue: 55.2 } }],
    );
    expect(d).toMatchObject({ steps: 11773, restingHr: 41, bodyBatteryNow: 64, sleepMin: 450, sleepDeepMin: 90, sleepScore: 84, hrvMs: 98, vo2max: 55.2, intensityMin: 40 });
    expect(d.stressAvg).toBeUndefined();
  });
});

describe('weeklyInsights', () => {
  it('reports meaningful week-over-week changes only', () => {
    const days = history(14, (i) => ({ steps: i < 7 ? 12000 : 8000, restingHr: 50 }));
    const out = weeklyInsights(days, new Date(2026, 9, 14));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Steps up 50 %/);
  });
});
