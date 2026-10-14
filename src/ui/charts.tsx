import { useState } from 'react';
import { useWidth } from './kit';

/**
 * Single-series charts. Conventions: thin marks, 4px rounded bar ends anchored to the
 * baseline, 2px lines, recessive grid, hover tooltip on every mark, values in text
 * tokens (never in the series colour). One series per chart → no legend box; the
 * card title names it.
 */

export interface Datum {
  label: string; // x label
  value: number | undefined;
  tip?: string; // tooltip text
}

export function BarChart(p: { data: Datum[]; height?: number; color?: string; goal?: number; format?: (v: number) => string; highlightLast?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = p.height ?? 140;
  const padB = 18;
  const padT = 8;
  const max = Math.max(p.goal ?? 0, ...p.data.map((d) => d.value ?? 0)) * 1.08 || 1;
  const n = p.data.length;
  const slot = width / Math.max(1, n);
  const bw = Math.max(3, Math.min(28, slot * 0.6));
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max);
  const fmt = p.format ?? ((v: number) => Math.round(v).toLocaleString());
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={h} role="img" aria-label="Bar chart">
          <line className="grid-line" x1={0} x2={width} y1={h - padB} y2={h - padB} />
          {p.goal !== undefined && <line x1={0} x2={width} y1={y(p.goal)} y2={y(p.goal)} stroke="var(--text-3)" strokeDasharray="3 4" />}
          {p.data.map((d, i) => {
            const x = i * slot + (slot - bw) / 2;
            const v = d.value ?? 0;
            const top = y(v);
            const bh = Math.max(0, h - padB - top);
            const r = Math.min(4, bw / 2, bh);
            const isLast = p.highlightLast && i === n - 1;
            const fill = d.value === undefined ? 'transparent' : p.color ?? 'var(--accent)';
            const showLabel = n <= 14 || i % Math.ceil(n / 10) === 0 || i === n - 1;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
                {bh > 0 && (
                  <path
                    d={`M${x},${h - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${h - padB} Z`}
                    fill={fill}
                    opacity={hover === null || hover === i ? (isLast || !p.highlightLast ? 1 : 0.55) : 0.3}
                  />
                )}
                {showLabel && (
                  <text className="axis" x={i * slot + slot / 2} y={h - 4} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && p.data[hover] && (
        <div className="tip" style={{ left: hover * slot + slot / 2, top: y(p.data[hover].value ?? 0) }}>
          {p.data[hover].tip ?? (p.data[hover].value !== undefined ? `${p.data[hover].label}: ${fmt(p.data[hover].value!)}` : `${p.data[hover].label}: no data`)}
        </div>
      )}
    </div>
  );
}

export function LineChart(p: {
  points: Array<{ x: number; y: number }>;
  height?: number;
  color?: string;
  xLabel?: (x: number) => string;
  yFormat?: (y: number) => string;
  area?: boolean;
  ticks?: number[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = p.height ?? 160;
  const padB = 18;
  const padT = 10;
  const padL = 28;
  if (!p.points.length) return <div ref={ref} style={{ height: h }} />;
  const xs = p.points.map((d) => d.x);
  const ys = p.points.map((d) => d.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMin = Math.floor(Math.min(...ys) * 0.95);
  const yMax = Math.ceil(Math.max(...ys) * 1.05);
  const sx = (x: number) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (width - padL - 4);
  const sy = (y: number) => padT + (h - padT - padB) * (1 - (y - yMin) / Math.max(1, yMax - yMin));
  const d = p.points.map((pt, i) => `${i ? 'L' : 'M'}${sx(pt.x).toFixed(1)},${sy(pt.y).toFixed(1)}`).join('');
  const color = p.color ?? 'var(--accent)';
  const fmtY = p.yFormat ?? ((v: number) => String(Math.round(v)));
  const yTicks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const onMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < p.points.length; i++) if (Math.abs(sx(p.points[i].x) - mx) < Math.abs(sx(p.points[best].x) - mx)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? p.points[hover] : null;
  return (
    <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg height={h} role="img" aria-label="Line chart">
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={padL} x2={width} y1={sy(t)} y2={sy(t)} opacity={0.6} />
              <text className="axis" x={0} y={sy(t) + 3}>
                {fmtY(t)}
              </text>
            </g>
          ))}
          {p.area && <path d={`${d}L${sx(x1)},${h - padB}L${sx(x0)},${h - padB}Z`} fill={color} opacity={0.08} />}
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {(p.ticks ?? [x0, (x0 + x1) / 2, x1]).map((t) => (
            <text key={t} className="axis" x={sx(t)} y={h - 4} textAnchor="middle">
              {p.xLabel?.(t) ?? t}
            </text>
          ))}
          {hp && (
            <>
              <line x1={sx(hp.x)} x2={sx(hp.x)} y1={padT} y2={h - padB} stroke="var(--text-3)" strokeDasharray="2 3" />
              <circle cx={sx(hp.x)} cy={sy(hp.y)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      {hp && (
        <div className="tip" style={{ left: sx(hp.x), top: sy(hp.y) }}>
          {p.xLabel?.(hp.x)} · {fmtY(hp.y)}
        </div>
      )}
    </div>
  );
}

/** Horizontal stacked bar (sleep stages, macros). Segments separated by 2px surface gaps. */
export function StackBar(p: { parts: Array<{ label: string; value: number; color: string }>; height?: number }) {
  const total = p.parts.reduce((a, b) => a + b.value, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ display: 'flex', gap: 2, height: p.height ?? 10, borderRadius: 999, overflow: 'hidden' }}>
        {p.parts.map((s, i) => (
          <div
            key={s.label}
            title={`${s.label}: ${Math.round(s.value)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, opacity: hover === null || hover === i ? 1 : 0.4, transition: 'opacity .15s' }}
          />
        ))}
      </div>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 14 }}>
        {p.parts.map((s) => (
          <span key={s.label} className="row" style={{ gap: 6 }}>
            <i className="dot" style={{ background: s.color }} />
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
