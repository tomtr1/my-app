import { isTauri } from '../platform/platform';
import { addDays, ymd } from '../lib/dates';
import type { Activity, FitnessDay, HrSample } from './fitness-types';

/**
 * Garmin Connect, fully automatic, on Windows.
 *
 * Garmin's official Health API is only granted to companies, so — like the
 * open-source python-garminconnect — we sign in once with the same mobile SSO flow
 * the Garmin Connect app uses and then refresh the OAuth token silently.
 * The whole exchange runs in Rust (src-tauri/src/garmin.rs): the password never
 * touches JS, is never stored, and tokens go to Windows Credential Manager.
 *
 * iPhone: Garmin Connect writes to Apple Health, which we read via HealthKit.
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export type GarminLoginResult = { status: 'ok'; displayName: string } | { status: 'mfa_required' };

export const garmin = {
  available: () => isTauri(),
  status: () => invoke<{ connected: boolean; displayName: string | null }>('garmin_status'),
  login: (email: string, password: string) => invoke<GarminLoginResult>('garmin_login', { email, password }),
  submitMfa: (code: string) => invoke<GarminLoginResult>('garmin_mfa', { code }),
  logout: () => invoke<void>('garmin_logout'),
  get: <T>(path: string) => invoke<T>('garmin_get', { path }),
};

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function mapGarminDay(date: string, summary: J | null, sleep: J | null, hrv: J | null, spo2: J | null, maxMet: J | null): Partial<FitnessDay> {
  const s = summary ?? {};
  const dto = sleep?.dailySleepDTO ?? {};
  const vo2 = Array.isArray(maxMet) ? maxMet[0]?.generic : maxMet?.generic;
  return {
    date,
    steps: num(s.totalSteps),
    distanceM: num(s.totalDistanceMeters),
    floors: num(s.floorsAscended),
    activeKcal: num(s.activeKilocalories),
    totalKcal: num(s.totalKilocalories),
    restingHr: num(s.restingHeartRate),
    minHr: num(s.minHeartRate),
    maxHr: num(s.maxHeartRate),
    stressAvg: num(s.averageStressLevel) !== undefined && s.averageStressLevel >= 0 ? s.averageStressLevel : undefined,
    bodyBatteryNow: num(s.bodyBatteryMostRecentValue),
    bodyBatteryMax: num(s.bodyBatteryHighestValue),
    bodyBatteryMin: num(s.bodyBatteryLowestValue),
    intensityMin: num(s.moderateIntensityMinutes) !== undefined ? (s.moderateIntensityMinutes ?? 0) + 2 * (s.vigorousIntensityMinutes ?? 0) : undefined,
    respiration: num(s.avgWakingRespirationValue),
    sleepMin: num(dto.sleepTimeSeconds) !== undefined ? dto.sleepTimeSeconds / 60 : undefined,
    sleepDeepMin: num(dto.deepSleepSeconds) !== undefined ? dto.deepSleepSeconds / 60 : undefined,
    sleepRemMin: num(dto.remSleepSeconds) !== undefined ? dto.remSleepSeconds / 60 : undefined,
    sleepLightMin: num(dto.lightSleepSeconds) !== undefined ? dto.lightSleepSeconds / 60 : undefined,
    sleepAwakeMin: num(dto.awakeSleepSeconds) !== undefined ? dto.awakeSleepSeconds / 60 : undefined,
    sleepScore: num(dto.sleepScores?.overall?.value),
    sleepStart: num(dto.sleepStartTimestampGMT),
    sleepEnd: num(dto.sleepEndTimestampGMT),
    hrvMs: num(hrv?.hrvSummary?.lastNightAvg),
    spo2: num(spo2?.averageSpO2) ?? num(s.averageSpo2),
    vo2max: num(vo2?.vo2MaxPreciseValue) ?? num(vo2?.vo2MaxValue),
  };
}

export async function fetchGarmin(days: number): Promise<{ days: Partial<FitnessDay>[]; hrToday: HrSample[]; activities: Activity[] }> {
  const { displayName } = await garmin.status();
  if (!displayName) throw new Error('Garmin not connected');
  const dn = encodeURIComponent(displayName);
  const safe = <T>(p: Promise<T>) => p.catch(() => null);

  const dates = Array.from({ length: days }, (_, i) => ymd(addDays(new Date(), -i)));
  const out: Partial<FitnessDay>[] = [];
  // Today & yesterday in full detail; older days only need the daily summary (cheap, cached upstream).
  for (const [i, date] of dates.entries()) {
    const detailed = i < 2;
    const [summary, sleep, hrv, spo2, maxMet] = await Promise.all([
      safe(garmin.get<J>(`/usersummary-service/usersummary/daily/${dn}?calendarDate=${date}`)),
      safe(garmin.get<J>(`/wellness-service/wellness/dailySleepData/${dn}?date=${date}&nonSleepBufferMinutes=60`)),
      safe(garmin.get<J>(`/hrv-service/hrv/${date}`)),
      detailed ? safe(garmin.get<J>(`/wellness-service/wellness/daily/spo2/${date}`)) : Promise.resolve(null),
      detailed ? safe(garmin.get<J>(`/metrics-service/metrics/maxmet/daily/${date}/${date}`)) : Promise.resolve(null),
    ]);
    out.push(mapGarminDay(date, summary, sleep, hrv, spo2, maxMet));
  }

  const hr = await safe(garmin.get<J>(`/wellness-service/wellness/dailyHeartRate/${dn}?date=${dates[0]}`));
  const hrToday: HrSample[] = ((hr?.heartRateValues as Array<[number, number | null]>) ?? [])
    .filter((x) => x[1] !== null)
    .map(([t, bpm]) => ({ t, bpm: bpm as number }));

  const acts = (await safe(garmin.get<J[]>('/activitylist-service/activities/search/activities?start=0&limit=20'))) ?? [];
  const activities: Activity[] = acts.map((a) => ({
    id: `garmin:${a.activityId}`,
    name: a.activityName ?? a.activityType?.typeKey ?? 'Activity',
    type: a.activityType?.typeKey ?? 'other',
    start: Date.parse(String(a.startTimeGMT).replace(' ', 'T') + 'Z'),
    durationMin: (a.duration ?? 0) / 60,
    distanceM: num(a.distance),
    kcal: num(a.calories),
    avgHr: num(a.averageHR),
    source: 'garmin',
  }));
  return { days: out, hrToday, activities };
}
