import type { Pnl } from '../api';
import { fmt } from '../format';

/** Money in red when negative and green when positive, so a loss is visible at a glance. */
export function Money({ v, digits = 0 }: { v: number | null | undefined; digits?: number }) {
  return <span className={v == null ? undefined : v < 0 ? 'neg' : v > 0 ? 'pos' : undefined}>{fmt.usd(v, digits)}</span>;
}

export function Roas({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="muted">–</span>;
  return <span className={v < 1 ? 'neg' : 'pos'}>{fmt.pct(v, 0)}</span>;
}

/** Income columns in green, spend in red, so money in and money out read apart at a glance. */
export function PnlCells({ p }: { p: Pnl }) {
  return (
    <>
      <td className="pos">{fmt.usd(p.ad_revenue_usd, 0)}</td>
      <td className="pos">{fmt.usd(p.iap_revenue_net_usd, 0)}</td>
      <td className="pos">{fmt.usd(p.income_usd, 0)}</td>
      <td className="neg">{fmt.usd(p.spend_usd, 0)}</td>
      <td><strong><Money v={p.profit_usd} /></strong></td>
      <td><Roas v={p.roas} /></td>
      <td>{fmt.usd(p.cpi, 2)}</td>
    </>
  );
}

export const PNL_HEADERS = ['Ads', 'IAP (net)', 'Total income', 'UA spend', 'Net (income − UA)', 'ROAS', 'CPI'];

/**
 * Adds the net (income − UA spend) summed from the first day of the range up to each day.
 * Returns the rows newest first, whatever order they arrive in.
 */
function withRunningNet<T extends Pnl & { date: string }>(rows: T[]): (T & { running_net_usd: number })[] {
  let net = 0;
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      net += r.profit_usd;
      return { ...r, running_net_usd: net };
    })
    .reverse();
}

/** Profit and loss per day, newest first, with a running net and a total row. */
export function DailyPnl({ rows, total, who }: { rows: (Pnl & { date: string })[]; total: Pnl; who: string }) {
  return (
    <>
      <h2 style={{ marginTop: 28 }}>Profit and loss per day</h2>
      <p className="sub">{who}, newest day first. Running net adds up income − UA spend from the first day of the range to that day.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Day</th>{PNL_HEADERS.map((h) => <th key={h}>{h}</th>)}<th>Running net</th></tr>
          </thead>
          <tbody>
            {withRunningNet(rows).map((d) => (
              <tr key={d.date}><td>{d.date}</td><PnlCells p={d} /><td><strong><Money v={d.running_net_usd} /></strong></td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total"><td>Total</td><PnlCells p={total} /><td><Money v={total.profit_usd} /></td></tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
