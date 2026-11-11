const DASH = '–';

export const fmt = {
  int(v: number | null | undefined) {
    return v == null ? DASH : Math.round(v).toLocaleString('en-US');
  },
  num(v: number | null | undefined, digits = 1) {
    return v == null ? DASH : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  pct(v: number | null | undefined, digits = 1) {
    return v == null ? DASH : `${(v * 100).toFixed(digits)}%`;
  },
  usd(v: number | null | undefined, digits?: number) {
    if (v == null) return DASH;
    const d = digits ?? (Math.abs(v) < 1 ? 3 : Math.abs(v) < 100 ? 2 : 0);
    const text = `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    // A loss reads −$141, not $-141; a value that rounds to zero gets no sign.
    return v < 0 && /[1-9]/.test(text) ? `−${text}` : text;
  },
  min(v: number | null | undefined) {
    return v == null ? DASH : `${v.toFixed(1)} min`;
  },
};

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDate(d);
}

export function daysBefore(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}
