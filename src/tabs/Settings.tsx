import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CalendarDays, Check, Download, HeartPulse, KeyRound, Loader2, LocateFixed, MapPin, Newspaper, Plus, Shield, Star, Trash2, User, Utensils } from 'lucide-react';
import { useApp } from '../store/app';
import { NEWS_TOPICS, type CalendarFeed, type Settings } from '../store/settings';
import { Card, Seg, Switch } from '../ui/kit';
import { currentPosition, searchCity, type GeoResult, type Place } from '../lib/geo';
import { getSecret, setSecret } from '../platform/secure';
import { db } from '../platform/storage';
import { ensureNotificationPermission } from '../platform/notify';
import { platform } from '../platform/platform';
import { redirectUri } from '../platform/oauth';
import { garmin } from '../services/garmin';
import { whoop } from '../services/whoop';
import { computeGoals } from '../services/nutrition';
import { uid } from '../lib/num';

type Upd = (fn: (s: Settings) => Settings) => Promise<void>;

function Section({ icon, title, children, desc }: { icon: ReactNode; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="row" style={{ marginBottom: 16, alignItems: 'flex-start' }}>
        <div className="empty ico" style={{ width: 34, height: 34, padding: 0, color: 'var(--accent)' }}>{icon}</div>
        <div>
          <h2 style={{ fontSize: 16 }}>{title}</h2>
          {desc && <p className="small faint">{desc}</p>}
        </div>
      </div>
      <div className="col" style={{ gap: 14 }}>{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="spread" style={{ flexWrap: 'wrap' }}>
      <div style={{ minWidth: 180, flex: 1 }}>
        <div>{label}</div>
        {hint && <div className="small faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Write-only field for API keys: never displays a stored secret. */
export function SecretField({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const [has, setHas] = useState(false);
  const [v, setV] = useState('');
  useEffect(() => {
    void getSecret(name).then((x) => setHas(!!x));
  }, [name]);
  return (
    <label className="field">
      {label}
      <div className="row">
        <input className="input" type="password" autoComplete="off" placeholder={has ? '•••••••• saved in secure storage' : placeholder} value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" className="btn" disabled={!v} onClick={async () => { await setSecret(name, v.trim()); setV(''); setHas(true); }}><Check /> Save</button>
        {has && <button type="button" className="btn icon ghost" aria-label="Delete key" onClick={async () => { await setSecret(name, null); setHas(false); }}><Trash2 /></button>}
      </div>
    </label>
  );
}

export function SettingsTab() {
  const { settings: s, updateSettings: upd } = useApp();
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Everything stays on this device. Keys go to the {platform() === 'ios' ? 'iOS Keychain' : platform() === 'tauri' ? 'Windows Credential Manager' : 'browser store (dev only)'}.</p>
      </div>
      <Section icon={<User size={18} />} title="Profile">
        <Row label="Your name"><input className="input" style={{ width: 240 }} value={s.name} onChange={(e) => void upd((x) => ({ ...x, name: e.target.value }))} /></Row>
        <Row label="Appearance"><Seg value={s.theme} onChange={(v) => void upd((x) => ({ ...x, theme: v }))} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'System']]} /></Row>
        {platform() === 'tauri' && <AutostartRow />}
      </Section>
      <Places s={s} upd={upd} />
      <Calendars s={s} upd={upd} />
      <Fitness s={s} upd={upd} />
      <Nutrition s={s} upd={upd} />
      <News s={s} upd={upd} />
      <Notifications />
      <Privacy />
    </div>
  );
}

function AutostartRow() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void import('@tauri-apps/plugin-autostart').then((a) => a.isEnabled()).then(setOn);
  }, []);
  return (
    <Row label="Start with Windows" hint="Runs in the tray so syncing and reminders continue">
      <Switch
        checked={on}
        onChange={async (v) => {
          const a = await import('@tauri-apps/plugin-autostart');
          if (v) await a.enable();
          else await a.disable();
          setOn(v);
        }}
      />
    </Row>
  );
}

