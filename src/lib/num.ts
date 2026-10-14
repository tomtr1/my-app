export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fmtInt(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '–';
  return Math.round(n).toLocaleString();
}

export function mean(xs: number[]): number | undefined {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? clamp((part / whole) * 100, 0, 100) : 0;
}

export function uid(): string {
  return crypto.randomUUID();
}

/** Stable small int hash — used for notification ids. */
export function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2_000_000_000;
}
