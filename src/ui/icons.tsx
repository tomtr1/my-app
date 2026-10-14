import {
  AlertTriangle, Activity, Apple, Bolt, CalendarDays, Car, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun,
  Droplets, Heart, LayoutDashboard, LayoutGrid, Moon, Newspaper, Settings, Shirt, ShoppingBag, Snowflake, Sun, Umbrella, Utensils, MessageCircle,
} from 'lucide-react';
import type { TabKey } from '../store/app';
import type { Hint } from '../services/hints';

export const TAB_META: Record<TabKey, { label: string; Icon: typeof Activity }> = {
  today: { label: 'Today', Icon: LayoutDashboard },
  fitness: { label: 'Fitness', Icon: Activity },
  calendar: { label: 'Calendar', Icon: CalendarDays },
  whatsapp: { label: 'WhatsApp', Icon: MessageCircle },
  nutrition: { label: 'Nutrition', Icon: Apple },
  news: { label: 'News', Icon: Newspaper },
  weather: { label: 'Weather', Icon: CloudSun },
  apps: { label: 'Apps & Mail', Icon: LayoutGrid },
  settings: { label: 'Settings', Icon: Settings },
};

export function WeatherIcon({ code, size = 18, isDay = true }: { code: number; size?: number; isDay?: boolean }) {
  const p = { width: size, height: size };
  if (code === 0 || code === 1) return isDay ? <Sun {...p} color="var(--warn)" /> : <Moon {...p} color="var(--violet)" />;
  if (code === 2) return <CloudSun {...p} color="var(--text-2)" />;
  if (code === 3) return <Cloud {...p} color="var(--text-2)" />;
  if (code === 45 || code === 48) return <CloudFog {...p} color="var(--text-2)" />;
  if (code >= 51 && code <= 57) return <CloudDrizzle {...p} color="var(--blue)" />;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain {...p} color="var(--blue)" />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow {...p} color="var(--teal)" />;
  if (code >= 95) return <CloudLightning {...p} color="var(--warn)" />;
  return <Cloud {...p} />;
}

export function HintIcon({ icon }: { icon: Hint['icon'] }) {
  const map: Record<Hint['icon'], typeof Activity> = {
    umbrella: Umbrella, jacket: Shirt, sun: Sun, snow: Snowflake, heart: Heart, moon: Moon, bolt: Bolt, car: Car,
    bag: ShoppingBag, water: Droplets, calendar: CalendarDays, alert: AlertTriangle, food: Utensils,
  };
  const I = map[icon];
  return <I />;
}
