import type { Filters, Game } from '../api';
import { Card, Loadable, useApi } from '../components/ui';
import { fmt } from '../format';

interface Flow { reason: string; amount: number; events: number }
interface Currency {
  currency: string;
  earned: number;
  spent: number;
  net: number;
  net_per_dau: number | null;
  spend_ratio: number | null;
  sources: Flow[];
  sinks: Flow[];
}

function FlowTable({ title, flows, total }: { title: string; flows: Flow[]; total: number }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{title}</th><th>Amount</th><th>Share</th></tr></thead>
        <tbody>
          {flows.map((f) => (
            <tr key={f.reason}>
              <td>{f.reason}</td>
              <td>{fmt.int(f.amount)}</td>
              <td>{fmt.pct(total > 0 ? f.amount / total : null, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Economy({ game, filters }: { game: Game; filters: Filters }) {
  const state = useApi<Currency[]>(`/games/${game.game_id}/economy`, filters);
  return (
    <Loadable state={state}>
      {(currencies) =>
        currencies.length === 0 ? (
          <p className="empty-state">No currency events yet. Games send them with Kpi.EarnCurrency and Kpi.SpendCurrency.</p>
        ) : (
          <div className="grid">
            {currencies.map((c) => (
              <Card
                key={c.currency}
                title={c.currency}
                sub={`Earned ${fmt.int(c.earned)} · spent ${fmt.int(c.spent)} (${fmt.pct(c.spend_ratio, 0)} of earned) · net ${fmt.num(c.net_per_dau)} per DAU${
                  c.spend_ratio != null && c.spend_ratio < 0.7 ? ' · players are hoarding: consider more sinks' : ''
                }`}
              >
                <div className="grid two">
                  <FlowTable title="Sources" flows={c.sources} total={c.earned} />
                  <FlowTable title="Sinks" flows={c.sinks} total={c.spent} />
                </div>
              </Card>
            ))}
          </div>
        )
      }
    </Loadable>
  );
}
