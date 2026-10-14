import { useMemo } from 'react';
import { Camera, CalendarDays, Droplets, Flame, Footprints, Mail, MapPin, MessageCircle, Sparkles, Umbrella, Car, Video, Newspaper, HeartPulse, ShoppingBag } from 'lucide-react';
import { useApp, selectHints, selectPrimaryWeather, selectReadiness } from '../store/app';
import { Bar, Card, Empty, Ring, SkeletonList, Stat } from '../ui/kit';
import { HintIcon, WeatherIcon } from '../ui/icons';
import { eventsOn, type CalEvent } from '../services/calendar';
import { clusterStories } from '../services/news';
import { computeGoals, sumMacros } from '../services/nutrition';
import { isDaylight, wmo } from '../services/weather';
import { fmtTime, greeting, relTime, ymd } from '../lib/dates';
import { fmtInt } from '../lib/num';
import type { EventPrep } from '../services/hints';
import { openExternal } from '../platform/open';

const toneColor = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' } as const;

export function TodayTab() {
  const st = useApp();
  const { settings, calendar, fitness, news, setTab, prep, status } = st;
  const weather = selectPrimaryWeather(st);
  const ready = selectReadiness(st);
  const hints = useMemo(() => selectHints(st), [st]);
  const date = ymd();
  const today = fitness?.days[date];
  const events = eventsOn(calendar?.events ?? [], new Date());
  const now = Date.now();
  const next = events.find((e) => !e.allDay && e.end > now);
  const goals = computeGoals(settings.nutrition);
  const eaten = sumMacros(st.diary[date] ?? []);
  const water = st.water[date] ?? 0;
  const top = useMemo(() => clusterStories(news?.articles ?? [], settings.news.keywords).filter((c) => c.important).slice(0, 3), [news, settings.news.keywords]);
  const activitiesToday = (fitness?.activities ?? []).filter((a) => ymd(new Date(a.start)) === date);

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          {greeting()}
          {settings.name ? `, ${settings.name}` : ''}. <span className="c-accent">Let’s go.</span>
        </h1>
        <p>Your day at a glance.</p>
      </div>

      <div className="grid g-4">
        <Stat
          label="Events today"
          value={events.length}
          icon={<CalendarDays size={16} />}
          sub={next ? `Next ${fmtTime(new Date(next.start))} · ${next.title}` : events.length ? 'All done for today' : 'Free day'}
          onClick={() => setTab('calendar')}
        />
        <Stat
          label="Weather"
          value={weather ? `${Math.round(weather.now.temp)}°` : '–'}
          color="var(--blue)"
          icon={weather ? <WeatherIcon code={weather.now.code} isDay={weather.now.isDay} size={16} /> : undefined}
          sub={weather ? `${wmo(weather.now.code).label} · ${Math.round(weather.days[0]?.min)}–${Math.round(weather.days[0]?.max)}°` : 'Add a location'}
          onClick={() => setTab('weather')}
        />
        <Stat
          label="Recovery"
          value={ready ? ready.score : '–'}
          unit={ready ? '%' : undefined}
          color={ready ? toneColor[ready.tone] : undefined}
          icon={<HeartPulse size={16} />}
          sub={ready ? `${ready.label} · ${ready.load}` : 'Connect a wearable'}
          onClick={() => setTab('fitness')}
        />
        <Stat
          label="Calories"
          value={fmtInt(eaten.kcal)}
          unit={`/ ${fmtInt(goals.kcal)}`}
          color="var(--orange)"
          icon={<Flame size={16} />}
          sub={`${fmtInt(goals.kcal - eaten.kcal)} kcal left · ${(water / 1000).toFixed(1)} L water`}
          onClick={() => setTab('nutrition')}
        />
      </div>

      {/* Recovery & movement — WHOOP-style hero */}
      <Card className="hl" onClick={() => setTab('fitness')}>
        {fitness || status.fitness.loading ? (
          <div className="col" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 16 }}>
              <Ring value={ready?.score ?? 0} size={68} stroke={6} color={ready ? toneColor[ready.tone] : 'var(--text-3)'} label="Recovery score">
                <span style={{ fontSize: 20 }}>{ready?.score ?? '–'}</span>
              </Ring>
              <div className="col grow" style={{ gap: 4 }}>
                <div className="row small" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <i className="dot" style={{ background: ready ? toneColor[ready.tone] : 'var(--text-3)' }} /> Recovery
                  </span>
                  {ready && <span className={`chip ${ready.tone === 'bad' ? 'bad' : ready.tone === 'warn' ? 'warn' : 'good'}`}>{ready.load.toUpperCase()}</span>}
                  {activitiesToday.length > 0 && (
                    <span className="chip">
                      {activitiesToday.length}× {Math.round(activitiesToday.reduce((a, b) => a + b.durationMin, 0))} min
                    </span>
                  )}
                </div>
                <b style={{ fontSize: 16 }}>{ready ? (ready.load === 'Push' ? 'Push day' : ready.load === 'Normal' ? 'Train as planned' : ready.load === 'Light' ? 'Light day' : 'Rest day') : 'No recovery data yet'}</b>
              </div>
            </div>
            <div className="grid g-2">
              <div className="col" style={{ gap: 8 }}>
                <div className="spread small">
                  <span className="row muted" style={{ gap: 6 }}>
                    <Footprints size={14} /> Steps
                  </span>
                  <span className="tabular">
                    <b>{fmtInt(today?.steps)}</b> <span className="faint">/ {fmtInt(settings.fitness.stepGoal)}</span>
                  </span>
                </div>
                <Bar value={today?.steps ?? 0} max={settings.fitness.stepGoal} color="var(--accent)" />
              </div>
              <div className="col" style={{ gap: 8 }}>
                <div className="spread small">
                  <span className="row muted" style={{ gap: 6 }}>
                    <Flame size={14} /> Calories eaten
                  </span>
                  <span className="tabular">
                    <b>{fmtInt(eaten.kcal)}</b> <span className="faint">/ {fmtInt(goals.kcal)}</span>
                  </span>
                </div>
                <Bar value={eaten.kcal} max={goals.kcal} color="var(--orange)" />
              </div>
            </div>
            {ready && (
              <p className="small muted row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <Sparkles size={14} color="var(--accent)" style={{ flex: 'none', marginTop: 2 }} />
                <i>{ready.advice}</i>
              </p>
            )}
          </div>
        ) : (
          <Empty icon={<HeartPulse />} title="Connect your wearable" body="Garmin, WHOOP or Apple Health — data then syncs automatically." />
        )}
      </Card>

      {hints.length > 0 && (
        <Card title="Your plan for today" action={<span className="faint small hide-sm">weather × calendar × recovery</span>}>
          <div className="col" style={{ gap: 8 }}>
            {hints.slice(0, 6).map((h) => (
              <div key={h.id} className={`hint ${h.tone}`}>
                <HintIcon icon={h.icon} />
                <span>{h.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid g-main">
        <Card title="Today" action={<span className="small faint">{events.length} events</span>}>
          {status.calendar.loading && !calendar ? (
            <SkeletonList rows={3} />
          ) : events.length ? (
            <Agenda events={events} prep={prep} />
          ) : (
            <Empty icon={<CalendarDays />} title="Nothing scheduled" body={settings.calendars.length ? 'Enjoy the free day.' : 'Add your calendars in Settings → Calendars.'} />
          )}
        </Card>

        <div className="col" style={{ gap: 'var(--gap)' }}>
          <Card title={weather?.placeName ?? 'Weather'} onClick={() => setTab('weather')}>
            {weather ? (
              <div className="col" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 14 }}>
                  <WeatherIcon code={weather.now.code} isDay={weather.now.isDay} size={38} />
                  <div>
                    <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }} className="tabular">
                      {Math.round(weather.now.temp)}°
                    </div>
                    <div className="small muted">
                      Feels {Math.round(weather.now.feels)}° · Wind {Math.round(weather.now.wind)} km/h
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                  {weather.hours
                    .filter((h) => new Date(h.time).getTime() > now - 3_600_000)
                    .slice(0, 6)
                    .map((h) => (
                      <div key={h.time} className="col" style={{ alignItems: 'center', gap: 4 }}>
                        <span className="tiny faint">{new Date(h.time).getHours()}h</span>
                        <WeatherIcon code={h.code} size={16} isDay={isDaylight(h.time, weather.days)} />
                        <span className="small tabular">{Math.round(h.temp)}°</span>
                        <span className="tiny c-blue tabular" style={{ visibility: h.pop >= 20 ? 'visible' : 'hidden' }}>
                          {h.pop}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <Empty icon={<MapPin />} title="No location" body="Add home in Settings." />
            )}
          </Card>

          <Card title="Quick actions">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              <button className="btn" onClick={() => { setTab('nutrition'); st.setSheet('add-food'); }}>
                <Camera /> Snap meal
              </button>
              <button className="btn" onClick={() => void st.addWater(250)}>
                <Droplets /> +250 ml
              </button>
              <button className="btn" onClick={() => setTab('whatsapp')}>
                <MessageCircle /> WhatsApp
              </button>
              <button className="btn" onClick={() => setTab('apps')}>
                <Mail /> Mail
              </button>
            </div>
          </Card>

          <Card title="Top news" action={<button className="btn sm ghost" onClick={() => setTab('news')}>All</button>}>
            {top.length ? (
              <div className="list">
                {top.map((c) => (
                  <button key={c.id} className="li" onClick={() => void openExternal(c.lead.url)} style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
                    <div className="grow">
                      <div style={{ fontWeight: 550 }}>{c.lead.title}</div>
                      <div className="tiny faint">
                        {c.lead.source}
                        {c.others.length ? ` +${c.others.length} sources` : ''} · {relTime(c.lead.published)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <Empty icon={<Newspaper />} title="No headlines yet" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function Agenda({ events, prep }: { events: CalEvent[]; prep: Record<string, EventPrep> }) {
  const now = Date.now();
  return (
    <div className="list">
      {events.map((e) => {
        const p = prep[e.id];
        const past = e.end < now;
        const live = e.start <= now && e.end > now;
        return (
          <div key={e.id} className="li" style={{ opacity: past ? 0.45 : 1, alignItems: 'flex-start' }}>
            <div style={{ width: 66, flex: 'none' }} className="tabular small">
              {e.allDay ? <span className="faint">all-day</span> : <b>{fmtTime(new Date(e.start))}</b>}
              {!e.allDay && <div className="tiny faint">{fmtTime(new Date(e.end))}</div>}
            </div>
            <i style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: e.color, flex: 'none' }} />
            <div className="grow col" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <b className="ellipsis">{e.title}</b>
                {live && <span className="chip accent">now</span>}
              </div>
              <div className="row tiny faint" style={{ flexWrap: 'wrap', gap: 8 }}>
                {e.location && (
                  <span className="row" style={{ gap: 4 }}>
                    <MapPin size={12} /> <span className="ellipsis" style={{ maxWidth: 220 }}>{e.location}</span>
                  </span>
                )}
                <span>{e.calendar}</span>
              </div>
              {p && !past && (p.online || p.travelMin || p.weather || p.bring.length > 0) && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {p.online && <span className="chip"><Video size={12} /> online</span>}
                  {!!p.travelMin && p.leaveAt && <span className="chip warn"><Car size={12} /> leave {fmtTime(new Date(p.leaveAt))} · {p.travelMin} min</span>}
                  {p.weather && !p.online && (
                    <span className="chip">
                      <WeatherIcon code={p.weather.code} size={12} /> {Math.round(p.weather.temp)}°{p.weather.pop >= 30 ? ` · ${p.weather.pop}%` : ''}
                    </span>
                  )}
                  {p.bring.slice(0, 3).map((b) => (
                    <span key={b} className="chip">{/umbrella/i.test(b) ? <Umbrella size={12} /> : <ShoppingBag size={12} />} {b}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
