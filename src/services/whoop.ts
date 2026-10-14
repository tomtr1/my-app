import { getJSONSecret, getSecret, setJSONSecret, setSecret } from '../platform/secure';
import { httpFetch } from '../platform/http';
import { authorizeInBrowser, randomState, redirectUri } from '../platform/oauth';
import { ymd } from '../lib/dates';
import type { Activity, FitnessDay } from './fitness-types';

/**
 * WHOOP Developer API v2 (official, OAuth 2.0). Create a free app at
 * developer-dashboard.whoop.com and paste its Client ID/Secret in Settings.
 */
const AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

interface Tokens {
  access: string;
  refresh?: string;
  expires: number;
}

async function creds() {
  const id = await getSecret('whoop-client-id');
  const secret = await getSecret('whoop-client-secret');
  if (!id || !secret) throw new Error('WHOOP client ID/secret missing (Settings → Fitness)');
  return { id, secret };
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await httpFetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!r.ok) throw new Error(`WHOOP token error ${r.status}`);
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const t: Tokens = { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  await setJSONSecret('whoop-tokens', t);
  return t;
}

export const whoop = {
  async connected(): Promise<boolean> {
    return !!(await getJSONSecret<Tokens>('whoop-tokens'));
  },

  async connect(): Promise<void> {
    const { id, secret } = await creds();
    const state = randomState();
    const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirectUri(), scope: SCOPES, state });
    const cb = await authorizeInBrowser(`${AUTH}?${q}`, state);
    await tokenRequest({
      grant_type: 'authorization_code',
      code: cb.searchParams.get('code') ?? '',
      redirect_uri: redirectUri(),
      client_id: id,
      client_secret: secret,
    });
  },

  async disconnect(): Promise<void> {
    await setSecret('whoop-tokens', null);
  },

  async token(): Promise<string> {
    const t = await getJSONSecret<Tokens>('whoop-tokens');
    if (!t) throw new Error('WHOOP not connected');
    if (t.expires > Date.now()) return t.access;
    if (!t.refresh) throw new Error('WHOOP session expired — reconnect');
    const { id, secret } = await creds();
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: id, client_secret: secret, scope: 'offline' })).access;
  },

  async get<T>(path: string): Promise<T> {
    const r = await httpFetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (r.status === 429) throw new Error('WHOOP rate limit — will retry later');
    if (!r.ok) throw new Error(`WHOOP ${r.status} on ${path}`);
    return (await r.json()) as T;
  },
};

interface Page<T> {
  records: T[];
}
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Maps a WHOOP physiological cycle (+ its recovery and sleep) to the calendar day it ends on. */
export async function fetchWhoop(days: number): Promise<{ days: Partial<FitnessDay>[]; activities: Activity[] }> {
  const start = new Date(Date.now() - days * 86_400_000).toISOString();
  const q = `?limit=25&start=${encodeURIComponent(start)}`;
  const [cycles, recoveries, sleeps, workouts] = await Promise.all([
    whoop.get<Page<Rec>>(`/cycle${q}`),
    whoop.get<Page<Rec>>(`/recovery${q}`),
    whoop.get<Page<Rec>>(`/activity/sleep${q}`),
    whoop.get<Page<Rec>>(`/activity/workout${q}`),
  ]);
  const byDay = new Map<string, Partial<FitnessDay>>();
  const day = (iso: string) => {
    const d = ymd(new Date(iso));
    if (!byDay.has(d)) byDay.set(d, { date: d });
    return byDay.get(d)!;
  };
  const cycleDay = new Map<number, string>();
  for (const c of cycles.records) {
    // A cycle starts when you wake; attribute it to that day.
    const d = day(c.start);
    cycleDay.set(c.id, d.date!);
    if (c.score_state === 'SCORED') {
      d.strain = c.score?.strain;
      d.totalKcal = c.score?.kilojoule !== undefined ? c.score.kilojoule / 4.184 : undefined;
    }
  }
  for (const r of recoveries.records) {
    if (r.score_state !== 'SCORED') continue;
    const date = cycleDay.get(r.cycle_id) ?? ymd(new Date(r.created_at));
    const d = byDay.get(date) ?? day(r.created_at);
    d.recovery = r.score?.recovery_score;
    d.hrvMs = r.score?.hrv_rmssd_milli;
    d.restingHr = r.score?.resting_heart_rate;
    d.spo2 = r.score?.spo2_percentage;
  }
  for (const s of sleeps.records) {
    if (s.nap || s.score_state !== 'SCORED') continue;
    const d = day(s.end);
    const st = s.score?.stage_summary ?? {};
    const inBed = st.total_in_bed_time_milli ?? 0;
    const awake = st.total_awake_time_milli ?? 0;
    d.sleepMin = (inBed - awake) / 60000;
    d.sleepDeepMin = (st.total_slow_wave_sleep_time_milli ?? 0) / 60000;
    d.sleepRemMin = (st.total_rem_sleep_time_milli ?? 0) / 60000;
    d.sleepLightMin = (st.total_light_sleep_time_milli ?? 0) / 60000;
    d.sleepAwakeMin = awake / 60000;
    d.sleepScore = s.score?.sleep_performance_percentage;
    d.sleepStart = Date.parse(s.start);
    d.sleepEnd = Date.parse(s.end);
    d.respiration = s.score?.respiratory_rate;
  }
  const activities: Activity[] = workouts.records.map((w) => ({
    id: `whoop:${w.id}`,
    name: w.sport_name ?? 'Workout',
    type: w.sport_name ?? 'workout',
    start: Date.parse(w.start),
    durationMin: (Date.parse(w.end) - Date.parse(w.start)) / 60000,
    distanceM: w.score?.distance_meter,
    kcal: w.score?.kilojoule !== undefined ? w.score.kilojoule / 4.184 : undefined,
    avgHr: w.score?.average_heart_rate,
    strain: w.score?.strain,
    source: 'whoop',
  }));
  return { days: [...byDay.values()], activities };
}
