import { describe, expect, it } from 'vitest';
import { computeGoals, parseRecognition, scale, sumMacros } from '../services/nutrition';
import { defaultSettings } from '../store/settings';
import { planNotifications, MORNING_ID } from '../services/planner';
import { parseUnread } from '../store/unread';

describe('nutrition', () => {
  it('computes Mifflin–St Jeor based goals', () => {
    const n = { ...defaultSettings().nutrition, sex: 'male' as const, age: 30, heightCm: 180, weightKg: 80, activity: 1.55 as const, goal: 'lose' as const };
    const g = computeGoals(n);
    // BMR = 800 + 1125 - 150 + 5 = 1780 → ×1.55 = 2759 → −500
    expect(g.kcal).toBe(2259);
    expect(g.protein).toBe(152);
    expect(g.protein * 4 + g.carbs * 4 + g.fat * 9).toBeGreaterThan(g.kcal - 10);
  });

  it('scales per-100 g values', () => {
    expect(scale({ kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 }, 120)).toEqual({ kcal: 107, protein: 1.3, carbs: 27.6, fat: 0.4 });
    expect(sumMacros([{ kcal: 1, protein: 1, carbs: 1, fat: 1 }, { kcal: 2, protein: 2, carbs: 2, fat: 2 }]).kcal).toBe(3);
  });

  it('parses model output defensively', () => {
    const items = parseRecognition('Sure! ```json\n{"items":[{"name":"Pasta","grams":"250","kcal_per_100g":158,"protein_per_100g":5.8,"carbs_per_100g":31,"fat_per_100g":0.9,"confidence":0.9},{"name":"Air","grams":10,"kcal_per_100g":0}]}\n```');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Pasta', grams: 250, confidence: 0.9 });
  });
});

describe('planner', () => {
  it('schedules tomorrow’s briefing after today’s time has passed, and travel-aware reminders', () => {
    const s = defaultSettings();
    s.notifications.morningTime = '07:00';
    const now = new Date(2026, 9, 14, 9, 0);
    const start = new Date(2026, 9, 14, 14, 0).getTime();
    const n = planNotifications(s, {
      now,
      events: [{ id: 'e', title: 'Dentist', start, end: start + 3_600_000, allDay: false, calendar: 'x', color: '' }],
      prep: { e: { eventId: 'e', travelMin: 20, bring: ['Insurance card'], online: false } },
    });
    const morning = n.find((x) => x.id === MORNING_ID)!;
    expect(morning.at!.getDate()).toBe(15);
    const rem = n.find((x) => x.title === 'Dentist')!;
    expect(rem.at!.getTime()).toBe(start - 50 * 60_000);
    expect(rem.body).toContain('Leave now — 20 min travel');
    expect(rem.body).toContain('Bring: Insurance card');
  });
});

describe('unread parsing', () => {
  it('reads counts from page titles', () => {
    expect(parseUnread('(3) WhatsApp')).toBe(3);
    expect(parseUnread('Inbox (12) - me@gmail.com - Gmail')).toBe(12);
    expect(parseUnread('WhatsApp')).toBe(0);
  });
});