// ---- Places ------------------------------------------------------------------------------

export function PlaceSearch({ onPick }: { onPick: (g: GeoResult) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<GeoResult[]>([]);
  useEffect(() => {
    const t = setTimeout(() => void searchCity(q).then(setRes).catch(() => setRes([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <input className="input" placeholder="Search city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            const p = await currentPosition();
            if (p) onPick({ name: 'Current location', ...p });
          }}
        >
          <LocateFixed /> Here
        </button>
      </div>
      {res.map((r) => (
        <button key={`${r.lat},${r.lon}`} type="button" className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { onPick(r); setQ(''); setRes([]); }}>
          <MapPin /> {r.name}<span className="faint">{[r.admin, r.country].filter(Boolean).join(', ')}</span>
        </button>
      ))}
    </div>
  );
}

function Places({ s, upd }: { s: Settings; upd: Upd }) {
  const add = (g: GeoResult) => {
    const p: Place = { id: uid(), name: g.name, lat: g.lat, lon: g.lon, country: g.country, kind: s.places.length ? 'other' : 'home' };
    void upd((x) => ({ ...x, places: [...x.places, p], primaryPlaceId: x.primaryPlaceId ?? p.id }));
    void useApp.getState().refresh('weather', true);
  };
  return (
    <Section icon={<MapPin size={18} />} title="Locations" desc="Weather, travel times and hints use your primary location.">
      {s.places.map((p) => (
        <div key={p.id} className="row">
          <button className="btn icon sm ghost" aria-label="Make primary" onClick={() => void upd((x) => ({ ...x, primaryPlaceId: p.id }))}>
            <Star fill={s.primaryPlaceId === p.id ? 'var(--accent)' : 'none'} color={s.primaryPlaceId === p.id ? 'var(--accent)' : 'currentColor'} />
          </button>
          <input className="input grow" value={p.name} onChange={(e) => void upd((x) => ({ ...x, places: x.places.map((q) => (q.id === p.id ? { ...q, name: e.target.value } : q)) }))} />
          <select className="input" style={{ width: 110 }} value={p.kind} onChange={(e) => void upd((x) => ({ ...x, places: x.places.map((q) => (q.id === p.id ? { ...q, kind: e.target.value as Place['kind'] } : q)) }))}>
            <option value="home">Home</option>
            <option value="work">Work</option>
            <option value="other">Other</option>
          </select>
          <button className="btn icon sm ghost" aria-label="Remove" onClick={() => void upd((x) => ({ ...x, places: x.places.filter((q) => q.id !== p.id), primaryPlaceId: x.primaryPlaceId === p.id ? null : x.primaryPlaceId }))}><Trash2 /></button>
        </div>
      ))}
      <PlaceSearch onPick={add} />
    </Section>
  );
}

// ---- Calendars ---------------------------------------------------------------------------

const CAL_COLORS = ['#c6f432', '#9d8cf9', '#2dd4bf', '#fb923c', '#60a5fa', '#f2555a'];

function Calendars({ s, upd }: { s: Settings; upd: Upd }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const setCal = (id: string, patch: Partial<CalendarFeed>) => void upd((x) => ({ ...x, calendars: x.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  return (
    <Section icon={<CalendarDays size={18} />} title="Calendars" desc="Private iCal links — read-only, no account login needed.">
      {platform() === 'ios' && (
        <Row label="iPhone calendars" hint="All accounts added in iOS Settings (iCloud, Google, Outlook/Exchange)">
          <Switch checked={s.useDeviceCalendars} onChange={(v) => void upd((x) => ({ ...x, useDeviceCalendars: v }))} />
        </Row>
      )}
      {s.calendars.map((c) => (
        <div key={c.id} className="row">
          <input type="color" value={c.color} onChange={(e) => setCal(c.id, { color: e.target.value })} style={{ width: 30, height: 30, border: 0, background: 'none' }} aria-label="Colour" />
          <input className="input" style={{ width: 160 }} value={c.name} onChange={(e) => setCal(c.id, { name: e.target.value })} />
          <input className="input grow" type="password" value={c.url} onChange={(e) => setCal(c.id, { url: e.target.value })} aria-label="iCal URL" />
          <Switch checked={c.enabled} onChange={(v) => setCal(c.id, { enabled: v })} />
          <button className="btn icon sm ghost" aria-label="Remove" onClick={() => void upd((x) => ({ ...x, calendars: x.calendars.filter((y) => y.id !== c.id) }))}><Trash2 /></button>
        </div>
      ))}
      <form
        className="row"
        style={{ flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!url) return;
          void upd((x) => ({ ...x, calendars: [...x.calendars, { id: uid(), name: name || 'Calendar', url: url.trim(), color: CAL_COLORS[x.calendars.length % CAL_COLORS.length], enabled: true }] }));
          setName('');
          setUrl('');
          void useApp.getState().refresh('calendar', true);
        }}
      >
        <input className="input" style={{ width: 160 }} placeholder="Name (e.g. Work)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input grow" placeholder="https://… .ics  or  webcal://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" type="submit"><Plus /> Add</button>
      </form>
      <details className="small muted">
        <summary style={{ cursor: 'pointer' }}>Where do I find the iCal link?</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>Google:</b> Calendar settings → your calendar → “Secret address in iCal format”.</li>
          <li><b>Outlook / Microsoft 365:</b> Settings → Calendar → Shared calendars → Publish a calendar → “Can view all details” → copy the ICS link.</li>
          <li><b>iCloud:</b> Calendar app → share icon next to the calendar → “Public Calendar” → copy link (webcal://…). On iPhone, simply use “iPhone calendars”.</li>
        </ul>
      </details>
    </Section>
  );
}

// ---- Fitness -----------------------------------------------------------------------------

function Fitness({ s, upd }: { s: Settings; upd: Upd }) {
  const set = (patch: Partial<Settings['fitness']>) => void upd((x) => ({ ...x, fitness: { ...x.fitness, ...patch } }));
  return (
    <Section icon={<HeartPulse size={18} />} title="Fitness & wearables" desc="Connect once — everything then syncs automatically in the background.">
      <GarminConnect enabled={s.fitness.garmin} onEnabled={(v) => set({ garmin: v })} />
      <hr className="sep" />
      <WhoopConnect enabled={s.fitness.whoop} onEnabled={(v) => set({ whoop: v })} />
      <hr className="sep" />
      <Row label="Apple Health" hint={platform() === 'ios' ? 'Garmin Connect & WHOOP write here — enable “Apple Health” in both apps' : 'iPhone only'}>
        <Switch checked={s.fitness.appleHealth} onChange={(v) => set({ appleHealth: v })} />
      </Row>
      <hr className="sep" />
      <Row label="Daily step goal"><input className="input" type="number" style={{ width: 120 }} value={s.fitness.stepGoal} onChange={(e) => set({ stepGoal: Number(e.target.value) || 0 })} /></Row>
      <Row label="Sleep goal (hours)"><input className="input" type="number" step={0.25} style={{ width: 120 }} value={s.fitness.sleepGoalMin / 60} onChange={(e) => set({ sleepGoalMin: Math.round((Number(e.target.value) || 8) * 60) })} /></Row>
    </Section>
  );
}

function GarminConnect({ enabled, onEnabled }: { enabled: boolean; onEnabled: (v: boolean) => void }) {
  const [st, setSt] = useState<{ connected: boolean; displayName: string | null } | null>(null);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mfa, setMfa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const avail = garmin.available();
  useEffect(() => {
    if (avail) void garmin.status().then(setSt).catch(() => setSt(null));
  }, [avail]);
  if (!avail) return <Row label="Garmin Connect" hint="On iPhone, Garmin data arrives via Apple Health (below). Direct sync runs in the Windows app."><span className="chip">via Apple Health</span></Row>;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = (await fn()) as { status?: string } | undefined;
      if (r?.status === 'mfa_required') setMfa('');
      else {
        setMfa(null);
        setPw('');
        setSt(await garmin.status());
        onEnabled(true);
        void useApp.getState().refresh('fitness', true);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <Row label="Garmin Connect" hint={st?.connected ? `Connected as ${st.displayName}` : 'Sign in once; the password is not stored — only a refresh token in Credential Manager'}>
        {st?.connected ? (
          <div className="row">
            <Switch checked={enabled} onChange={onEnabled} />
            <button className="btn sm" onClick={async () => { await garmin.logout(); setSt(await garmin.status()); onEnabled(false); }}>Disconnect</button>
          </div>
        ) : null}
      </Row>
      {!st?.connected && mfa === null && (
        <form className="row" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void run(() => garmin.login(email, pw)); }}>
          <input className="input grow" type="email" placeholder="Garmin email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <input className="input grow" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          <button className="btn primary" disabled={busy || !email || !pw}>{busy ? <Loader2 className="spin" /> : null} Connect</button>
        </form>
      )}
      {mfa !== null && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => garmin.submitMfa(mfa)); }}>
          <input className="input grow" inputMode="numeric" placeholder="Code from Garmin (email / app)" value={mfa} onChange={(e) => setMfa(e.target.value)} />
          <button className="btn primary" disabled={busy || !mfa}>Verify</button>
        </form>
      )}
      {err && <p className="small c-bad">{err}</p>}
    </div>
  );
}

