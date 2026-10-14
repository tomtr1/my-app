import { platform } from './platform';

export interface LocalNotice {
  id: number;
  title: string;
  body: string;
  at?: Date; // undefined = now
}

/**
 * Local notifications.
 * - iOS: UNUserNotificationCenter via @capacitor/local-notifications — scheduled notices
 *   fire even when the app is closed.
 * - Windows: Windows toast via tauri-plugin-notification. Desktop toasts cannot be
 *   scheduled by the OS, so the app (which lives in the tray and autostarts) keeps
 *   in-process timers.
 * - Browser: Notification API + timers while the tab is open.
 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export async function ensureNotificationPermission(): Promise<boolean> {
  switch (platform()) {
    case 'ios': {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const s = await LocalNotifications.checkPermissions();
      if (s.display === 'granted') return true;
      return (await LocalNotifications.requestPermissions()).display === 'granted';
    }
    case 'tauri': {
      const n = await import('@tauri-apps/plugin-notification');
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === 'granted';
    }
    default:
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      return (await Notification.requestPermission()) === 'granted';
  }
}

async function showNow(n: LocalNotice) {
  switch (platform()) {
    case 'tauri': {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title: n.title, body: n.body });
      return;
    }
    case 'ios': {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({ notifications: [{ id: n.id, title: n.title, body: n.body }] });
      return;
    }
    default:
      if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body });
  }
}

/** Schedules (or replaces) notifications. Past `at` dates are dropped. */
export async function scheduleNotices(list: LocalNotice[]): Promise<void> {
  const now = Date.now();
  const upcoming = list.filter((n) => !n.at || n.at.getTime() > now - 1000);
  if (platform() === 'ios') {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (upcoming.length) await LocalNotifications.cancel({ notifications: upcoming.map((n) => ({ id: n.id })) });
    await LocalNotifications.schedule({
      notifications: upcoming.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: n.at ? { at: n.at, allowWhileIdle: true } : undefined,
      })),
    });
    return;
  }
  for (const n of upcoming) {
    clearTimeout(timers.get(n.id));
    const delay = n.at ? n.at.getTime() - now : 0;
    if (delay <= 0) await showNow(n);
    // setTimeout overflows above ~24.8 days; we only ever plan ~2 days ahead.
    else timers.set(n.id, setTimeout(() => void showNow(n), Math.min(delay, 2 ** 31 - 1)));
  }
}

export async function cancelNotices(ids: number[]): Promise<void> {
  ids.forEach((id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  });
  if (platform() === 'ios' && ids.length) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  }
}
