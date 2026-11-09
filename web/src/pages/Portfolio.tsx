import type { DayStat, Filters } from '../api';
import { Loadable, useApi, vsTarget } from '../components/ui';
import { fmt } from '../format';
import { Compare, gameColor } from './Compare';

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
    <Compare filters={filters} />
    </>
  );
}
