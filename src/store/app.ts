import { create } from 'zustand';
import { db } from '../platform/storage';
import { cancelNotices, scheduleNotices, type LocalNotice } from '../platform/notify';
import { migrateSettings, primaryPlace, type Settings } from './settings';
import { fetchWeather, type WeatherSnapshot } from '../services/weather';
import { fetchCalendars, eventsOn, type CalendarSnapshot } from '../services/calendar';
import { fetchNews, type Article, type NewsSnapshot } from '../services/news';
import { fetchFitness, readiness } from '../services/fitness';
import type { FitnessSnapshot } from '../services/fitness-types';
import { buildHints, prepFor, type EventPrep } from '../services/hints';
import { planNotifications } from '../services/planner';
import { computeGoals, sumMacros, type DiaryEntry } from '../services/nutrition';
import { geocodeAddress, travelMinutes } from '../lib/geo';
import { ymd } from '../lib/dates';

export type SourceKey = 'weather' | 'calendar' | 'news' | 'fitness';
export type TabKey = 'today' | 'fitness' | 'calendar' | 'whatsapp' | 'nutrition' | 'news' | 'weather' | 'apps' | 'settings';

export interface SourceStatus {
  loading: boolean;
  error?: string;
  updatedAt?: number;
}

/** Background refresh cadence (minutes). Fitness refreshes faster while its tab is open. */
export const REFRESH_MIN: Record<SourceKey, number> = { weather: 30, calendar: 15, news: 30, fitness: 15 };

interface AppState {
  ready: boolean;
  tab: TabKey;
  settings: Settings;
  weather: Record<string, WeatherSnapshot>;
  calendar: CalendarSnapshot | null;
  news: NewsSnapshot | null;
  fitness: FitnessSnapshot | null;
  prep: Record<string, EventPrep>;
  status: Record<SourceKey, SourceStatus>;
  readLater: Article[];
  diary: Record<string, DiaryEntry[]>;
  water: Record<string, number>;
  sheet: null | 'add-food' | 'quick-add';

  init(): Promise<void>;
  setTab(t: TabKey): void;
  setSheet(s: AppState['sheet']): void;
  updateSettings(fn: (s: Settings) => Settings): Promise<void>;
  refresh(src: SourceKey, force?: boolean): Promise<void>;
  refreshAll(force?: boolean): Promise<void>;
  toggleReadLater(a: Article): Promise<void>;
  loadDay(date: string): Promise<void>;
  addDiary(e: DiaryEntry): Promise<void>;
  removeDiary(date: string, id: string): Promise<void>;
  addWater(ml: number, date?: string): Promise<void>;
  replan(): Promise<void>;
}

