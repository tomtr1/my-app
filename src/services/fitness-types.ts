export type FitnessSource = 'garmin' | 'whoop' | 'apple-health';

export interface FitnessDay {
  date: string; // YYYY-MM-DD
  steps?: number;
  distanceM?: number;
  floors?: number;
  activeKcal?: number;
  totalKcal?: number;
  restingHr?: number;
  minHr?: number;
  maxHr?: number;
  hrvMs?: number; // nightly avg (Garmin RMSSD / WHOOP RMSSD / Apple SDNN)
  sleepMin?: number;
  sleepDeepMin?: number;
  sleepRemMin?: number;
  sleepLightMin?: number;
  sleepAwakeMin?: number;
  sleepScore?: number;
  sleepStart?: number;
  sleepEnd?: number;
  stressAvg?: number;
  bodyBatteryNow?: number;
  bodyBatteryMax?: number;
  bodyBatteryMin?: number;
  spo2?: number;
  vo2max?: number;
  respiration?: number;
  intensityMin?: number;
  /** WHOOP */
  recovery?: number;
  strain?: number;
  sources: FitnessSource[];
}

export interface HrSample {
  t: number;
  bpm: number;
}

export interface Activity {
  id: string;
  name: string;
  type: string;
  start: number;
  durationMin: number;
  distanceM?: number;
  kcal?: number;
  avgHr?: number;
  strain?: number;
  source: FitnessSource;
}

export interface FitnessSnapshot {
  days: Record<string, FitnessDay>;
  hrToday: HrSample[];
  activities: Activity[];
  errors: string[];
  fetchedAt: number;
}

/** Field-wise merge: earlier sources win, later ones fill gaps. */
export function mergeDays(parts: Array<Partial<FitnessDay> & { date: string; sources: FitnessSource[] }>): FitnessDay {
  const out: FitnessDay = { date: parts[0]?.date ?? '', sources: [] };
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'sources' || v === undefined || v === null || Number.isNaN(v)) continue;
      const key = k as keyof FitnessDay;
      if (out[key] === undefined) (out as unknown as Record<string, unknown>)[key] = v;
    }
    for (const s of p.sources) if (!out.sources.includes(s)) out.sources.push(s);
  }
  return out;
}
