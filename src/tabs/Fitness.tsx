import { useMemo, useState } from 'react';
import { Activity as ActivityIcon, BatteryMedium, Brain, Droplet, Footprints, HeartPulse, Moon, Sparkles, Timer, TrendingUp, Wind, Zap } from 'lucide-react';
import { useApp, selectReadiness } from '../store/app';
import { Card, Empty, Ring, Seg, SourceLine, Stat } from '../ui/kit';
import { BarChart, LineChart, StackBar } from '../ui/charts';
import { weeklyInsights } from '../services/fitness';
import { fmtDuration, fmtTime, fmtWeekday, fmtDay, lastNDays, parseYmd, ymd, relTime } from '../lib/dates';
import { fmtInt } from '../lib/num';

const toneColor = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' } as const;

export function FitnessTab() {
  const st = useApp();
  const { fitness, settings, status, refresh, setTab } = st;
  const [range, setRange] = useState<'7' | '28'>('7');
  const ready = selectReadiness(st);
  const date = ymd();
  const d = fitness?.days[date];
  const lastNight = d?.sleepMin !== undefined ? d : fitness?.days[ymd(new Date(Date.now() - 86_400_000))];
  const n = Number(range);
  const dates = lastNDays(n);
  const series = (key: 'steps' | 'sleepMin' | 'hrvMs' | 'restingHr') => dates.map((x) => fitness?.days[x]?.[key]);
  const insights = useMemo(() => (fitness ? weeklyInsights(fitness.days) : []), [fitness]);
  const label = (x: string) => (n <= 7 ? fmtWeekday(parseYmd(x)) : String(parseYmd(x).getDate()));
  const sources = new Set(Object.values(fitness?.days ?? {}).flatMap((x) => x.sources));
  const anyConnected = settings.fitness.garmin || settings.fitness.whoop || settings.fitness.appleHealth;

  if (!fitness && !status.fitness.loading) {
    return (
      <div className="page">
        <Header />
        <Card>
          <Empty
            icon={<HeartPulse />}
            title={anyConnected ? 'Waiting for first sync' : 'Connect your wearables'}
            body="Garmin (Windows: direct sync · iPhone: via Apple Health), WHOOP (official API) and Apple Health. After connecting, everything syncs in the background."
            action={
              <div className="row">
                <button className="btn primary" onClick={() => setTab('settings')}>Open settings</button>
                <button className="btn" onClick={() => void refresh('fitness', true)}>Sync now</button>
              </div>
            }
          />
          {status.fitness.error && <p className="small c-bad" style={{ textAlign: 'center' }}>{status.fitness.error}</p>}
        </Card>
      </div>
    );
  }

  const hr = fitness?.hrToday ?? [];
  const lastHr = hr[hr.length - 1];

  return (
    <div className="page">
      <Header
        right={
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {[...sources].map((s) => (
              <span key={s} className="chip">{s === 'apple-health' ? 'Apple Health' : s === 'garmin' ? 'Garmin' : 'WHOOP'}</span>
            ))}
            <SourceLine status={status.fitness} onRefresh={() => void refresh('fitness', true)} />
          </div>
        }
      />

      <div className="grid g-main">
        <Card className="hl">
          <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <Ring value={ready?.score ?? 0} size={120} stroke={10} color={ready ? toneColor[ready.tone] : 'var(--text-3)'} label="Recovery">
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 34 }}>{ready?.score ?? '–'}</div>
                <div className="caps" style={{ fontSize: 9 }}>{ready?.source === 'whoop' ? 'WHOOP recovery' : 'readiness'}</div>
              </div>
            </Ring>
            <div className="col grow" style={{ minWidth: 220 }}>
              <div className="row">
                <b style={{ fontSize: 20 }}>{ready?.label ?? 'No data'}</b>
                {ready && <span className={`chip ${ready.tone === 'bad' ? 'bad' : ready.tone === 'warn' ? 'warn' : 'good'}`}>{ready.load}</span>}
              </div>
              {ready && <p className="muted small">{ready.advice}</p>}
              <div className="row small" style={{ gap: 18, flexWrap: 'wrap' }}>
                {d?.strain !== undefined && (
                  <span><span className="faint">Strain</span> <b className="tabular">{d.strain.toFixed(1)}</b></span>
                )}
                {ready?.hrvBaseline && (
                  <span><span className="faint">HRV baseline</span> <b className="tabular">{Math.round(ready.hrvBaseline)} ms</b></span>
                )}
                {ready?.rhrBaseline && (
                  <span><span className="faint">RHR baseline</span> <b className="tabular">{ready.rhrBaseline.toFixed(0)} bpm</b></span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Heart rate today" action={lastHr ? <span className="small faint">last {relTime(lastHr.t)}</span> : undefined}>
          {hr.length ? (
            <div className="col">
              <div className="row" style={{ gap: 18 }}>
                <div>
                  <span className="tabular" style={{ fontSize: 28, fontWeight: 700 }}>{lastHr?.bpm}</span>
                  <span className="faint small"> bpm</span>
                </div>
                <div className="small muted tabular">
                  min {d?.minHr ?? Math.min(...hr.map((x) => x.bpm))} · max {d?.maxHr ?? Math.max(...hr.map((x) => x.bpm))} · resting {d?.restingHr ?? '–'}
                </div>
              </div>
              <LineChart points={hr.map((x) => ({ x: x.t, y: x.bpm }))} color="var(--bad)" height={130} xLabel={(t) => fmtTime(new Date(t))} yFormat={(v) => `${Math.round(v)}`} area />
            </div>
          ) : (
            <Empty icon={<HeartPulse />} title="No heart-rate samples yet today" body="They appear after your watch syncs." />
          )}
        </Card>
      </div>

      <div className="grid g-4">
        <Stat label="Steps" value={fmtInt(d?.steps)} icon={<Footprints size={16} />} color="var(--accent)" sub={`Goal ${fmtInt(settings.fitness.stepGoal)}${d?.distanceM ? ` · ${(d.distanceM / 1000).toFixed(1)} km` : ''}`} />
        <Stat label="Sleep" value={lastNight?.sleepMin !== undefined ? fmtDuration(lastNight.sleepMin) : '–'} icon={<Moon size={16} />} color="var(--violet)" sub={lastNight?.sleepScore !== undefined ? `Score ${Math.round(lastNight.sleepScore)}` : `Goal ${fmtDuration(settings.fitness.sleepGoalMin)}`} />
        <Stat label="HRV" value={d?.hrvMs !== undefined ? Math.round(d.hrvMs) : '–'} unit="ms" icon={<Sparkles size={16} />} color="var(--teal)" sub={ready?.hrvDeltaPct !== undefined ? `${ready.hrvDeltaPct >= 0 ? '+' : ''}${ready.hrvDeltaPct.toFixed(0)} % vs baseline` : 'overnight average'} />
        <Stat label="Resting HR" value={d?.restingHr ?? '–'} unit="bpm" icon={<HeartPulse size={16} />} color="var(--bad)" sub={ready?.rhrDelta !== undefined ? `${ready.rhrDelta >= 0 ? '+' : ''}${ready.rhrDelta.toFixed(1)} vs baseline` : undefined} />
        <Stat label="Body Battery" value={d?.bodyBatteryNow ?? '–'} icon={<BatteryMedium size={16} />} color="var(--blue)" sub={d?.bodyBatteryMax !== undefined ? `High ${d.bodyBatteryMax} · low ${d.bodyBatteryMin}` : 'Garmin'} />
        <Stat label="Stress" value={d?.stressAvg ?? '–'} icon={<Brain size={16} />} color="var(--orange)" sub="Daily average (Garmin)" />
        <Stat label="SpO₂" value={d?.spo2 !== undefined ? Math.round(d.spo2) : '–'} unit="%" icon={<Droplet size={16} />} color="var(--blue)" sub={d?.respiration ? `Respiration ${d.respiration.toFixed(1)} brpm` : undefined} />
        <Stat label="VO₂ max" value={(d?.vo2max ?? Object.values(fitness?.days ?? {}).reverse().find((x) => x.vo2max)?.vo2max) ?? '–'} icon={<Wind size={16} />} color="var(--teal)" sub="ml/kg/min" />
      </div>

      <div className="spread">
        <h2 style={{ fontSize: 17 }}>Trends</h2>
        <Seg value={range} onChange={setRange} options={[['7', '7 days'], ['28', '28 days']]} />
      </div>
      <div className="grid g-2">
        <Card title="Steps">
          <BarChart data={dates.map((x, i) => ({ label: label(x), value: series('steps')[i], tip: `${fmtDay(parseYmd(x))}: ${fmtInt(series('steps')[i])} steps` }))} goal={settings.fitness.stepGoal} highlightLast />
        </Card>
        <Card title="Sleep">
          <BarChart
            data={dates.map((x, i) => {
              const v = series('sleepMin')[i];
              return { label: label(x), value: v !== undefined ? v / 60 : undefined, tip: `${fmtDay(parseYmd(x))}: ${v !== undefined ? fmtDuration(v) : 'no data'}` };
            })}
            goal={settings.fitness.sleepGoalMin / 60}
            color="var(--violet)"
            highlightLast
          />
        </Card>
        <Card title="HRV (ms)">
          <LineChart
            points={dates.flatMap((x, i) => (series('hrvMs')[i] !== undefined ? [{ x: parseYmd(x).getTime(), y: series('hrvMs')[i]! }] : []))}
            color="var(--teal)"
            xLabel={(t) => fmtDay(new Date(t), { day: 'numeric', month: 'short' })}
          />
        </Card>
        <Card title="Resting heart rate (bpm)">
          <LineChart
            points={dates.flatMap((x, i) => (series('restingHr')[i] !== undefined ? [{ x: parseYmd(x).getTime(), y: series('restingHr')[i]! }] : []))}
            color="var(--bad)"
            xLabel={(t) => fmtDay(new Date(t), { day: 'numeric', month: 'short' })}
          />
        </Card>
      </div>

      <div className="grid g-2">
        <Card title="Last night">
          {lastNight?.sleepMin !== undefined ? (
            <div className="col" style={{ gap: 14 }}>
              <div className="spread">
                <div>
                  <span style={{ fontSize: 26, fontWeight: 700 }} className="tabular">{fmtDuration(lastNight.sleepMin)}</span>
                  {lastNight.sleepStart && lastNight.sleepEnd && (
                    <div className="small faint">
                      {fmtTime(new Date(lastNight.sleepStart))} – {fmtTime(new Date(lastNight.sleepEnd))}
                    </div>
                  )}
                </div>
                {lastNight.sleepScore !== undefined && (
                  <Ring value={lastNight.sleepScore} size={54} stroke={5} color="var(--violet)">
                    <span className="small">{Math.round(lastNight.sleepScore)}</span>
                  </Ring>
                )}
              </div>
              {(lastNight.sleepDeepMin || lastNight.sleepRemMin) && (
                <StackBar
                  parts={[
                    { label: `Deep ${fmtDuration(lastNight.sleepDeepMin ?? 0)}`, value: lastNight.sleepDeepMin ?? 0, color: 'var(--violet)' },
                    { label: `REM ${fmtDuration(lastNight.sleepRemMin ?? 0)}`, value: lastNight.sleepRemMin ?? 0, color: 'var(--teal)' },
                    { label: `Light ${fmtDuration(lastNight.sleepLightMin ?? 0)}`, value: lastNight.sleepLightMin ?? 0, color: 'var(--blue)' },
                    { label: `Awake ${fmtDuration(lastNight.sleepAwakeMin ?? 0)}`, value: lastNight.sleepAwakeMin ?? 0, color: 'var(--text-3)' },
                  ]}
                />
              )}
            </div>
          ) : (
            <Empty icon={<Moon />} title="No sleep recorded" />
          )}
        </Card>
        <Card title="Insights">
          {insights.length ? (
            <div className="col" style={{ gap: 8 }}>
              {insights.map((t) => (
                <div key={t} className="hint info">
                  <TrendingUp />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<TrendingUp />} title="Insights need two weeks of data" />
          )}
        </Card>
      </div>

      <Card title="Activities">
        {fitness?.activities.length ? (
          <div className="list">
            {fitness.activities.slice(0, 12).map((a) => (
              <div key={a.id} className="li">
                <div className="empty ico" style={{ width: 36, height: 36, padding: 0, color: 'var(--accent)' }}>
                  <ActivityIcon size={18} />
                </div>
                <div className="grow">
                  <b className="ellipsis" style={{ textTransform: 'capitalize' }}>{a.name.replace(/_/g, ' ')}</b>
                  <div className="tiny faint">
                    {fmtDay(new Date(a.start))} · {fmtTime(new Date(a.start))} · {a.source === 'apple-health' ? 'Apple Health' : a.source}
                  </div>
                </div>
                <div className="row small tabular muted" style={{ gap: 14 }}>
                  <span className="row" style={{ gap: 4 }}><Timer size={13} /> {fmtDuration(a.durationMin)}</span>
                  {a.distanceM ? <span>{(a.distanceM / 1000).toFixed(1)} km</span> : null}
                  {a.kcal ? <span>{fmtInt(a.kcal)} kcal</span> : null}
                  {a.avgHr ? <span className="row" style={{ gap: 4 }}><HeartPulse size={13} /> {Math.round(a.avgHr)}</span> : null}
                  {a.strain ? <span className="row" style={{ gap: 4 }}><Zap size={13} /> {a.strain.toFixed(1)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<ActivityIcon />} title="No activities in the last weeks" />
        )}
      </Card>
      {!!fitness?.errors.length && <p className="small c-warn">{fitness.errors.join(' · ')}</p>}
    </div>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="spread" style={{ flexWrap: 'wrap' }}>
      <div className="page-head">
        <h1>Fitness</h1>
        <p>Recovery, sleep, heart and movement — synced automatically.</p>
      </div>
      {right}
    </div>
  );
}
