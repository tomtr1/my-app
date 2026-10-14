import { getJSON } from '../platform/http';
import { db } from '../platform/storage';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'home' | 'work' | 'other';
  country?: string;
}

export interface GeoResult {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  admin?: string;
}

/** City search — Open-Meteo geocoding (keyless). */
export async function searchCity(q: string): Promise<GeoResult[]> {
  if (q.trim().length < 2) return [];
  const r = await getJSON<{ results?: Array<{ name: string; latitude: number; longitude: number; country_code?: string; admin1?: string }> }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&format=json`,
    { corsSafe: true },
  );
  return (r.results ?? []).map((x) => ({ name: x.name, lat: x.latitude, lon: x.longitude, country: x.country_code, admin: x.admin1 }));
}

/** Free-text address → coordinates (event locations). Nominatim, cached forever, ≤1 req/s. */
let lastNominatim = 0;
export async function geocodeAddress(q: string): Promise<GeoResult | null> {
  const key = `geo:${q.trim().toLowerCase()}`;
  const cached = await db.get<GeoResult | { miss: true }>(key);
  if (cached) return 'miss' in cached ? null : cached;
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const r = await getJSON<Array<{ lat: string; lon: string; display_name: string }>>(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
    { corsSafe: true, headers: { 'User-Agent': 'Lifedash/0.1 (personal dashboard)' } },
  );
  const hit = r[0] ? { name: r[0].display_name, lat: Number(r[0].lat), lon: Number(r[0].lon) } : null;
  await db.set(key, hit ?? { miss: true });
  return hit;
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Driving time in minutes via the public OSRM router (keyless). */
export async function travelMinutes(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<number | null> {
  if (haversineKm(from, to) < 0.3) return 0;
  try {
    const r = await getJSON<{ routes?: Array<{ duration: number }> }>(
      `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
      { corsSafe: true },
    );
    const s = r.routes?.[0]?.duration;
    return s === undefined ? null : Math.round(s / 60);
  } catch {
    return null;
  }
}

/** Device location (used once to suggest "home"). */
export function currentPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 600_000 },
    );
  });
}