function WhoopConnect({ enabled, onEnabled }: { enabled: boolean; onEnabled: (v: boolean) => void }) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void whoop.connected().then(setConnected);
  }, []);
  return (
    <div className="col" style={{ gap: 10 }}>
      <Row label="WHOOP" hint={connected ? 'Connected — recovery, strain, sleep, HRV, workouts' : 'Official WHOOP API. Create a free app at developer-dashboard.whoop.com'}>
        {connected ? (
          <div className="row">
            <Switch checked={enabled} onChange={onEnabled} />
            <button className="btn sm" onClick={async () => { await whoop.disconnect(); setConnected(false); onEnabled(false); }}>Disconnect</button>
          </div>
        ) : null}
      </Row>
      {!connected && (
        <>
          <SecretField name="whoop-client-id" label="Client ID" />
          <SecretField name="whoop-client-secret" label="Client secret" />
          <p className="small faint">
            Redirect URI to register: <code className="kbd">{redirectUri()}</code>
          </p>
          <button
            className="btn primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await whoop.connect();
                setConnected(true);
                onEnabled(true);
                void useApp.getState().refresh('fitness', true);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="spin" />} Connect WHOOP
          </button>
          {err && <p className="small c-bad">{err}</p>}
        </>
      )}
    </div>
  );
}

