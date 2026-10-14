import type { Place } from '../lib/geo';
import type { MiniAppDef } from '../platform/miniapp';

export type Theme = 'dark' | 'light' | 'system';

export interface CalendarFeed {
  id: string;
  name: string;
  /** Secret iCal address (Google "Secret address in iCal format", Outlook "Publish calendar → ICS", iCloud public link). */
  url: string;
  color: string;
  enabled: boolean;
}

export interface NewsFeed {
  id: string;
  title: string;
  url: string;
  topic: string;
  enabled: boolean;
}

export type FoodProvider = 'none' | 'openai-compatible';

export interface Settings {
  version: 1;
  onboarded: boolean;
  name: string;
  theme: Theme;
  places: Place[];
  primaryPlaceId: string | null;
  calendars: CalendarFeed[];
  useDeviceCalendars: boolean;
  news: {
    interests: string[];
    keywords: string[];
    region: string;
    language: 'en' | 'de';
    feeds: NewsFeed[];
    importantOnly: boolean;
    useGNews: boolean;
  };
  fitness: {
    garmin: boolean;
    whoop: boolean;
    appleHealth: boolean;
    stepGoal: number;
    sleepGoalMin: number;
  };
  nutrition: {
    sex: 'male' | 'female';
    age: number;
    heightCm: number;
    weightKg: number;
    activity: 1.2 | 1.375 | 1.55 | 1.725 | 1.9;
    goal: 'lose' | 'maintain' | 'gain';
    kcalOverride: number | null;
    waterGoalMl: number;
    provider: FoodProvider;
    /** e.g. https://api.openai.com/v1, https://generativelanguage.googleapis.com/v1beta/openai, http://localhost:11434/v1 (Ollama, fully local) */
    endpoint: string;
    model: string;
  };
  notifications: {
    morningSummary: boolean;
    morningTime: string; // HH:MM
    eventReminders: boolean;
    leadMinutes: number;
  };
  miniapps: MiniAppDef[];
}

export const NEWS_TOPICS = ['world', 'tech', 'ai', 'science', 'finance', 'sports', 'local'] as const;

export const PRESET_FEEDS: Omit<NewsFeed, 'id' | 'enabled'>[] = [
  { title: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', topic: 'world' },
  { title: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', topic: 'world' },
  { title: 'tagesschau', url: 'https://www.tagesschau.de/index~rss2.xml', topic: 'world' },
  { title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', topic: 'tech' },
  { title: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', topic: 'tech' },
  { title: 'heise online', url: 'https://www.heise.de/rss/heise-atom.xml', topic: 'tech' },
  { title: 'MIT Tech Review — AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', topic: 'ai' },
  { title: 'The Verge — AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', topic: 'ai' },
  { title: 'Nature', url: 'https://www.nature.com/nature.rss', topic: 'science' },
  { title: 'CNBC Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', topic: 'finance' },
  { title: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', topic: 'sports' },
  { title: 'kicker', url: 'https://newsfeed.kicker.de/news/aktuell', topic: 'sports' },
];

export const PRESET_MINIAPPS: MiniAppDef[] = [
  { id: 'whatsapp', title: 'WhatsApp', url: 'https://web.whatsapp.com/', desktopUA: true },
  { id: 'gmail', title: 'Gmail', url: 'https://mail.google.com/mail/u/0/' },
  { id: 'outlook', title: 'Outlook', url: 'https://outlook.live.com/mail/' },
  { id: 'notion', title: 'Notion', url: 'https://www.notion.so/' },
];

export function defaultSettings(): Settings {
  return {
    version: 1,
    onboarded: false,
    name: '',
    theme: 'dark',
    places: [],
    primaryPlaceId: null,
    calendars: [],
    useDeviceCalendars: true,
    news: {
      interests: ['world', 'tech', 'ai'],
      keywords: [],
      region: '',
      language: 'en',
      feeds: PRESET_FEEDS.map((f, i) => ({ ...f, id: `preset-${i}`, enabled: ['world', 'tech', 'ai'].includes(f.topic) && f.title !== 'tagesschau' && f.title !== 'heise online' })),
      importantOnly: false,
      useGNews: false,
    },
    fitness: { garmin: false, whoop: false, appleHealth: true, stepGoal: 10000, sleepGoalMin: 480 },
    nutrition: {
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 78,
      activity: 1.55,
      goal: 'maintain',
      kcalOverride: null,
      waterGoalMl: 2500,
      provider: 'none',
      endpoint: 'https://api.openai.com/v1',
      model: '',
    },
    notifications: { morningSummary: true, morningTime: '07:00', eventReminders: true, leadMinutes: 30 },
    miniapps: PRESET_MINIAPPS,
  };
}

/** Fills in fields added in later versions. */
export function migrateSettings(s: Partial<Settings> | null): Settings {
  const d = defaultSettings();
  if (!s) return d;
  return {
    ...d,
    ...s,
    news: { ...d.news, ...s.news },
    fitness: { ...d.fitness, ...s.fitness },
    nutrition: { ...d.nutrition, ...s.nutrition },
    notifications: { ...d.notifications, ...s.notifications },
  } as Settings;
}

export function primaryPlace(s: Settings): Place | null {
  return s.places.find((p) => p.id === s.primaryPlaceId) ?? s.places[0] ?? null;
}
