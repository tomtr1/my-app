import { platform } from './platform';
import { LifeNative } from './native';

export interface MiniAppDef {
  id: string;
  title: string;
  url: string;
  /** Some sites (WhatsApp Web) refuse mobile browsers — spoof a desktop UA there. */
  desktopUA?: boolean;
  icon?: string;
}

export const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Embedded web apps (WhatsApp Web, Gmail, Outlook, Notion, …).
 *
 * Each mini-app gets its own isolated, persistent browser profile so logins survive
 * restarts and sites can't see each other's cookies.
 * - Windows: a native WebView2 child view is laid over the placeholder <div> inside the
 *   main window (Rust: `miniapp_show`), with its own data directory.
 * - iOS: a full-screen WKWebView with a per-app persistent WKWebsiteDataStore.
 * - Browser: falls back to a new tab (sites forbid iframing via X-Frame-Options).
 */
export const miniapps = {
  /** Whether this platform renders the app *inside* a placeholder rect. */
  embedsInline(): boolean {
    return platform() === 'tauri';
  },

  async show(app: MiniAppDef, rect: Rect): Promise<void> {
    switch (platform()) {
      case 'tauri': {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('miniapp_show', {
          id: app.id,
          url: app.url,
          userAgent: null,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        return;
      }
      case 'ios':
        await LifeNative.openMiniApp({
          id: app.id,
          url: app.url,
          title: app.title,
          userAgent: app.desktopUA ? DESKTOP_UA : undefined,
        });
        return;
      default:
        window.open(app.url, `lifedash-${app.id}`);
    }
  },

  async resize(id: string, rect: Rect): Promise<void> {
    if (platform() !== 'tauri') return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('miniapp_resize', { id, ...rect });
  },

  async hideAll(): Promise<void> {
    if (platform() !== 'tauri') return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('miniapp_hide_all');
  },

  async reload(id: string): Promise<void> {
    if (platform() !== 'tauri') return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('miniapp_reload', { id });
  },

  /** Logs out: deletes the app's cookies/storage. */
  async clear(id: string): Promise<void> {
    switch (platform()) {
      case 'tauri': {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('miniapp_clear', { id });
        return;
      }
      case 'ios':
        await LifeNative.clearMiniApp({ id });
    }
  },
};
