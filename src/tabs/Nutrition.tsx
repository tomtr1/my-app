import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Droplets, Loader2, Minus, Plus, ScanBarcode, Search, Trash2, PenLine, Utensils, Check } from 'lucide-react';
import { useApp } from '../store/app';
import { Bar, Card, Empty, Ring, Seg, Sheet } from '../ui/kit';
import { BarChart } from '../ui/charts';
import {
  computeGoals, downscale, lookupBarcode, recognizeMeal, scale, searchFoods, suggestMeal, sumMacros,
  type DiaryEntry, type FoodCandidate, type Macros, type Meal, type RecognizedItem,
} from '../services/nutrition';
import { addDays, fmtDay, fmtTime, fmtWeekday, lastNDays, parseYmd, ymd } from '../lib/dates';
import { fmtInt, uid } from '../lib/num';
import { db } from '../platform/storage';

const MEALS: Array<[Meal, string]> = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['snack', 'Snacks'],
];

export function NutritionTab() {
  const { settings, diary, water, loadDay, removeDiary, addWater, sheet, setSheet } = useApp();
  const [date, setDate] = useState(ymd());
  const [meal, setMeal] = useState<Meal>(suggestMeal());
  const [week, setWeek] = useState<Record<string, number>>({});
  const goals = computeGoals(settings.nutrition);
  const entries = diary[date] ?? [];
  const total = sumMacros(entries);
  const ml = water[date] ?? 0;

  useEffect(() => {
    if (!(date in diary)) void loadDay(date);
  }, [date, diary, loadDay]);

  // 7-day kcal overview (read straight from storage)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, number> = {};
      for (const d of lastNDays(7, parseYmd(date))) out[d] = sumMacros((await db.get<DiaryEntry[]>(`diary:${d}`)) ?? []).kcal;
      if (alive) setWeek(out);
    })();
    return () => {
      alive = false;
    };
  }, [date, entries.length]);

  const left = goals.kcal - total.kcal;
  const isToday = date === ymd();
  const glasses = Math.ceil(goals.waterMl / 250);

  return (
    <div className="page">
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <div className="page-head">
          <h1>Nutrition</h1>
          <p>
            Goal: {settings.nutrition.goal === 'lose' ? 'lose weight' : settings.nutrition.goal === 'gain' ? 'gain weight' : 'maintain'} · {fmtInt(goals.kcal)} kcal
          </p>
        </div>
        <div className="row">
          <button className="btn icon" onClick={() => setDate(ymd(addDays(parseYmd(date), -1)))} aria-label="Previous day"><ChevronLeft /></button>
          <b style={{ minWidth: 120, textAlign: 'center' }}>{isToday ? 'Today' : fmtDay(parseYmd(date))}</b>
          <button className="btn icon" disabled={isToday} onClick={() => setDate(ymd(addDays(parseYmd(date), 1)))} aria-label="Next day"><ChevronRight /></button>
          <button className="btn primary" onClick={() => setSheet('add-food')}><Camera /> Add food</button>
        </div>
      </div>

      <div className="grid g-main">
        <Card className="hl">
          <div className="row" style={{ gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
            <div className="col" style={{ alignItems: 'center', gap: 2 }}>
              <span className="tabular" style={{ fontSize: 22, fontWeight: 700 }}>{fmtInt(total.kcal)}</span>
              <span className="tiny faint">eaten</span>
            </div>
            <Ring value={total.kcal} max={goals.kcal} size={150} stroke={12} color={left < 0 ? 'var(--bad)' : 'var(--orange)'} label="Calories">
              <div style={{ textAlign: 'center' }}>
                <div className="tabular" style={{ fontSize: 30 }}>{fmtInt(Math.abs(left))}</div>
                <div className="caps" style={{ fontSize: 9 }}>{left < 0 ? 'kcal over' : 'kcal left'}</div>
              </div>
            </Ring>
            <div className="col" style={{ alignItems: 'center', gap: 2 }}>
              <span className="tabular" style={{ fontSize: 22, fontWeight: 700 }}>{fmtInt(goals.kcal)}</span>
              <span className="tiny faint">goal</span>
            </div>
          </div>
          <div className="grid g-3" style={{ marginTop: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <Macro label="Protein" v={total.protein} goal={goals.protein} color="var(--teal)" />
            <Macro label="Carbs" v={total.carbs} goal={goals.carbs} color="var(--blue)" />
            <Macro label="Fat" v={total.fat} goal={goals.fat} color="var(--violet)" />
          </div>
        </Card>

        <Card title="Water" action={<span className="small tabular faint">{(ml / 1000).toFixed(2)} / {(goals.waterMl / 1000).toFixed(1)} L</span>}>
          <div className="col" style={{ gap: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Array.from({ length: glasses }, (_, i) => (
                <button
                  key={i}
                  onClick={() => void addWater(i < Math.round(ml / 250) ? -250 : 250, date)}
                  aria-label={`Glass ${i + 1}`}
                  style={{
                    width: 34, height: 42, borderRadius: '6px 6px 10px 10px', cursor: 'pointer',
                    border: '1px solid var(--border)', background: i < Math.round(ml / 250) ? 'var(--blue)' : 'var(--surface-2)',
                    display: 'grid', placeItems: 'center', color: i < Math.round(ml / 250) ? '#fff' : 'var(--text-3)',
                  }}
                >
                  <Droplets size={14} />
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => void addWater(-250, date)}><Minus /> 250</button>
              <button className="btn sm" onClick={() => void addWater(250, date)}><Plus /> 250 ml</button>
              <button className="btn sm" onClick={() => void addWater(500, date)}><Plus /> 500 ml</button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-2">
        {MEALS.map(([key, label]) => {
          const list = entries.filter((e) => e.meal === key);
          const m = sumMacros(list);
          return (
            <Card
              key={key}
              title={label}
              action={
                <div className="row">
                  <span className="small tabular faint">{fmtInt(m.kcal)} kcal</span>
                  <button className="btn icon sm" aria-label={`Add to ${label}`} onClick={() => { setMeal(key); setSheet('add-food'); }}><Plus /></button>
                </div>
              }
            >
              {list.length ? (
                <div className="list">
                  {list.map((e) => (
                    <div key={e.id} className="li">
                      {e.thumb ? <img className="thumb" src={e.thumb} alt="" /> : <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}><Utensils size={16} /></div>}
                      <div className="grow">
                        <div className="ellipsis" style={{ fontWeight: 550 }}>{e.name}</div>
                        <div className="tiny faint tabular">
                          {e.grams} g · P {e.protein} · C {e.carbs} · F {e.fat} · {fmtTime(new Date(e.time))}
                        </div>
                      </div>
                      <b className="tabular small">{fmtInt(e.kcal)}</b>
                      <button className="btn icon sm ghost" aria-label="Delete" onClick={() => void removeDiary(date, e.id)}><Trash2 /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small faint">Nothing logged.</p>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Last 7 days">
        <BarChart
          data={Object.entries(week).map(([d, v]) => ({ label: fmtWeekday(parseYmd(d)), value: v || undefined, tip: `${fmtDay(parseYmd(d))}: ${fmtInt(v)} kcal` }))}
          goal={goals.kcal}
          color="var(--orange)"
          highlightLast
        />
      </Card>

      <AddFoodSheet open={sheet === 'add-food'} onClose={() => setSheet(null)} date={date} meal={meal} setMeal={setMeal} />
    </div>
  );
}

function Macro({ label, v, goal, color }: { label: string; v: number; goal: number; color: string }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="spread small">
        <span className="muted">{label}</span>
        <span className="tabular"><b>{Math.round(v)}</b><span className="faint">/{goal} g</span></span>
      </div>
      <Bar value={v} max={goal} color={color} />
    </div>
  );
}

// ---- Add food ----------------------------------------------------------------------------

type Mode = 'photo' | 'barcode' | 'search' | 'manual';

function AddFoodSheet(p: { open: boolean; onClose: () => void; date: string; meal: Meal; setMeal: (m: Meal) => void }) {
  const [mode, setMode] = useState<Mode>('photo');
  const { addDiary } = useApp();
  const time = p.date === ymd() ? Date.now() : parseYmd(p.date).getTime() + 12 * 3_600_000;

  const add = async (name: string, grams: number, m: Macros, source: DiaryEntry['source'], thumb?: string) => {
    await addDiary({ id: uid(), time, meal: p.meal, name, grams, ...m, source, thumb });
  };

  return (
    <Sheet open={p.open} onClose={p.onClose} title="Add food">
      <div className="col" style={{ gap: 14 }}>
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <Seg value={mode} onChange={setMode} options={[['photo', 'Photo'], ['barcode', 'Barcode'], ['search', 'Search'], ['manual', 'Manual']]} />
          <select className="input" style={{ width: 130 }} value={p.meal} onChange={(e) => p.setMeal(e.target.value as Meal)}>
            {MEALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {mode === 'photo' && <PhotoAdd onAdd={add} onDone={p.onClose} />}
        {mode === 'barcode' && <BarcodeAdd onAdd={add} onDone={p.onClose} />}
        {mode === 'search' && <SearchAdd onAdd={add} onDone={p.onClose} />}
        {mode === 'manual' && <ManualAdd onAdd={add} onDone={p.onClose} />}
      </div>
    </Sheet>
  );
}

type AddFn = (name: string, grams: number, m: Macros, source: DiaryEntry['source'], thumb?: string) => Promise<void>;

function PhotoAdd({ onAdd, onDone }: { onAdd: AddFn; onDone: () => void }) {
  const { settings } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<RecognizedItem[]>([]);

  const onFile = async (f: File) => {
    setErr(null);
    setItems([]);
    const raw = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(f);
    });
    const small = await downscale(raw, 1024, 0.82);
    setImg(small);
    setBusy(true);
    try {
      const found = await recognizeMeal(small, settings.nutrition);
      if (!found.length) setErr('No food recognised — try another angle, or use Search.');
      setItems(found);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = sumMacros(items.map((i) => scale(i.per100, i.grams)));

  return (
    <div className="col" style={{ gap: 14 }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
      {!img ? (
        <button className="card" style={{ cursor: 'pointer', padding: 32, borderStyle: 'dashed' }} onClick={() => fileRef.current?.click()}>
          <Empty
            icon={<Camera />}
            title="Take a photo of your meal"
            body={settings.nutrition.provider === 'none' ? 'Set up a recognition provider in Settings → Nutrition (your own key, or a local model).' : 'Dishes, portions, calories and macros are estimated — you confirm before saving.'}
          />
        </button>
      ) : (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <img src={img} alt="Meal" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12 }} />
          <div className="col grow">
            {busy && <span className="row muted"><Loader2 className="spin" size={16} /> Analysing…</span>}
            {err && <span className="small c-bad">{err}</span>}
            {!busy && items.length > 0 && (
              <span className="small muted">
                Total ≈ <b className="tabular">{fmtInt(total.kcal)} kcal</b> · P {Math.round(total.protein)} · C {Math.round(total.carbs)} · F {Math.round(total.fat)}
              </span>
            )}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}><Camera /> Retake</button>
          </div>
        </div>
      )}
      {items.map((it, i) => {
        const m = scale(it.per100, it.grams);
        return (
          <div key={i} className="card tight col" style={{ gap: 8 }}>
            <div className="spread">
              <input className="input" value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button className="btn icon sm ghost" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 /></button>
            </div>
            <div className="row">
              <input type="range" min={10} max={Math.max(800, it.grams * 2)} step={5} value={it.grams} className="grow" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, grams: Number(e.target.value) } : x)))} />
              <span className="tabular small" style={{ width: 54, textAlign: 'right' }}>{it.grams} g</span>
            </div>
            <div className="tiny faint tabular">
              {fmtInt(m.kcal)} kcal · P {m.protein} · C {m.carbs} · F {m.fat} · confidence {Math.round(it.confidence * 100)} %
            </div>
          </div>
        );
      })}
      {items.length > 0 && (
        <button
          className="btn primary"
          onClick={async () => {
            const thumb = img ? await downscale(img, 160, 0.7) : undefined;
            for (const it of items) await onAdd(it.name, it.grams, scale(it.per100, it.grams), 'photo', thumb);
            onDone();
          }}
        >
          <Check /> Add {items.length} item{items.length > 1 ? 's' : ''} to diary
        </button>
      )}
    </div>
  );
}

function CandidateConfirm({ c, onAdd, onDone, source }: { c: FoodCandidate; onAdd: AddFn; onDone: () => void; source: DiaryEntry['source'] }) {
  const [g, setG] = useState(c.defaultGrams);
  const m = scale(c.per100, g);
  return (
    <div className="card tight col" style={{ gap: 10 }}>
      <div className="row">
        {c.image && <img className="thumb" src={c.image} alt="" />}
        <div className="grow">
          <b>{c.name}</b>
          <div className="tiny faint">{c.brand ?? 'per 100 g'} · {c.per100.kcal} kcal/100 g</div>
        </div>
      </div>
      <div className="row">
        <input className="input" type="number" min={1} value={g} onChange={(e) => setG(Number(e.target.value) || 0)} style={{ width: 100 }} />
        <span className="small faint">g</span>
        <span className="grow small tabular" style={{ textAlign: 'right' }}>
          <b>{fmtInt(m.kcal)} kcal</b> · P {m.protein} · C {m.carbs} · F {m.fat}
        </span>
      </div>
      <button className="btn primary" onClick={async () => { await onAdd(c.brand ? `${c.name} (${c.brand})` : c.name, g, m, source); onDone(); }}>
        <Check /> Add
      </button>
    </div>
  );
}

function BarcodeAdd({ onAdd, onDone }: { onAdd: AddFn; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<FoodCandidate | null>(null);
  const [state, setState] = useState<'idle' | 'scanning' | 'loading' | 'notfound' | 'error'>('idle');

  const lookup = async (c: string) => {
    setState('loading');
    try {
      const r = await lookupBarcode(c);
      setFound(r);
      setState(r ? 'idle' : 'notfound');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    if (state !== 'scanning') return;
    let controls: { stop: () => void } | undefined;
    let cancelled = false;
    void (async () => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (res) => {
          if (res && !cancelled) {
            cancelled = true;
            controls?.stop();
            setCode(res.getText());
            void lookup(res.getText());
          }
        });
      } catch {
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [state]);

  return (
    <div className="col" style={{ gap: 12 }}>
      {state === 'scanning' ? (
        <video ref={videoRef} style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: '4/3', objectFit: 'cover' }} muted playsInline />
      ) : (
        <button className="btn" onClick={() => { setFound(null); setState('scanning'); }}><ScanBarcode /> Scan with camera</button>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (code) void lookup(code); }}>
        <input className="input" inputMode="numeric" placeholder="or type EAN / UPC" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        <button className="btn" type="submit" disabled={!code}>Look up</button>
      </form>
      {state === 'loading' && <span className="row muted small"><Loader2 className="spin" size={14} /> Searching Open Food Facts…</span>}
      {state === 'notfound' && <span className="small c-warn">Product not found in Open Food Facts. Try Search or Manual.</span>}
      {state === 'error' && <span className="small c-bad">Camera or network unavailable.</span>}
      {found && <CandidateConfirm c={found} onAdd={onAdd} onDone={onDone} source="barcode" />}
    </div>
  );
}

function SearchAdd({ onAdd, onDone }: { onAdd: AddFn; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<FoodCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<FoodCandidate | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(async () => {
      setBusy(true);
      setRes(await searchFoods(q));
      setBusy(false);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);
  const list = useMemo(() => res.slice(0, 20), [res]);
  if (pick) return <CandidateConfirm c={pick} onAdd={onAdd} onDone={onDone} source="search" />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <Search size={16} color="var(--text-3)" />
        <input className="input" autoFocus placeholder="e.g. banana, Skyr, pizza" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <Loader2 className="spin" size={16} />}
      </div>
      <div className="list">
        {list.map((c, i) => (
          <button key={`${c.name}-${i}`} className="li" style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }} onClick={() => setPick(c)}>
            {c.image ? <img className="thumb" src={c.image} alt="" /> : <div className="thumb" />}
            <div className="grow">
              <div className="ellipsis">{c.name}</div>
              <div className="tiny faint">{c.brand ?? 'Generic'} · {c.per100.kcal} kcal/100 g</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ManualAdd({ onAdd, onDone }: { onAdd: AddFn; onDone: () => void }) {
  const [f, setF] = useState({ name: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) || 0 });
  return (
    <form className="col" style={{ gap: 10 }} onSubmit={async (e) => { e.preventDefault(); await onAdd(f.name || 'Food', f.grams, { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }, 'manual'); onDone(); }}>
      <label className="field">Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
      <div className="grid g-3" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
        <label className="field">Portion (g)<input className="input" type="number" value={f.grams} onChange={num('grams')} /></label>
        <label className="field">kcal<input className="input" type="number" value={f.kcal} onChange={num('kcal')} /></label>
        <label className="field">Protein (g)<input className="input" type="number" value={f.protein} onChange={num('protein')} /></label>
        <label className="field">Carbs (g)<input className="input" type="number" value={f.carbs} onChange={num('carbs')} /></label>
        <label className="field">Fat (g)<input className="input" type="number" value={f.fat} onChange={num('fat')} /></label>
      </div>
      <button className="btn primary" type="submit"><PenLine /> Add</button>
    </form>
  );
}
