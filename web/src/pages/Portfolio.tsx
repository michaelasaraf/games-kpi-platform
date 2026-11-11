import type { DayStat, Filters, Pnl, ProfitResponse } from '../api';
import { Loadable, useApi, vsTarget } from '../components/ui';
import { fmt } from '../format';
import { Compare, gameColor } from './Compare';
import { Money, Roas, UA_NOTE } from './Ua';

interface Row {
  game_id: string;
  name: string;
  engine: string;
  targets: { d1: number; d7: number };
  avg_dau: number | null;
  installs: number;
  d1: DayStat & { reliable: boolean };
  d7: DayStat & { reliable: boolean };
  playtime_min_per_dau: number | null;
  arpdau: number | null;
  ltv_d7: DayStat & { reliable: boolean };
  revenue_usd: number;
}

function Ret({ stat, target }: { stat: Row['d1']; target: number }) {
  const status = vsTarget(stat.retention, target, stat.reliable);
  return (
    <span className={stat.reliable ? undefined : 'muted'} title={stat.reliable ? undefined : `Only ${stat.players} installs: not reliable yet`}>
      {status && <span className={`dot ${status}`} style={{ marginRight: 6 }} aria-label={status === 'good' ? 'on target' : 'below target'} />}
      {fmt.pct(stat.retention)}
    </span>
  );
}

export function Portfolio({ filters, onOpen }: { filters: Filters; onOpen: (gameId: string) => void }) {
  const state = useApi<Row[]>('/portfolio', filters);
  return (
    <>
    <div className="card">
      <h2>All games</h2>
      <p className="sub">Dots compare retention with each game's target; grey values come from fewer than 1,000 installs.</p>
      <Loadable state={state}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Game</th><th>Avg DAU</th><th>Installs</th><th>D1</th><th>D7</th>
                  <th>Playtime / DAU</th><th>ARPDAU</th><th>D7 LTV</th><th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.game_id}>
                    <td><span className="swatch" style={{ background: `var(${gameColor(i)})` }} aria-hidden="true" /><button className="link-button" onClick={() => onOpen(r.game_id)}>{r.name}</button> <span className="muted">{r.engine}</span></td>
                    <td>{fmt.int(r.avg_dau)}</td>
                    <td>{fmt.int(r.installs)}</td>
                    <td><Ret stat={r.d1} target={r.targets.d1} /></td>
                    <td><Ret stat={r.d7} target={r.targets.d7} /></td>
                    <td>{fmt.min(r.playtime_min_per_dau)}</td>
                    <td>{fmt.usd(r.arpdau)}</td>
                    <td>{fmt.usd(r.ltv_d7.ltv)}</td>
                    <td>{fmt.usd(r.revenue_usd, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loadable>
    </div>
    <IncomeTable filters={filters} onOpen={onOpen} />
    <Compare filters={filters} />
    </>
  );
}

/**
 * Adds the net (income − UA spend) summed from the first day of the range up to each day.
 * Rows arrive newest first, so the sum runs from the end of the list.
 */
function withRunningNet<T extends Pnl>(rows: T[]): (T & { running_net_usd: number })[] {
  let net = 0;
  const out = [...rows].reverse().map((r) => {
    net += r.profit_usd;
    return { ...r, running_net_usd: net };
  });
  return out.reverse();
}

/** Income columns in green, spend in red, so money in and money out read apart at a glance. */
function PnlCells({ p }: { p: Pnl }) {
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

/** Income from ads and IAP next to UA spend, per game and in total. */
function IncomeTable({ filters, onOpen }: { filters: Filters; onOpen: (gameId: string) => void }) {
  const state = useApi<ProfitResponse>('/profit', filters);
  return (
    <div className="card section">
      <h2>Income and UA spend</h2>
      <p className="sub">{UA_NOTE}</p>
      <Loadable state={state}>
        {(p) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Game</th><th>Ads</th><th>IAP (net)</th><th>Total income</th><th>UA spend</th><th>Net (income − UA)</th><th>ROAS</th><th>CPI</th></tr>
              </thead>
              <tbody>
                {p.games.map((g, i) => (
                  <tr key={g.game_id}>
                    <td><span className="swatch" style={{ background: `var(${gameColor(i)})` }} aria-hidden="true" /><button className="link-button" onClick={() => onOpen(g.game_id)}>{g.name}</button></td>
                    <PnlCells p={g} />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total"><td>Total</td><PnlCells p={p.total} /></tr>
              </tfoot>
            </table>
            <h2 style={{ marginTop: 28 }}>Profit and loss per day</h2>
            <p className="sub">All games together, newest day first. Running net adds up income − UA spend from the first day of the range to that day.</p>
            <table>
              <thead>
                <tr><th>Day</th><th>Ads</th><th>IAP (net)</th><th>Total income</th><th>UA spend</th><th>Net (income − UA)</th><th>ROAS</th><th>CPI</th><th>Running net</th></tr>
              </thead>
              <tbody>
                {withRunningNet(p.daily).map((d) => (
                  <tr key={d.date}><td>{d.date}</td><PnlCells p={d} /><td><strong><Money v={d.running_net_usd} /></strong></td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total"><td>Total</td><PnlCells p={p.total} /><td><Money v={p.total.profit_usd} /></td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Loadable>
    </div>
  );
}
