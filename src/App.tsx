import { useEffect, useState } from 'react';
import { Plus, RefreshCw, MoreHorizontal } from 'lucide-react';
import { useApp, type TabKey } from './store/app';
import { TAB_META } from './ui/icons';
import { Sheet } from './ui/kit';
import { fmtLongDate, fmtTime } from './lib/dates';
import { startBackgroundSync } from './services/sync';
import { miniapps } from './platform/miniapp';
import { TodayTab } from './tabs/Today';
import { FitnessTab } from './tabs/Fitness';
import { CalendarTab } from './tabs/Calendar';
import { NutritionTab } from './tabs/Nutrition';
import { NewsTab } from './tabs/News';
import { WeatherTab } from './tabs/Weather';
import { AppsTab, MiniAppView } from './tabs/Apps';
import { SettingsTab } from './tabs/Settings';
import { Onboarding } from './tabs/Onboarding';
import { QuickAdd } from './tabs/QuickAdd';
import { listenForTitles, useUnread } from './store/unread';

const SIDEBAR: TabKey[] = ['today', 'fitness', 'calendar', 'whatsapp', 'nutrition', 'news', 'weather', 'apps'];
const MOBILE: TabKey[] = ['today', 'fitness', 'calendar', 'nutrition'];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function App() {
  const { ready, tab, setTab, settings, refreshAll, status, sheet, setSheet } = useApp();
  const [more, setMore] = useState(false);
  const now = useClock();
  const unread = useUnread((s) => s.counts);

  useEffect(() => {
    void listenForTitles();
  }, []);

  useEffect(() => {
    if (!ready || !settings.onboarded) return;
    return startBackgroundSync();
  }, [ready, settings.onboarded]);

  useEffect(() => {
    const t = settings.theme;
    const dark = t === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [settings.theme]);

  // Native web views float above the DOM — hide them whenever a non-app tab is shown.
  useEffect(() => {
    if (tab !== 'whatsapp' && tab !== 'apps') void miniapps.hideAll();
  }, [tab]);

  // Keyboard shortcuts: 1–8 switch tabs, N quick add, R refresh.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < SIDEBAR.length) setTab(SIDEBAR[i]);
      else if (e.key === 'n') setSheet('quick-add');
      else if (e.key === 'r') void refreshAll(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab, setSheet, refreshAll]);

  if (!ready) return null;
  if (!settings.onboarded) return <Onboarding />;

  const syncing = Object.values(status).some((s) => s.loading);
  const flush = tab === 'whatsapp' || tab === 'apps';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">{(settings.name || 'L').slice(0, 1).toUpperCase()}</div>
          <div>
            <b>Lifedash</b>
            <span className="small faint">{settings.name || 'Personal dashboard'}</span>
          </div>
        </div>
        {SIDEBAR.map((k, i) => {
          const { label, Icon } = TAB_META[k];
          return (
            <button key={k} className={`nav-item ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)} title={`${label} (${i + 1})`}>
              <Icon />
              <span className="grow">{label}</span>
              {k === 'whatsapp' && unread.whatsapp ? <span className="chip accent tabular" style={{ height: 20 }}>{unread.whatsapp}</span> : null}
              {k === 'apps' && (unread.gmail || unread.outlook) ? <span className="chip tabular" style={{ height: 20 }}>{(unread.gmail ?? 0) + (unread.outlook ?? 0)}</span> : null}
            </button>
          );
        })}
        <div className="nav-sep" />
        <button className={`nav-item ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          <TAB_META.settings.Icon />
          <span>Settings</span>
        </button>
        <div style={{ flex: 1 }} />
        <p className="tiny faint" style={{ padding: '0 12px' }}>
          Local-first · encrypted on this device
        </p>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div style={{ fontWeight: 650 }}>{fmtLongDate(now)}</div>
            <div className="small faint tabular">{fmtTime(now)}</div>
          </div>
          <div className="row">
            <button className="btn icon ghost" onClick={() => void refreshAll(true)} aria-label="Refresh all" title="Refresh (R)">
              <RefreshCw className={syncing ? 'spin' : ''} />
            </button>
            <button className="btn primary" onClick={() => setSheet('quick-add')} title="Quick add (N)">
              <Plus /> <span>New</span>
            </button>
          </div>
        </header>
        <div className={`content ${flush ? 'flush' : ''}`}>
          {tab === 'today' && <TodayTab />}
          {tab === 'fitness' && <FitnessTab />}
          {tab === 'calendar' && <CalendarTab />}
          {tab === 'whatsapp' && <MiniAppView appId="whatsapp" />}
          {tab === 'nutrition' && <NutritionTab />}
          {tab === 'news' && <NewsTab />}
          {tab === 'weather' && <WeatherTab />}
          {tab === 'apps' && <AppsTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </main>

      <nav className="tabbar">
        {MOBILE.map((k) => {
          const { label, Icon } = TAB_META[k];
          return (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              <Icon />
              {label}
            </button>
          );
        })}
        <button className={!MOBILE.includes(tab) ? 'active' : ''} onClick={() => setMore(true)}>
          <MoreHorizontal />
          More
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="grid g-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {(['whatsapp', 'news', 'weather', 'apps', 'settings'] as TabKey[]).map((k) => {
            const { label, Icon } = TAB_META[k];
            return (
              <button
                key={k}
                className="card tight row"
                style={{ cursor: 'pointer', textAlign: 'left' }}
                onClick={() => {
                  setTab(k);
                  setMore(false);
                }}
              >
                <Icon size={20} color="var(--accent)" />
                <b>{label}</b>
              </button>
            );
          })}
        </div>
      </Sheet>

      <QuickAdd open={sheet === 'quick-add'} onClose={() => setSheet(null)} />
    </div>
  );
}
