import { LifeNative } from '../platform/native';
import { addDays, startOfDay } from '../lib/dates';
import type { Activity, FitnessDay, HrSample } from './fitness-types';

/**
 * Apple Health (iPhone). Garmin Connect and WHOOP both write into HealthKit, so this
 * is the zero-configuration path on iOS: steps, HR, resting HR, HRV, sleep, SpO2,
 * VO2max and workouts arrive automatically after their apps sync.
 */
export async function fetchAppleHealth(days: number): Promise<{ days: Partial<FitnessDay>[]; hrToday: HrSample[]; activities: Activity[] }> {
  const { granted } = await LifeNative.healthAuthorize();
  if (!granted) throw new Error('Apple Health access not granted');
  const end = new Date();
  const start = startOfDay(addDays(end, -(days - 1)));
  const [d, hr, w] = await Promise.all([
    LifeNative.healthDays({ start: start.toISOString(), end: end.toISOString() }),
    LifeNative.healthHeartRate({ start: startOfDay(end).toISOString(), end: end.toISOString() }),
    LifeNative.healthWorkouts({ start: start.toISOString(), end: end.toISOString() }),
  ]);
  return {
    days: d.days.map((x) => ({
      date: x.date,
      steps: x.steps,
      activeKcal: x.activeKcal,
      restingHr: x.restingHr,
      hrvMs: x.hrvMs,
      spo2: x.spo2,
      vo2max: x.vo2max,
      sleepMin: x.sleepMinutes,
      sleepDeepMin: x.sleepDeepMinutes,
      sleepRemMin: x.sleepRemMinutes,
      sleepStart: x.sleepStart ? Date.parse(x.sleepStart) : undefined,
      sleepEnd: x.sleepEnd ? Date.parse(x.sleepEnd) : undefined,
    })),
    hrToday: hr.samples.map((s) => ({ t: Date.parse(s.t), bpm: s.v })),
    activities: w.workouts.map((x) => ({
      id: `hk:${x.id}`,
      name: x.type,
      type: x.type,
      start: Date.parse(x.start),
      durationMin: (Date.parse(x.end) - Date.parse(x.start)) / 60000,
      distanceM: x.distanceM,
      kcal: x.kcal,
      source: 'apple-health',
    })),
  };
}
