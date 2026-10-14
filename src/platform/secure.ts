import { platform } from './platform';
import { fromB64, generateAesKey, importAesKey, randomBytes, toB64 } from './crypto';

/**
 * Secrets (API keys, OAuth tokens, the data-encryption key) live in the OS keystore:
 * - Windows: Credential Manager via the Rust `keyring` crate
 * - iOS: Keychain (after-first-unlock, this-device-only — readable by background refresh)
 * - Browser dev build: IndexedDB (dev only — not a secure store)
 */

const SERVICE = 'lifedash';

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function iosStore() {
  const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage');
  await SecureStorage.setKeyPrefix(`${SERVICE}.`);
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
  return SecureStorage;
}

// ---- tiny IndexedDB helper used by the browser fallback --------------------------------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lifedash-secure', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('s');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(k: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('s').objectStore('s').get(k);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(k: string, v: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('s', 'readwrite');
    if (v === undefined) tx.objectStore('s').delete(k);
    else tx.objectStore('s').put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- public API -------------------------------------------------------------------------

export async function getSecret(name: string): Promise<string | null> {
  switch (platform()) {
    case 'tauri':
      return tauriInvoke<string | null>('secret_get', { name });
    case 'ios': {
      const s = await iosStore();
      return ((await s.get(name, false, false)) as string | null) ?? null;
    }
    default:
      return (await idbGet<string>(`secret:${name}`)) ?? null;
  }
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  switch (platform()) {
    case 'tauri':
      if (value === null) await tauriInvoke('secret_delete', { name });
      else await tauriInvoke('secret_set', { name, value });
      return;
    case 'ios': {
      const s = await iosStore();
      if (value === null) await s.remove(name, false);
      else await s.set(name, value, false, false);
      return;
    }
    default:
      await idbPut(`secret:${name}`, value ?? undefined);
  }
}

export async function getJSONSecret<T>(name: string): Promise<T | null> {
  const raw = await getSecret(name);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setJSONSecret(name: string, value: unknown): Promise<void> {
  await setSecret(name, value === null ? null : JSON.stringify(value));
}

let masterKey: Promise<CryptoKey> | null = null;

/** The AES-256 key that encrypts the local database. Created on first launch. */
export function getMasterKey(): Promise<CryptoKey> {
  masterKey ??= (async () => {
    if (platform() === 'web') {
      // Non-extractable CryptoKey persisted as a structured-clone object.
      let key = await idbGet<CryptoKey>('master-key');
      if (!key) {
        key = await generateAesKey();
        await idbPut('master-key', key);
      }
      return key;
    }
    let raw = await getSecret('master-key');
    if (!raw) {
      raw = toB64(randomBytes(32));
      await setSecret('master-key', raw);
    }
    return importAesKey(fromB64(raw));
  })();
  return masterKey;
}

/** Test hook */
export function _resetMasterKeyCache() {
  masterKey = null;
}
