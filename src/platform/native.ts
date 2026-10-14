import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Bindings for the app's own Swift plugin (ios/App/App/LifeNativePlugin.swift).
 * One small first-party plugin instead of several third-party ones keeps the
 * HealthKit / EventKit / WKWebView surface auditable.
 */
export interface HealthDay {
  date: string; // YYYY-MM-DD
  steps?: number;
  activeKcal?: number;
  restingHr?: number;
  hrvMs?: number;
  spo2?: number;
  vo2max?: number;
  sleepMinutes?: number;
  sleepDeepMinutes?: number;
  sleepRemMinutes?: number;
  sleepStart?: string;
  sleepEnd?: string;
}

export interface HealthSample {
  t: string; // ISO timestamp
  v: number;
}

export interface HealthWorkout {
  id: string;
  type: string;
  start: string;
  end: string;
  kcal?: number;
  distanceM?: number;
  source: string;
}

export interface NativeCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  calendar: string;
  color?: string;
}

export interface LifeNativePlugin {
  healthAuthorize(): Promise<{ granted: boolean }>;
  healthDays(opts: { start: string; end: string }): Promise<{ days: HealthDay[] }>;
  healthHeartRate(opts: { start: string; end: string }): Promise<{ samples: HealthSample[] }>;
  healthWorkouts(opts: { start: string; end: string }): Promise<{ workouts: HealthWorkout[] }>;
  calendarAuthorize(): Promise<{ granted: boolean }>;
  calendarEvents(opts: { start: string; end: string }): Promise<{ events: NativeCalendarEvent[] }>;
  openMiniApp(opts: { id: string; url: string; title: string; userAgent?: string }): Promise<void>;
  clearMiniApp(opts: { id: string }): Promise<void>;
  addListener(event: 'miniAppTitle', cb: (e: { id: string; title: string }) => void): Promise<PluginListenerHandle>;
}

export const LifeNative = registerPlugin<LifeNativePlugin>('LifeNative');
