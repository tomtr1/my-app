import { isNativeIOS } from '../platform/platform';
import { addDays, parseYmd, ymd } from '../lib/dates';
import { clamp, mean } from '../lib/num';
import type { Settings } from '../store/settings';
import { mergeDays, type Activity, type FitnessDay, type FitnessSnapshot, type FitnessSource, type HrSample } from './fitness-types';
import { fetchGarmin, garmin } from './garmin';
import { fetchWhoop, whoop } from './whoop';
import { fetchAppleHealth } from './applehealth';

export async function fetchFitness(s: Settings['fitness'], days = 28): Promise<FitnessSnapshot> {
  const errors: string[] = [];
  type Part = { source: FitnessSource; days: Partial<FitnessDay>[]; hrToday?: HrSample[]; activities: Activity[] };
  const jobs: Array<Promise<Part | null>> = [];
  const run = (source: FitnessSource, p: () => Promise<Omit<Part, 'source'>>) =>
    jobs.push(
      p()
        .then((r) => ({ ...r, source }))
        .catch((e) => {
          errors.push(`${source}: ${(e as Error).message ?? e}`);
          return null;
        }),
    );

  // Order = precedence when sources disagree. Garmin first for movement/HR (it's the
  // wearable), WHOOP for recovery/strain (its own metric), Apple Health fills gaps.
  if (s.garmin && garmin.available()) run('garmin', () => fetchGarmin(Math.min(days, 14)));
  if (s.whoop && (await whoop.connected())) run('whoop', () => fetchWhoop(days));
  if (s.appleHealth && isNativeIOS()) run('apple-health', () => fetchAppleHealth(days));

  const parts = (await Promise.all(jobs)).filter((p): p is Part => !!p);
  const map: Record<string, FitnessDay> = {};
  const allDates = new Set(parts.flatMap((p) => p.days.map((d) => d.date!)));
  for (const date of allDates) {
    map[date] = mergeDays(
      parts.map((p) => ({ ...(p.days.find((d) => d.date === date) ?? { date }), date, sources: p.days.some((d) => d.date === date) ? [p.source] : [] })),
    );
  }
  const hrToday = parts.find((p) => p.hrToday?.length)?.hrToday ?? [];
  const activities = parts
    .flatMap((p) => p.activities)
    .sort((a, b) => b.start - a.start)
    .filter((a, i, arr) => !arr.slice(0, i).some((b) => Math.abs(b.start - a.start) < 5 * 60_000)); // same workout from 2 sources
  return { days: map, hrToday, activities: activities.slice(0, 30), errors, fetchedAt: Date.now() };
}

export interface Readiness {
  score: number; // 0–100
  label: 'Recovered' | 'Moderate' | 'Low';
  tone: 'good' | 'warn' | 'bad';
  source: 'whoop' | 'computed';
  hrvDeltaPct?: number;
  rhrDelta?: number;
  hrvBaseline?: number;
  rhrBaseline?: number;
  sleepRatio?: number;
  advice: string;
  load: 'Push' | 'Normal' | 'Light' | 'Rest';
}

function baseline(days: Record<string, FitnessDay>, key: 'hrvMs' | 'restingHr', today: string, n = 28): number | undefined {
  const vals: number[] = [];
  for (let i = 1; i <= n; i++) {
    const v = days[ymd(addDays(parseYmd(today), -i))]?.[key];
    if (v !== undefined) vals.push(v);
  }
  return vals.length >= 3 ? mean(vals) : undefined;
}

/**
 * Readiness: WHOOP's recovery score when available, otherwise a transparent blend of
 * HRV vs 28-day baseline (45 %), resting HR vs baseline (25 %), sleep vs goal (30 %),
 * nudged by Garmin Body Battery.
 */
