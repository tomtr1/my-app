import { useState } from 'react';
import { Bell, CalendarDays } from 'lucide-react';
import { useApp } from '../store/app';
import { Card, Empty, SkeletonList, SourceLine, Switch } from '../ui/kit';
import { eventsOn } from '../services/calendar';
import { addDays, fmtDay, sameDay, startOfDay } from '../lib/dates';
import { Agenda } from './Today';

export function CalendarTab() {
  const { calendar, prep, status, refresh, settings, updateSettings, setTab } = useApp();
  const [sel, setSel] = useState(startOfDay());
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(), i));
  const events = calendar?.events ?? [];
  const dayEvents = eventsOn(events, sel);
  const calendars = [...new Map(events.map((e) => [e.calendar, e.color])).entries()];

  return (
    <div className="page">
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="page-head">
          <h1>Calendar</h1>
          <p>All your calendars in one timeline — with prep for every event.</p>
        </div>
        <SourceLine status={status.calendar} onRefresh={() => void refresh('calendar', true)} />
      </div>

      <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(64px, 1fr)', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {days.map((d) => {
          const n = eventsOn(events, d).length;
          const on = sameDay(d, sel);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSel(d)}
              className="card tight"
              style={{
                cursor: 'pointer',
                textAlign: 'center',
                padding: '10px 6px',
                background: on ? 'var(--accent)' : undefined,
                color: on ? 'var(--accent-ink)' : undefined,
                borderColor: on ? 'transparent' : undefined,
              }}
            >
              <div className="tiny" style={{ opacity: 0.7 }}>{fmtDay(d, { weekday: 'short' })}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{d.getDate()}</div>
              <div style={{ display: 'flex', gap: 3, justifyContent: 'center', height: 6, marginTop: 2 }}>
                {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                  <i key={i} className="dot" style={{ width: 5, height: 5, background: on ? 'var(--accent-ink)' : 'var(--accent)' }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid g-main">
        <Card title={fmtDay(sel, { weekday: 'long', day: 'numeric', month: 'long' })} action={<span className="small faint">{dayEvents.length} events</span>}>
          {status.calendar.loading && !calendar ? (
            <SkeletonList />
          ) : dayEvents.length ? (
            <Agenda events={dayEvents} prep={prep} />
          ) : (
            <Empty
              icon={<CalendarDays />}
              title={settings.calendars.length || settings.useDeviceCalendars ? 'Nothing on this day' : 'No calendars connected'}
              body={settings.calendars.length ? undefined : 'Add Google / Outlook / iCloud calendars in Settings.'}
              action={!settings.calendars.length ? <button className="btn" onClick={() => setTab('settings')}>Add calendars</button> : undefined}
            />
          )}
        </Card>

        <div className="col" style={{ gap: 'var(--gap)' }}>
          <Card title="Proactive alerts" action={<Bell size={16} color="var(--text-3)" />}>
            <div className="col" style={{ gap: 14 }}>
              <div className="spread">
                <div>
                  <b>Morning briefing</b>
                  <div className="small faint">Weather, events, recovery & what to prepare</div>
                </div>
                <div className="row">
                  <input
                    type="time"
                    className="input"
                    style={{ width: 124 }}
                    value={settings.notifications.morningTime}
                    onChange={(e) => void updateSettings((s) => ({ ...s, notifications: { ...s.notifications, morningTime: e.target.value } }))}
                  />
                  <Switch checked={settings.notifications.morningSummary} onChange={(v) => void updateSettings((s) => ({ ...s, notifications: { ...s.notifications, morningSummary: v } }))} />
                </div>
              </div>
              <div className="spread">
                <div>
                  <b>Before each event</b>
                  <div className="small faint">Lead time + travel time, with weather & things to bring</div>
                </div>
                <div className="row">
                  <select
                    className="input"
                    style={{ width: 96 }}
                    value={settings.notifications.leadMinutes}
                    onChange={(e) => void updateSettings((s) => ({ ...s, notifications: { ...s.notifications, leadMinutes: Number(e.target.value) } }))}
                  >
                    {[5, 10, 15, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                  <Switch checked={settings.notifications.eventReminders} onChange={(v) => void updateSettings((s) => ({ ...s, notifications: { ...s.notifications, eventReminders: v } }))} />
                </div>
              </div>
            </div>
          </Card>
          <Card title="Calendars">
            {calendars.length ? (
              <div className="col" style={{ gap: 8 }}>
                {calendars.map(([name, color]) => (
                  <div key={name} className="row small">
                    <i className="dot" style={{ background: color }} /> {name}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small faint">No events loaded yet.</p>
            )}
            {!!calendar?.errors.length && <p className="small c-warn" style={{ marginTop: 10 }}>{calendar.errors.join(' · ')}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
