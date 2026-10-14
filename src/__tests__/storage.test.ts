import { describe, expect, it } from 'vitest';
import { generateAesKey, open, seal } from '../platform/crypto';
import { _setBackend, db, idbBackend } from '../platform/storage';

describe('crypto', () => {
  it('round-trips and uses a fresh IV each time', async () => {
    const k = await generateAesKey();
    const a = await seal(k, 'hello ✓');
    const b = await seal(k, 'hello ✓');
    expect(a).not.toEqual(b);
    expect(await open(k, a)).toBe('hello ✓');
  });

  it('rejects tampered ciphertext', async () => {
    const k = await generateAesKey();
    const s = await seal(k, 'secret');
    const bytes = atob(s).split('');
    bytes[20] = String.fromCharCode(bytes[20].charCodeAt(0) ^ 1);
    await expect(open(k, btoa(bytes.join('')))).rejects.toThrow();
  });
});

describe('encrypted db', () => {
  it('stores only ciphertext in the backend', async () => {
    const raw = idbBackend('test-db');
    _setBackend(raw);
    await db.set('diary:2026-10-14', [{ name: 'Banana', kcal: 105 }]);
    const stored = await raw.get('diary:2026-10-14');
    expect(stored).not.toContain('Banana');
    expect(await db.get('diary:2026-10-14')).toEqual([{ name: 'Banana', kcal: 105 }]);
    expect(await db.keys('diary:')).toEqual(['diary:2026-10-14']);
    await db.wipe();
    expect(await db.get('diary:2026-10-14')).toBeNull();
  });
});