export function readiness(snapshot: Pick<FitnessSnapshot, 'days'>, sleepGoalMin: number, date = ymd()): Readiness | null {
  const d = snapshot.days[date];
  if (!d) return null;
  const hrvBaseline = baseline(snapshot.days, 'hrvMs', date);
  const rhrBaseline = baseline(snapshot.days, 'restingHr', date);
  const hrvDeltaPct = d.hrvMs !== undefined && hrvBaseline ? ((d.hrvMs - hrvBaseline) / hrvBaseline) * 100 : undefined;
  const rhrDelta = d.restingHr !== undefined && rhrBaseline ? d.restingHr - rhrBaseline : undefined;
  const sleepRatio = d.sleepMin !== undefined ? d.sleepMin / sleepGoalMin : undefined;

  let score: number;
  let source: Readiness['source'] = 'computed';
  if (d.recovery !== undefined) {
    score = d.recovery;
    source = 'whoop';
  } else {
    const parts: Array<[number, number]> = [];
    if (hrvDeltaPct !== undefined) parts.push([clamp(60 + hrvDeltaPct * 2, 0, 100), 0.45]);
    if (rhrDelta !== undefined) parts.push([clamp(70 - rhrDelta * 8, 0, 100), 0.25]);
    if (sleepRatio !== undefined) parts.push([clamp(sleepRatio * 90, 0, 100), 0.3]);
    if (!parts.length && d.bodyBatteryMax !== undefined) parts.push([d.bodyBatteryMax, 1]);
    if (!parts.length) return null;
    const w = parts.reduce((a, [, x]) => a + x, 0);
    score = parts.reduce((a, [v, x]) => a + v * x, 0) / w;
    if (d.bodyBatteryMax !== undefined) score = score * 0.8 + d.bodyBatteryMax * 0.2;
  }
  score = Math.round(clamp(score, 0, 100));
  const tone: Readiness['tone'] = score >= 67 ? 'good' : score >= 34 ? 'warn' : 'bad';
  const label: Readiness['label'] = tone === 'good' ? 'Recovered' : tone === 'warn' ? 'Moderate' : 'Low';
  const shortSleep = sleepRatio !== undefined && sleepRatio < 0.75;
  const load: Readiness['load'] = score >= 80 && !shortSleep ? 'Push' : score >= 55 && !shortSleep ? 'Normal' : score >= 34 ? 'Light' : 'Rest';

  const bits: string[] = [];
  if (d.hrvMs !== undefined) bits.push(`HRV ${Math.round(d.hrvMs)} ms${hrvDeltaPct !== undefined ? ` (${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct.toFixed(0)} % vs 28-day baseline)` : ''}`);
  if (d.restingHr !== undefined) bits.push(`resting HR ${Math.round(d.restingHr)} bpm${rhrDelta !== undefined ? ` (${rhrDelta >= 0 ? '+' : ''}${rhrDelta.toFixed(1)})` : ''}`);
  if (d.sleepMin !== undefined) bits.push(`${(d.sleepMin / 60).toFixed(1)} h sleep`);
  const lead =
    load === 'Push' ? 'You are well recovered — a good day for intensity.' :
    load === 'Normal' ? 'Solid recovery — train as planned.' :
    load === 'Light' ? 'Partially recovered — keep today’s workout light.' :
    'Low recovery — prioritise rest, mobility and an early night.';
  return { score, label, tone, source, hrvDeltaPct, rhrDelta, hrvBaseline, rhrBaseline, sleepRatio, load, advice: bits.length ? `${lead} ${bits.join(', ')}.` : lead };
}

/** Week-over-week comparisons for the insights list. */
export function weeklyInsights(days: Record<string, FitnessDay>, today = new Date()): string[] {
  const week = (offset: number, key: keyof FitnessDay) =>
    mean(
      Array.from({ length: 7 }, (_, i) => days[ymd(addDays(today, -i - offset))]?.[key]).filter((v): v is number => typeof v === 'number'),
    );
  const out: string[] = [];
  const cmp = (key: keyof FitnessDay, label: string, unit: string, higherIsBetter = true, digits = 0) => {
    const a = week(0, key);
    const b = week(7, key);
    if (a === undefined || b === undefined || b === 0) return;
    const delta = ((a - b) / b) * 100;
    if (Math.abs(delta) < 4) return;
    const better = delta > 0 === higherIsBetter;
    out.push(`${label} ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(0)} % vs last week (avg ${a.toFixed(digits)}${unit}) ${better ? '↑ good' : '↓ watch'}`);
  };
  cmp('steps', 'Steps', '');
  cmp('sleepMin', 'Sleep', ' min');
  cmp('hrvMs', 'HRV', ' ms');
  cmp('restingHr', 'Resting HR', ' bpm', false, 1);
  cmp('stressAvg', 'Stress', '', false);
  return out;
}
