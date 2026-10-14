import { useApp, REFRESH_MIN, type SourceKey } from '../store/app';
import { isNativeIOS } from '../platform/platform';
import { primaryPlace } from '../store/settings';
import { eventsOn } from './calendar';
import { addDays, fmtTime, ymd } from '../lib/dates';

/**
 * Keeps every source fresh with zero manual action:
 * - a 1-minute tick refreshes whatever is older than its cadence (REFRESH_MIN)
 * - Fitness polls every 5 min while its tab is open ("live" HR as the watch syncs)
 * - returning to the app / waking the PC triggers an immediate catch-up
 * - on iOS, a Background Runner task (ios/…/runners/background.js) refreshes the
 *   weather and re-schedules the morning summary while the app is suspended.
 */
export function startBackgroundSync(): () => void {
  const st = () => useApp.getState();
  const tick = () => {
    if (document.visibilityState === 'hidden' && isNativeIOS()) return; // iOS suspends us anyway
    for (const k of Object.keys(REFRESH_MIN) as SourceKey[]) {
      const status = st().status[k];
      const fast = k === 'fitness' && st().tab === 'fitness';
      const max = (fast ? 5 : REFRESH_MIN[k]) * 60_000;
      if (!status.loading && (!status.updatedAt || Date.now() - status.updatedAt > max)) void st().refresh(k, true);
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && tick();
  tick();
  const t = setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', tick);
  void shareWithBackgroundRunner();
  const unsub = useApp.subscribe((s, prev) => {
    if (s.settings !== prev.settings || s.calendar !== prev.calendar) void shareWithBackgroundRunner();
  });
  return () => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', tick);
    unsub();
  };
}

/** The iOS background runner can't read our encrypted DB — hand it only what it needs. */
async function shareWithBackgroundRunner() {
  if (!isNativeIOS()) return;
  const { settings: s, calendar } = useApp.getState();
  const place = primaryPlace(s);
  // Pre-rendered agenda lines for today/tomorrow, so the runner's briefing includes events.
  const agenda = [0, 1].map((i) => {
    const day = addDays(new Date(), i);
    const timed = eventsOn(calendar?.events ?? [], day).filter((e) => !e.allDay);
    return {
      date: ymd(day),
      line: timed.length ? `${timed.length} event${timed.length > 1 ? 's' : ''}, first ${fmtTime(new Date(timed[0].start))} ${timed[0].title}` : '',
    };
  });
  try {
    const { BackgroundRunner } = await import('@capacitor/background-runner');
    await BackgroundRunner.dispatchEvent({
      label: 'app.lifedash.refresh',
      event: 'configure',
      details: {
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
        morning: s.notifications.morningSummary ? s.notifications.morningTime : null,
        agenda,
      },
    });
  } catch {
    /* runner unavailable (simulator / disabled background refresh) */
  }
}