const idle: SourceStatus = { loading: false };
const inflight = new Map<SourceKey, Promise<void>>();
let plannedIds: number[] = [];

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  tab: 'today',
  settings: migrateSettings(null),
  weather: {},
  calendar: null,
  news: null,
  fitness: null,
  prep: {},
  status: { weather: idle, calendar: idle, news: idle, fitness: idle },
  readLater: [],
  diary: {},
  water: {},
  sheet: null,

  async init() {
    const [settings, weather, calendar, news, fitness, prep, readLater] = await Promise.all([
      db.get<Settings>('settings'),
      db.get<Record<string, WeatherSnapshot>>('cache:weather'),
      db.get<CalendarSnapshot>('cache:calendar'),
      db.get<NewsSnapshot>('cache:news'),
      db.get<FitnessSnapshot>('cache:fitness'),
      db.get<Record<string, EventPrep>>('cache:prep'),
      db.get<Article[]>('readlater'),
    ]);
    const s = migrateSettings(settings);
    const status = { ...get().status };
    if (calendar) status.calendar = { loading: false, updatedAt: calendar.fetchedAt };
    if (news) status.news = { loading: false, updatedAt: news.fetchedAt };
    if (fitness) status.fitness = { loading: false, updatedAt: fitness.fetchedAt };
    const w = weather ?? {};
    const pw = primaryPlace(s);
    if (pw && w[pw.id]) status.weather = { loading: false, updatedAt: w[pw.id].fetchedAt };
    set({ settings: s, weather: w, calendar, news, fitness, prep: prep ?? {}, readLater: readLater ?? [], status, ready: true });
    await get().loadDay(ymd());
  },

  setTab(tab) {
    set({ tab });
  },
  setSheet(sheet) {
    set({ sheet });
  },

  async updateSettings(fn) {
    const settings = fn(get().settings);
    set({ settings });
    await db.set('settings', settings);
  },

  async refresh(src, force = false) {
    const st = get().status[src];
    if (!force && st.updatedAt && Date.now() - st.updatedAt < REFRESH_MIN[src] * 60_000) return;
    if (inflight.has(src)) return inflight.get(src);
    const job = (async () => {
      set((s) => ({ status: { ...s.status, [src]: { ...s.status[src], loading: true, error: undefined } } }));
      try {
        const s = get().settings;
        if (src === 'weather') {
          const places = s.places;
          if (!places.length) throw new Error('Add a location in Settings');
          const snaps = await Promise.all(places.map((p) => fetchWeather(p)));
          const weather = Object.fromEntries(snaps.map((w) => [w.placeId, w]));
          set({ weather });
          await db.set('cache:weather', weather);
        } else if (src === 'calendar') {
          const cal = await fetchCalendars(s.calendars, s.useDeviceCalendars);
          set({ calendar: cal });
          await db.set('cache:calendar', cal);
          if (cal.errors.length && !cal.events.length) throw new Error(cal.errors[0]);
        } else if (src === 'news') {
          const news = await fetchNews(s.news);
          set({ news });
          await db.set('cache:news', news);
          if (!news.articles.length && news.errors.length) throw new Error(news.errors[0]);
        } else if (src === 'fitness') {
          const fit = await fetchFitness(s.fitness);
          // Keep older days we already had (sources only return a window).
          const prev = get().fitness?.days ?? {};
          const merged = { ...fit, days: { ...prev, ...fit.days } };
          set({ fitness: merged });
          await db.set('cache:fitness', merged);
          if (fit.errors.length && !Object.keys(fit.days).length) throw new Error(fit.errors[0]);
        }
        set((x) => ({ status: { ...x.status, [src]: { loading: false, updatedAt: Date.now() } } }));
        if (src === 'calendar' || src === 'weather') await computePrep();
        await get().replan();
      } catch (e) {
        set((x) => ({ status: { ...x.status, [src]: { ...x.status[src], loading: false, error: (e as Error).message } } }));
      } finally {
        inflight.delete(src);
      }
    })();
    inflight.set(src, job);
    return job;
  },

  async refreshAll(force = false) {
    await Promise.all((['weather', 'calendar', 'fitness', 'news'] as SourceKey[]).map((k) => get().refresh(k, force)));
  },

  async toggleReadLater(a) {
    const list = get().readLater;
    const next = list.some((x) => x.id === a.id) ? list.filter((x) => x.id !== a.id) : [a, ...list];
    set({ readLater: next });
    await db.set('readlater', next);
  },

  async loadDay(date) {
    const [entries, water] = await Promise.all([db.get<DiaryEntry[]>(`diary:${date}`), db.get<number>(`water:${date}`)]);
    set((s) => ({ diary: { ...s.diary, [date]: entries ?? [] }, water: { ...s.water, [date]: water ?? 0 } }));
  },

  async addDiary(e) {
    const date = ymd(new Date(e.time));
    const list = [...(get().diary[date] ?? []), e].sort((a, b) => a.time - b.time);
    set((s) => ({ diary: { ...s.diary, [date]: list } }));
    await db.set(`diary:${date}`, list);
  },

  async removeDiary(date, id) {
    const list = (get().diary[date] ?? []).filter((x) => x.id !== id);
    set((s) => ({ diary: { ...s.diary, [date]: list } }));
    await db.set(`diary:${date}`, list);
  },

  async addWater(ml, date = ymd()) {
    const v = Math.max(0, (get().water[date] ?? 0) + ml);
    set((s) => ({ water: { ...s.water, [date]: v } }));
    await db.set(`water:${date}`, v);
  },

  async replan() {
    const st = get();
    const notices: LocalNotice[] = planNotifications(st.settings, {
      now: new Date(),
      weather: selectPrimaryWeather(st),
      events: st.calendar?.events ?? [],
      prep: st.prep,
      readiness: selectReadiness(st),
      hints: selectHints(st),
    });
    const ids = notices.map((n) => n.id);
    await cancelNotices(plannedIds.filter((id) => !ids.includes(id))).catch(() => undefined);
    plannedIds = ids;
    await scheduleNotices(notices).catch(() => undefined);
  },
}));

/** Geocodes today's/tomorrow's event locations, then travel time + weather at the venue. */
async function computePrep() {
  const st = useApp.getState();
  const home = primaryPlace(st.settings);
  const homeWeather = selectPrimaryWeather(st);
  const horizon = Date.now() + 36 * 3_600_000;
  const events = (st.calendar?.events ?? []).filter((e) => !e.allDay && e.end > Date.now() && e.start < horizon);
  const prep: Record<string, EventPrep> = {};
  for (const e of events) {
    let travel: number | null | undefined;
    if (e.location && home && !/zoom|teams|meet\.google|webex|http/i.test(e.location)) {
      const geo = await geocodeAddress(e.location).catch(() => null);
      if (geo) travel = await travelMinutes(home, geo);
    }
    prep[e.id] = prepFor(e, { travelMin: travel, homeWeather });
  }
  useApp.setState({ prep });
  await db.set('cache:prep', prep);
}

// ---- selectors --------------------------------------------------------------------------

export function selectPrimaryWeather(s: Pick<AppState, 'settings' | 'weather'>): WeatherSnapshot | null {
  const p = primaryPlace(s.settings);
  return p ? (s.weather[p.id] ?? null) : null;
}

export function selectReadiness(s: Pick<AppState, 'fitness' | 'settings'>) {
  return s.fitness ? readiness(s.fitness, s.settings.fitness.sleepGoalMin) : null;
}

export function selectHints(s: AppState) {
  const date = ymd();
  const goals = computeGoals(s.settings.nutrition);
  return buildHints({
    now: new Date(),
    weather: selectPrimaryWeather(s),
    events: eventsOn(s.calendar?.events ?? [], new Date()),
    prep: s.prep,
    readiness: selectReadiness(s),
    today: s.fitness?.days[date],
    sleepGoalMin: s.settings.fitness.sleepGoalMin,
    kcalEaten: sumMacros(s.diary[date] ?? []).kcal,
    kcalGoal: goals.kcal,
    waterMl: s.water[date],
    waterGoalMl: goals.waterMl,
  });
}