// ---- Nutrition ---------------------------------------------------------------------------

const PROVIDERS: Array<{ label: string; endpoint: string; model: string; note: string }> = [
  { label: 'Ollama (local, offline)', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b', note: 'Runs on your PC — photos never leave the device. Install Ollama, then `ollama pull qwen2.5vl:7b`.' },
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: '', note: 'Use any current vision-capable model and your own API key.' },
  { label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', note: 'OpenAI-compatible endpoint, your own Gemini API key.' },
];

function Nutrition({ s, upd }: { s: Settings; upd: Upd }) {
  const n = s.nutrition;
  const set = (patch: Partial<Settings['nutrition']>) => void upd((x) => ({ ...x, nutrition: { ...x.nutrition, ...patch } }));
  const g = computeGoals(n);
  return (
    <Section icon={<Utensils size={18} />} title="Nutrition" desc={`Daily target: ${g.kcal} kcal · P ${g.protein} g · C ${g.carbs} g · F ${g.fat} g`}>
      <div className="grid g-3" style={{ gap: 10 }}>
        <label className="field">Sex<select className="input" value={n.sex} onChange={(e) => set({ sex: e.target.value as 'male' | 'female' })}><option value="male">Male</option><option value="female">Female</option></select></label>
        <label className="field">Age<input className="input" type="number" value={n.age} onChange={(e) => set({ age: Number(e.target.value) || 0 })} /></label>
        <label className="field">Height (cm)<input className="input" type="number" value={n.heightCm} onChange={(e) => set({ heightCm: Number(e.target.value) || 0 })} /></label>
        <label className="field">Weight (kg)<input className="input" type="number" step={0.1} value={n.weightKg} onChange={(e) => set({ weightKg: Number(e.target.value) || 0 })} /></label>
        <label className="field">Activity
          <select className="input" value={n.activity} onChange={(e) => set({ activity: Number(e.target.value) as Settings['nutrition']['activity'] })}>
            <option value={1.2}>Sedentary</option><option value={1.375}>Light</option><option value={1.55}>Moderate</option><option value={1.725}>Very active</option><option value={1.9}>Athlete</option>
          </select>
        </label>
        <label className="field">Goal
          <select className="input" value={n.goal} onChange={(e) => set({ goal: e.target.value as Settings['nutrition']['goal'] })}>
            <option value="lose">Lose weight</option><option value="maintain">Maintain</option><option value="gain">Gain weight</option>
          </select>
        </label>
        <label className="field">Custom kcal target<input className="input" type="number" placeholder="auto" value={n.kcalOverride ?? ''} onChange={(e) => set({ kcalOverride: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="field">Water goal (ml)<input className="input" type="number" step={250} value={n.waterGoalMl} onChange={(e) => set({ waterGoalMl: Number(e.target.value) || 0 })} /></label>
      </div>
      <hr className="sep" />
      <Row label="Photo recognition" hint="Your own key or a local model. Never Claude, never a server of ours.">
        <Seg value={n.provider} onChange={(v) => set({ provider: v })} options={[['none', 'Off'], ['openai-compatible', 'On']]} />
      </Row>
      {n.provider !== 'none' && (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {PROVIDERS.map((p) => (
              <button key={p.label} className={`chip ${n.endpoint === p.endpoint ? 'on' : ''}`} onClick={() => set({ endpoint: p.endpoint, model: p.model || n.model })}>{p.label}</button>
            ))}
          </div>
          <p className="small faint">{PROVIDERS.find((p) => p.endpoint === n.endpoint)?.note ?? 'Any OpenAI-compatible /chat/completions endpoint with vision support.'}</p>
          <label className="field">Endpoint<input className="input" value={n.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></label>
          <label className="field">Vision model<input className="input" placeholder="model name" value={n.model} onChange={(e) => set({ model: e.target.value })} /></label>
          <SecretField name="food-api-key" label="API key (not needed for local Ollama)" />
        </>
      )}
    </Section>
  );
}

// ---- News --------------------------------------------------------------------------------

function News({ s, upd }: { s: Settings; upd: Upd }) {
  const n = s.news;
  const set = (patch: Partial<Settings['news']>) => {
    void upd((x) => ({ ...x, news: { ...x.news, ...patch } }));
  };
  const [feedUrl, setFeedUrl] = useState('');
  const [kw, setKw] = useState('');
  return (
    <Section icon={<Newspaper size={18} />} title="News" desc="Interest profile, sources and keywords.">
      <div>
        <div className="small muted" style={{ marginBottom: 8 }}>Interests</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {NEWS_TOPICS.map((t) => (
            <button key={t} className={`chip ${n.interests.includes(t) ? 'on' : ''}`} onClick={() => set({ interests: n.interests.includes(t) ? n.interests.filter((x) => x !== t) : [...n.interests, t] })} style={{ textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <Row label="Local region" hint="Used for local news via Google News RSS"><input className="input" style={{ width: 220 }} placeholder="e.g. Hamburg" value={n.region} onChange={(e) => set({ region: e.target.value })} /></Row>
      <Row label="Language"><Seg value={n.language} onChange={(v) => set({ language: v })} options={[['en', 'English'], ['de', 'Deutsch']]} /></Row>
      <div>
        <div className="small muted" style={{ marginBottom: 8 }}>Keywords to follow (boosted & always shown)</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {n.keywords.map((k) => (
            <button key={k} className="chip on" onClick={() => set({ keywords: n.keywords.filter((x) => x !== k) })}>{k} ×</button>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); if (kw.trim()) set({ keywords: [...n.keywords, kw.trim()] }); setKw(''); }}>
            <input className="input" style={{ width: 170, height: 28 }} placeholder="+ keyword" value={kw} onChange={(e) => setKw(e.target.value)} />
          </form>
        </div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <div className="small muted">Sources</div>
        {n.feeds.map((f) => (
          <div key={f.id} className="row small">
            <Switch checked={f.enabled} onChange={(v) => set({ feeds: n.feeds.map((x) => (x.id === f.id ? { ...x, enabled: v } : x)) })} />
            <span className="grow ellipsis">{f.title}</span>
            <span className="chip" style={{ textTransform: 'capitalize' }}>{f.topic}</span>
            {!f.id.startsWith('preset') && <button className="btn icon sm ghost" aria-label="Remove" onClick={() => set({ feeds: n.feeds.filter((x) => x.id !== f.id) })}><Trash2 /></button>}
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!feedUrl) return; set({ feeds: [...n.feeds, { id: uid(), title: new URL(feedUrl).host, url: feedUrl, topic: 'custom', enabled: true }] }); setFeedUrl(''); }}>
          <input className="input grow" placeholder="Add RSS/Atom feed URL" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} />
          <button className="btn"><Plus /> Add</button>
        </form>
      </div>
      <Row label="GNews API (optional)" hint="Adds curated top headlines — free key at gnews.io"><Switch checked={n.useGNews} onChange={(v) => set({ useGNews: v })} /></Row>
      {n.useGNews && <SecretField name="gnews-key" label="GNews API key" />}
    </Section>
  );
}

// ---- Notifications & privacy -------------------------------------------------------------

function Notifications() {
  const [state, setState] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  return (
    <Section icon={<Bell size={18} />} title="Notifications" desc="Morning briefing and event alerts are set in the Calendar tab.">
      <Row label="Allow notifications" hint={state === 'denied' ? 'Blocked — enable in system settings' : undefined}>
        <button className="btn" onClick={async () => setState((await ensureNotificationPermission()) ? 'granted' : 'denied')}>
          {state === 'granted' ? <><Check /> Allowed</> : 'Request permission'}
        </button>
      </Row>
    </Section>
  );
}

function Privacy() {
  return (
    <Section icon={<Shield size={18} />} title="Privacy & data" desc="No analytics, no tracking, no account. All data is AES-256-GCM encrypted at rest; the key lives in the OS keystore.">
      <Row label="Export my data" hint="Decrypted JSON — your right to data portability (GDPR Art. 20)">
        <button
          className="btn"
          onClick={async () => {
            const all = Object.fromEntries(await db.getMany(''));
            const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `lifedash-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
          }}
        >
          <Download /> Export
        </button>
      </Row>
      <Row label="Delete everything" hint="Erases all local data, keys and tokens (GDPR Art. 17)">
        <button
          className="btn danger"
          onClick={async () => {
            if (!confirm('Delete ALL local data, API keys and connections? This cannot be undone.')) return;
            await db.wipe();
            for (const k of ['whoop-tokens', 'whoop-client-id', 'whoop-client-secret', 'food-api-key', 'gnews-key']) await setSecret(k, null);
            if (garmin.available()) await garmin.logout().catch(() => undefined);
            location.reload();
          }}
        >
          <KeyRound /> Delete all data
        </button>
      </Row>
    </Section>
  );
}
