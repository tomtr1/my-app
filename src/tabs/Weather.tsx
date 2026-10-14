import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudSun, Droplets, MapPin, Pause, Play, Sunrise, Sunset, Sun, Wind } from 'lucide-react';
import L from 'leaflet';
import { useApp } from '../store/app';
import { Card, Empty, SourceLine } from '../ui/kit';
import { WeatherIcon } from '../ui/icons';
import { fetchRadarFrames, isDaylight, wmo, type WeatherSnapshot } from '../services/weather';
import { fmtTime, fmtWeekday } from '../lib/dates';
import { primaryPlace } from '../store/settings';

export function WeatherTab() {
  const { weather, settings, status, refresh, setTab } = useApp();
  const [placeId, setPlaceId] = useState(primaryPlace(settings)?.id ?? null);
  const w = placeId ? weather[placeId] : undefined;

  if (!settings.places.length)
    return (
      <div className="page">
        <Card>
          <Empty icon={<MapPin />} title="No locations yet" body="Add home, work or any city." action={<button className="btn primary" onClick={() => setTab('settings')}>Add location</button>} />
        </Card>
      </div>
    );

  return (
    <div className="page">
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {settings.places.map((p) => (
            <button key={p.id} className={`chip ${placeId === p.id ? 'on' : ''}`} onClick={() => setPlaceId(p.id)}>
              <MapPin size={12} /> {p.name}
            </button>
          ))}
        </div>
        <SourceLine status={status.weather} onRefresh={() => void refresh('weather', true)} />
      </div>
      {w ? <WeatherDetail w={w} /> : <Card><Empty icon={<CloudSun />} title="Loading forecast…" /></Card>}
    </div>
  );
}

