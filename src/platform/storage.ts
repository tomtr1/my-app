import { platform } from './platform';
import { getMasterKey } from './secure';
import { open, seal } from './crypto';

/**
 * Local-first encrypted key/value store.
 *
 * Every value is AES-256-GCM encrypted *before* it reaches the backend, so the
 * backend only ever sees ciphertext:
 * - Windows (Tauri):   SQLite file in %APPDATA% via tauri-plugin-sql
 * - iOS (Capacitor):   SQLite in the app sandbox via @capacitor-community/sqlite
 *                      (+ iOS Data Protection on the file)
 * - Browser dev build: IndexedDB
 */
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  clear(): Promise<void>;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL, updated INTEGER NOT NULL)';

function like(prefix: string) {
  return prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + '%';
}

async function tauriBackend(): Promise<KvBackend> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load('sqlite:lifedash.db');
  await db.execute(SCHEMA);
  return {
    async get(k) {
      const rows = await db.select<{ v: string }[]>('SELECT v FROM kv WHERE k = $1', [k]);
      return rows[0]?.v ?? null;
    },
    async set(k, v) {
      await db.execute('INSERT OR REPLACE INTO kv (k, v, updated) VALUES ($1, $2, $3)', [k, v, Date.now()]);
    },
    async del(k) {
      await db.execute('DELETE FROM kv WHERE k = $1', [k]);
    },
    async keys(prefix) {
      const rows = await db.select<{ k: string }[]>("SELECT k FROM kv WHERE k LIKE $1 ESCAPE '\\'", [like(prefix)]);
      return rows.map((r) => r.k);
    },
    async clear() {
      await db.execute('DELETE FROM kv');
    },
  };
}

async function iosBackend(): Promise<KvBackend> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection('lifedash', false, 'no-encryption', 1, false);
  await db.open();
  await db.execute(SCHEMA);
  return {
    async get(k) {
      const r = await db.query('SELECT v FROM kv WHERE k = ?', [k]);
      return (r.values?.[0]?.v as string | undefined) ?? null;
    },
    async set(k, v) {
      await db.run('INSERT OR REPLACE INTO kv (k, v, updated) VALUES (?, ?, ?)', [k, v, Date.now()]);
    },
    async del(k) {
      await db.run('DELETE FROM kv WHERE k = ?', [k]);
    },
    async keys(prefix) {
      const r = await db.query("SELECT k FROM kv WHERE k LIKE ? ESCAPE '\\'", [like(prefix)]);
      return (r.values ?? []).map((row) => row.k as string);
    },
    async clear() {
      await db.run('DELETE FROM kv');
    },
  };
}

export function idbBackend(name = 'lifedash-data'): KvBackend {
  const dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    dbp.then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const r = fn(db.transaction('kv', mode).objectStore('kv'));
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        }),
    );
  return {
    get: async (k) => ((await run('readonly', (s) => s.get(k))) as string | undefined) ?? null,
    set: async (k, v) => void (await run('readwrite', (s) => s.put(v, k))),
    del: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    keys: async (prefix) =>
      ((await run('readonly', (s) => s.getAllKeys())) as string[]).filter((k) => k.startsWith(prefix)),
    clear: async () => void (await run('readwrite', (s) => s.clear())),
  };
}

let backend: Promise<KvBackend> | null = null;

function getBackend(): Promise<KvBackend> {
  backend ??= (async () => {
    switch (platform()) {
      case 'tauri':
        return tauriBackend();
      case 'ios':
        return iosBackend();
      default:
        return idbBackend();
    }
  })();
  return backend;
}

/** Test hook: inject a backend */
export function _setBackend(b: KvBackend) {
  backend = Promise.resolve(b);
}

export const db = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await (await getBackend()).get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(await open(await getMasterKey(), raw)) as T;
    } catch {
      return null; // unreadable (e.g. key rotated) — treat as missing
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    const sealed = await seal(await getMasterKey(), JSON.stringify(value));
    await (await getBackend()).set(key, sealed);
  },
  async del(key: string): Promise<void> {
    await (await getBackend()).del(key);
  },
  async keys(prefix: string): Promise<string[]> {
    return (await getBackend()).keys(prefix);
  },
  async getMany<T>(prefix: string): Promise<Array<[string, T]>> {
    const keys = await this.keys(prefix);
    const out: Array<[string, T]> = [];
    for (const k of keys) {
      const v = await this.get<T>(k);
      if (v !== null) out.push([k, v]);
    }
    return out;
  },
  /** Wipes all local data (Settings → Privacy → Delete all data). */
  async wipe(): Promise<void> {
    await (await getBackend()).clear();
  },
};
