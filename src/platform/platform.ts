import { Capacitor } from '@capacitor/core';

export type PlatformKind = 'tauri' | 'ios' | 'web';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function platform(): PlatformKind {
  if (isTauri()) return 'tauri';
  if (isNativeIOS()) return 'ios';
  return 'web';
}