function WeatherDetail({ w }: { w: WeatherSnapshot }) {
  const now = Date.now();
  const hours = w.hours.filter((h) => new Date(h.time).getTime() > now - 3_600_000).slice(0, 24);
  const tMin = Math.min(...w.days.map((d) => d.min));
  const tMax = Math.max(...w.days.map((d) => d.max));
  const today = w.days[0];
  return (
    <>
      <Card className="hl">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 20 }}>
          <div className="row" style={{ gap: 20 }}>
            <WeatherIcon code={w.now.code} isDay={w.now.isDay} size={64} />
            <div>
              <div className="muted">{w.placeName}</div>
              <div className="tabular" style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>{Math.round(w.now.temp)}°</div>
              <div className="muted">{wmo(w.now.code).label} · feels {Math.round(w.now.feels)}°</div>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, auto)', gap: '12px 24px' }}>
            <Detail icon={<Droplets size={14} />} label="Humidity" value={`${Math.round(w.now.humidity)} %`} />
            <Detail icon={<Wind size={14} />} label="Wind" value={`${Math.round(w.now.wind)} km/h`} sub={`gusts ${Math.round(w.now.gusts)}`} />
            <Detail icon={<Sun size={14} />} label="UV max" value={today ? String(Math.round(today.uv)) : '–'} />
            <Detail icon={<Sunrise size={14} />} label="Sunrise" value={today ? fmtTime(today.sunrise) : '–'} />
            <Detail icon={<Sunset size={14} />} label="Sunset" value={today ? fmtTime(today.sunset) : '–'} />
            <Detail icon={<Droplets size={14} />} label="Rain today" value={today ? `${today.precip.toFixed(1)} mm` : '–'} />
          </div>
        </div>
      </Card>

      {w.alerts.length > 0 && (
        <Card title="Severe weather warnings" action={<span className="tiny faint">DWD via Bright Sky</span>}>
          <div className="col" style={{ gap: 8 }}>
            {w.alerts.map((a) => (
              <div key={a.id} className={`hint ${a.severity === 'minor' ? 'warn' : 'alert'}`}>
                <AlertTriangle />
                <div>
                  <b>{a.headline || a.event}</b>
                  <div className="small muted">{fmtWeekday(a.onset)} {fmtTime(a.onset)} – {fmtWeekday(a.expires)} {fmtTime(a.expires)}</div>
                  <p className="small" style={{ marginTop: 4 }}>{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Next 24 hours">
        <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(48px, 1fr)', overflowX: 'auto', gap: 4 }}>
          {hours.map((h) => (
            <div key={h.time} className="col" style={{ alignItems: 'center', gap: 6, padding: '4px 0' }}>
              <span className="tiny faint">{new Date(h.time).getHours()}:00</span>
              <WeatherIcon code={h.code} size={18} isDay={isDaylight(h.time, w.days)} />
              <b className="tabular">{Math.round(h.temp)}°</b>
              <div style={{ height: 34, width: 6, background: 'var(--surface-3)', borderRadius: 3, display: 'flex', alignItems: 'flex-end' }} title={`${h.pop} % · ${h.precip} mm`}>
                <div style={{ width: '100%', height: `${h.pop}%`, background: 'var(--blue)', borderRadius: 3 }} />
              </div>
              <span className="tiny tabular c-blue" style={{ visibility: h.pop >= 10 ? 'visible' : 'hidden' }}>{h.pop}%</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid g-main">
        <Card title="Rain radar" action={<span className="tiny faint">RainViewer · © OpenStreetMap, CARTO</span>}>
          <Radar lat={w.lat} lon={w.lon} />
        </Card>
        <Card title="7 days">
          <div className="list">
            {w.days.map((d, i) => (
              <div key={d.date} className="li">
                <span style={{ width: 44 }} className="small">{i === 0 ? 'Today' : fmtWeekday(d.date)}</span>
                <WeatherIcon code={d.code} size={18} />
                <span className="tiny c-blue tabular" style={{ width: 34 }}>{d.pop >= 20 ? `${d.pop}%` : ''}</span>
                <span className="tabular small faint" style={{ width: 28, textAlign: 'right' }}>{Math.round(d.min)}°</span>
                <div className="grow" style={{ position: 'relative', height: 5, background: 'var(--surface-3)', borderRadius: 3 }}>
                  <div
                    style={{
                      position: 'absolute', height: '100%', borderRadius: 3,
                      left: `${((d.min - tMin) / (tMax - tMin || 1)) * 100}%`,
                      width: `${((d.max - d.min) / (tMax - tMin || 1)) * 100}%`,
                      background: 'linear-gradient(90deg, var(--teal), var(--warn))',
                    }}
                  />
                </div>
                <span className="tabular small" style={{ width: 28 }}>{Math.round(d.max)}°</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Detail({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="row tiny faint" style={{ gap: 5 }}>{icon}{label}</div>
      <b className="tabular">{value}</b> {sub && <span className="tiny faint">{sub}</span>}
    </div>
  );
}

function Radar({ lat, lon }: { lat: number; lon: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [frames, setFrames] = useState<{ host: string; frames: Array<{ time: number; path: string }> } | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [err, setErr] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<L.TileLayer[]>([]);

  useEffect(() => {
    fetchRadarFrames().then((f) => { setFrames(f); setIdx(f.frames.length - 1); }).catch(() => setErr(true));
  }, []);

  useEffect(() => {
    if (!el.current || !frames) return;
    const dark = document.documentElement.dataset.theme !== 'light';
    const map = L.map(el.current, { zoomControl: false, attributionControl: true, maxZoom: 10, minZoom: 3 }).setView([lat, lon], 7);
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
    }).addTo(map);
    // Free tier serves up to zoom 7 — Leaflet upscales beyond that.
    layers.current = frames.frames.map((f) =>
      L.tileLayer(`${frames.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7, attribution: 'RainViewer' }).addTo(map),
    );
    L.circleMarker([lat, lon], { radius: 5, color: '#c6f432', weight: 2, fillOpacity: 1 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [frames, lat, lon]);

  useEffect(() => {
    layers.current.forEach((l, i) => l.setOpacity(i === idx ? 0.75 : 0));
  }, [idx, frames]);

  useEffect(() => {
    if (!playing || !frames) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.frames.length), 700);
    return () => clearInterval(t);
  }, [playing, frames]);

  if (err) return <Empty icon={<CloudSun />} title="Radar unavailable" />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div ref={el} style={{ height: 320 }} />
      {frames && (
        <div className="row">
          <button className="btn icon sm" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</button>
          <input type="range" className="grow" min={0} max={frames.frames.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
          <span className="small tabular faint" style={{ width: 48 }}>{fmtTime(new Date(frames.frames[idx].time * 1000))}</span>
        </div>
      )}
    </div>
  );
}
