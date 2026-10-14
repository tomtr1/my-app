export const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function ymd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

export function lastNDays(n: number, end: Date = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => ymd(addDays(end, i - n + 1)));
}

const loc = () => (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

export function fmtTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(d: Date | string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(d).toLocaleDateString(loc(), opts);
}

export function fmtWeekday(d: Date | string): string {
  return new Date(d).toLocaleDateString(loc(), { weekday: 'short' });
}

export function fmtLongDate(d: Date = new Date()): string {
  return d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtDuration(min: number): string {
  if (!Number.isFinite(min)) return '–';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function relTime(d: Date | string | number, now = Date.now()): string {
  const diff = (new Date(d).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** "07:30" → Date today at that time */
export function atTime(hhmm: string, base: Date = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}
