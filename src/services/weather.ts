import { getJSON } from '../platform/http';

export interface WeatherNow {
  temp: number;
  feels: number;
  humidity: number;
  precip: number;
  code: number;
  wind: number;
  gusts: number;
  isDay: boolean;
}

export interface WeatherHour {
  time: string; // local ISO without tz
  temp: number;
  pop: number; // precipitation probability %
  precip: number; // mm
  code: number;
  wind: number;
  uv: number;
}

export interface WeatherDay {
  date: string;
  code: number;
  max: number;
  min: number;
  pop: number;
  precip: number;
  sunrise: string;
  sunset: string;
  uv: number;
  wind: number;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  onset: string;
  expires: string;
}

export interface WeatherSnapshot {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  now: WeatherNow;
  hours: WeatherHour[];
  days: WeatherDay[];
  alerts: WeatherAlert[];
  fetchedAt: number;
}

interface OMResponse {
  current: Record<string, number>;
  hourly: Record<string, Array<number | string>>;
  daily: Record<string, Array<number | string>>;
}

export async function fetchForecast(lat: number, lon: number, days = 7): Promise<Omit<WeatherSnapshot, 'placeId' | 'placeName' | 'alerts'>> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: String(days),
  });
  const r = await getJSON<OMResponse>(`https://api.open-meteo.com/v1/forecast?${q}`, { corsSafe: true });
  const c = r.current;
  const h = r.hourly;
  const d = r.daily;
  return {
    lat,
    lon,
    now: {
      temp: c.temperature_2m,
      feels: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      precip: c.precipitation,
      code: c.weather_code,
      wind: c.wind_speed_10m,
      gusts: c.wind_gusts_10m,
      isDay: c.is_day === 1,
    },
    hours: (h.time as string[]).map((time, i) => ({
      time,
      temp: h.temperature_2m[i] as number,
      pop: (h.precipitation_probability[i] as number) ?? 0,
      precip: (h.precipitation[i] as number) ?? 0,
      code: h.weather_code[i] as number,
      wind: h.wind_speed_10m[i] as number,
      uv: (h.uv_index[i] as number) ?? 0,
    })),
    days: (d.time as string[]).map((date, i) => ({
      date,
      code: d.weather_code[i] as number,
      max: d.temperature_2m_max[i] as number,
      min: d.temperature_2m_min[i] as number,
      pop: (d.precipitation_probability_max[i] as number) ?? 0,
      precip: (d.precipitation_sum[i] as number) ?? 0,
      sunrise: d.sunrise[i] as string,
      sunset: d.sunset[i] as string,
      uv: (d.uv_index_max[i] as number) ?? 0,
      wind: d.wind_speed_10m_max[i] as number,
    })),
    fetchedAt: Date.now(),
  };
}

/**
 * Official severe-weather warnings. Germany: DWD via Bright Sky (keyless).
 * Outside Germany the endpoint returns nothing and we show none.
 */
export async function fetchAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  try {
    const r = await getJSON<{
      alerts?: Array<{ id: number; event_en: string; headline_en: string; description_en: string; severity: WeatherAlert['severity']; onset: string; expires: string }>;
    }>(`https://api.brightsky.dev/alerts?lat=${lat}&lon=${lon}`, { corsSafe: true });
    return (r.alerts ?? []).map((a) => ({
      id: String(a.id),
      event: a.event_en,
      headline: a.headline_en,
      description: a.description_en,
      severity: a.severity,
      onset: a.onset,
      expires: a.expires,
    }));
  } catch {
    return [];
  }
}

export async function fetchWeather(place: { id: string; name: string; lat: number; lon: number }): Promise<WeatherSnapshot> {
  const [f, alerts] = await Promise.all([fetchForecast(place.lat, place.lon), fetchAlerts(place.lat, place.lon)]);
  return { ...f, placeId: place.id, placeName: place.name, alerts };
}

/** Hourly forecast entry closest to a given time (for "weather at the event"). */
export function hourAt(hours: WeatherHour[], at: Date): WeatherHour | undefined {
  const t = at.getTime();
  let best: WeatherHour | undefined;
  let bestDiff = Infinity;
  for (const h of hours) {
    const diff = Math.abs(new Date(h.time).getTime() - t);
    if (diff < bestDiff) {
      best = h;
      bestDiff = diff;
    }
  }
  return bestDiff <= 90 * 60_000 ? best : undefined;
}

// WMO weather interpretation codes → label + icon key
const WMO: Record<number, [string, string]> = {
  0: ['Clear', 'sun'],
  1: ['Mostly clear', 'sun'],
  2: ['Partly cloudy', 'cloud-sun'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm, hail', 'storm'],
  99: ['Thunderstorm, hail', 'storm'],
};

export function wmo(code: number): { label: string; icon: string } {
  const [label, icon] = WMO[code] ?? ['—', 'cloud'];
  return { label, icon };
}

export function isWet(code: number): boolean {
  return code >= 51;
}

/** RainViewer radar frames (keyless, free tier: past ~2h, max zoom 7). */
export async function fetchRadarFrames(): Promise<{ host: string; frames: Array<{ time: number; path: string }> }> {
  const r = await getJSON<{ host: string; radar: { past: Array<{ time: number; path: string }>; nowcast?: Array<{ time: number; path: string }> } }>(
    'https://api.rainviewer.com/public/weather-maps.json',
    { corsSafe: true },
  );
  return { host: r.host, frames: [...r.radar.past, ...(r.radar.nowcast ?? [])] };
}

/** Whether a local forecast time is between that day's sunrise and sunset. */
export function isDaylight(time: string, days: WeatherDay[]): boolean {
  const d = days.find((x) => time.startsWith(x.date));
  if (!d?.sunrise) {
    const h = new Date(time).getHours();
    return h >= 7 && h < 19;
  }
  return time >= d.sunrise && time < d.sunset;
}
