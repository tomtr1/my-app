import { create } from 'zustand';
import { platform } from '../platform/platform';
import { LifeNative } from '../platform/native';

/**
 * Unread counts scraped from the embedded apps' document titles —
 * WhatsApp Web shows "(3) WhatsApp", Gmail "Inbox (12) - …", Outlook "Mail - … (4)".
 */
export function parseUnread(title: string): number {
  const m = title.match(/\((\d{1,5})\)/);
  return m ? Number(m[1]) : 0;
}

export const useUnread = create<{ counts: Record<string, number> }>(() => ({ counts: {} }));

export async function listenForTitles(): Promise<void> {
  const set = (id: string, title: string) => useUnread.setState((s) => ({ counts: { ...s.counts, [id]: parseUnread(title) } }));
  if (platform() === 'tauri') {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ id: string; title: string }>('miniapp-title', (e) => set(e.payload.id, e.payload.title));
  } else if (platform() === 'ios') {
    await LifeNative.addListener('miniAppTitle', (e: { id: string; title: string }) => set(e.id, e.title));
  }
}
