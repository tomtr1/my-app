import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { relTime } from '../lib/dates';
import type { SourceStatus } from '../store/app';

export function Card(p: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section className={`card ${p.onClick ? 'clickable' : ''} ${p.className ?? ''}`} onClick={p.onClick}>
      {(p.title || p.action) && (
        <div className="card-head">
          {typeof p.title === 'string' ? <h2>{p.title}</h2> : p.title}
          {p.action}
        </div>
      )}
      {p.children}
    </section>
  );
}

export function Stat(p: { label: string; value: ReactNode; unit?: string; icon?: ReactNode; color?: string; sub?: ReactNode; onClick?: () => void }) {
  return (
    <Card className="tight" onClick={p.onClick}>
      <div className="stat">
        <div className="spread">
          <span className="caps">{p.label}</span>
          <span style={{ color: p.color ?? 'var(--text-3)', display: 'flex' }}>{p.icon}</span>
        </div>
        <div className="tabular">
          <span className="v" style={{ color: p.color }}>
            {p.value}
          </span>
          {p.unit && <span className="unit">{p.unit}</span>}
        </div>
        {p.sub && <div className="small muted">{p.sub}</div>}
      </div>
    </Card>
  );
}

export function Bar(p: { value: number; max: number; color?: string; height?: number }) {
  const w = p.max > 0 ? Math.min(100, (p.value / p.max) * 100) : 0;
  return (
    <div className="bar" style={{ height: p.height }} role="meter" aria-valuenow={p.value} aria-valuemin={0} aria-valuemax={p.max}>
      <i style={{ width: `${w}%`, background: p.color ?? 'var(--accent)' }} />
    </div>
  );
}

export function Ring(p: { value: number; max?: number; size?: number; stroke?: number; color?: string; children?: ReactNode; label?: string }) {
  const size = p.size ?? 64;
  const stroke = p.stroke ?? 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, p.value / (p.max ?? 100)));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={p.label ?? `${Math.round(p.value)} of ${p.max ?? 100}`}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={p.color ?? 'var(--accent)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      <div className="ring-label">{p.children}</div>
    </div>
  );
}

export function Empty(p: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{p.icon}</div>
      <h3>{p.title}</h3>
      {p.body && <p className="small">{p.body}</p>}
      {p.action}
    </div>
  );
}

export function Skeleton(p: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: p.h ?? 14, width: p.w ?? '100%', ...p.style }} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row">
          <Skeleton h={36} w={36} />
          <div className="col grow" style={{ gap: 6 }}>
            <Skeleton w="70%" />
            <Skeleton w="40%" h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Seg<T extends string>(p: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {p.options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={p.value === v} className={p.value === v ? 'on' : ''} onClick={() => p.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" aria-label={p.label}>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Sheet(p: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open, p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.open) return null;
  return (
    <div className="backdrop" onClick={p.onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={p.title} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>{p.title}</h2>
          <button className="btn icon sm ghost" onClick={p.onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {p.children}
      </div>
    </div>
  );
}

export function SourceLine(p: { status: SourceStatus; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="row small faint">
      {p.status.error ? <span className="c-bad ellipsis" title={p.status.error}>{p.status.error}</span> : p.status.updatedAt ? <span>Updated {relTime(p.status.updatedAt)}</span> : <span>Not synced yet</span>}
      <button className="btn icon sm ghost" onClick={p.onRefresh} aria-label="Refresh" disabled={p.status.loading}>
        <RefreshCw className={p.status.loading ? 'spin' : ''} />
      </button>
    </div>
  );
}

/** Measures an element's width (for responsive SVG charts). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
