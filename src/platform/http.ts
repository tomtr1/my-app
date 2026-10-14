import { platform } from './platform';

export interface HttpOptions extends RequestInit {
  /** The endpoint sends permissive CORS headers, so the browser build may call it directly. */
  corsSafe?: boolean;
  timeoutMs?: number;
}

/**
 * One fetch for every platform.
 * - Windows (Tauri): requests go through Rust (reqwest) — no CORS, no browser limits.
 * - iOS (Capacitor): CapacitorHttp patches window.fetch to use native URLSession.
 * - Browser dev build: CORS-hostile URLs are routed through the Vite dev proxy.
 */
export async function httpFetch(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { corsSafe, timeoutMs = 20000, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const p = platform();
    if (p === 'tauri') {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      return await tauriFetch(url, { ...init, signal: ctrl.signal });
    }
    if (p === 'ios' || corsSafe) return await fetch(url, { ...init, signal: ctrl.signal });
    // Browser dev: forward headers with an x-fwd- prefix so the proxy can replay them.
    const headers = new Headers();
    new Headers(init.headers).forEach((v, k) => headers.set(`x-fwd-${k}`, v));
    return await fetch(`/__proxy?url=${encodeURIComponent(url)}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getJSON<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const r = await httpFetch(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers ?? {}) } });
  if (!r.ok) throw new HttpError(r.status, `${r.status} ${r.statusText} — ${new URL(url).host}`);
  return (await r.json()) as T;
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  const r = await httpFetch(url, opts);
  if (!r.ok) throw new HttpError(r.status, `${r.status} ${r.statusText} — ${new URL(url).host}`);
  return r.text();
}
