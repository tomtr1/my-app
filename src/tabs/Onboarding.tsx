import { useState } from 'react';
import { ArrowRight, Check, MapPin } from 'lucide-react';
import { useApp } from '../store/app';
import { PlaceSearch } from './Settings';
import { uid } from '../lib/num';
import { ensureNotificationPermission } from '../platform/notify';
import type { GeoResult } from '../lib/geo';

export function Onboarding() {
  const { updateSettings, refreshAll } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [home, setHome] = useState<GeoResult | null>(null);

  const finish = async () => {
    await updateSettings((s) => {
      const p = home ? { id: uid(), name: home.name, lat: home.lat, lon: home.lon, country: home.country, kind: 'home' as const } : null;
      return { ...s, name: name.trim(), onboarded: true, places: p ? [p] : s.places, primaryPlaceId: p?.id ?? s.primaryPlaceId };
    });
    void refreshAll(true);
    void ensureNotificationPermission().catch(() => false);
  };

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(460px, 100%)', padding: 28 }}>
        <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 20, marginBottom: 18 }}>L</div>
        {step === 0 && (
          <form className="col" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); setStep(1); }}>
            <h1 style={{ fontSize: 26 }}>Welcome to <span className="c-accent">Lifedash</span></h1>
            <p className="muted">Your whole day in one calm place. Everything stays on this device — no account, no cloud.</p>
            <label className="field">What should we call you?<input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" /></label>
            <button className="btn primary">Continue <ArrowRight /></button>
          </form>
        )}
        {step === 1 && (
          <div className="col" style={{ gap: 16 }}>
            <h1 style={{ fontSize: 24 }}>Where’s home?</h1>
            <p className="muted">For weather, rain alerts and travel times to your appointments.</p>
            {home ? (
              <div className="row card tight"><MapPin size={16} color="var(--accent)" /><b className="grow">{home.name}</b><button className="btn sm ghost" onClick={() => setHome(null)}>Change</button></div>
            ) : (
              <PlaceSearch onPick={setHome} />
            )}
            <div className="row">
              <button className="btn ghost" onClick={() => setStep(2)}>Skip</button>
              <button className="btn primary grow" disabled={!home} onClick={() => setStep(2)}>Continue <ArrowRight /></button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="col" style={{ gap: 16 }}>
            <h1 style={{ fontSize: 24 }}>You’re set{name ? `, ${name}` : ''}.</h1>
            <p className="muted">Next, in Settings you can connect:</p>
            <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Garmin, WHOOP or Apple Health</li>
              <li>Google / Outlook / iCloud calendars</li>
              <li>News interests and a food-photo model</li>
            </ul>
            <button className="btn primary" onClick={() => void finish()}><Check /> Open my dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
}
