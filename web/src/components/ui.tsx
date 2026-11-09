import { useEffect, useState, type ReactNode } from 'react';
import { api, type Filters } from '../api';

export function useApi<T>(path: string | null, filters?: Filters) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const key = path ? `${path}|${filters?.from}|${filters?.to}|${filters?.platform}|${filters?.source}|${filters?.country}` : null;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path, filters ? { from: filters.from, to: filters.to, platform: filters.platform, source: filters.source, country: filters.country } : undefined)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: Error) => !cancelled && setState({ data: null, error: e.message, loading: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

export function Loadable<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error) return <p className="error">Could not load: {state.error}</p>;
  if (state.loading || !state.data) return <p className="muted">Loading…</p>;
  return <>{children(state.data)}</>;
}

export function Tile({
  label,
  value,
  meta,
  status,
  unreliable,
}: {
  label: string;
  value: string;
  meta?: ReactNode;
  status?: 'good' | 'bad' | null;
  unreliable?: boolean;
}) {
  return (
    <div className={`card tile${unreliable ? ' unreliable' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {(meta || status) && (
        <div className="meta">
          {status === 'good' && <span className="badge good"><span className="dot good" />On target</span>}
          {status === 'bad' && <span className="badge bad"><span className="dot bad" />Below target</span>}
          {meta}
        </div>
      )}
    </div>
  );
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  );
}

export function vsTarget(value: number | null | undefined, target: number | null | undefined, reliable = true) {
  if (value == null || target == null || !reliable) return null;
  return value >= target ? 'good' : 'bad';
}
