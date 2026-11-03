import { useMemo } from 'react';
import type { DayStat, Filters, Game } from '../api';
import { Chart } from '../components/Chart';
import { Card, Loadable, useApi } from '../components/ui';
import { fmt } from '../format';

interface RetentionData {
  last_complete_date: string;
  curve: DayStat[];
  cohorts: { install_date: string; size: number; retention: (number | null)[]; ltv: (number | null)[] }[];
}

const dayLabel = (d: number) => `D${d}`;

const SHOWN_DAYS = [0, 1, 2, 3, 4, 5, 6, 7, 14, 21, 30];

/** Sequential blue ramp for the cohort heatmap: one hue, light to dark. */
function heat(v: number | null) {
  if (v == null) return undefined;
  const steps = ['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6'];
  const idx = v >= 1 ? 6 : Math.min(5, Math.floor(Math.sqrt(v) * 6));
  const step = steps[idx]!;
  const dark = idx >= 4;
  return { background: `var(${step})`, color: dark ? '#ffffff' : 'var(--text-primary)' };
}

export function Retention({ game, filters }: { game: Game; filters: Filters }) {
  const state = useApi<RetentionData>(`/games/${game.game_id}/retention`, filters);
  return (
    <Loadable state={state}>
      {(data) => <RetentionView data={data} game={game} />}
    </Loadable>
  );
}

function RetentionView({ data, game }: { data: RetentionData; game: Game }) {
  const reached = data.curve.filter((c) => c.retention != null && c.day > 0);
  const x = useMemo(() => reached.map((c) => c.day), [reached]);
  const retention = useMemo(() => [{ name: 'Retention', values: reached.map((c) => c.retention), color: '--series-1' }], [reached]);
  const ltvPoints = data.curve.filter((c) => c.ltv != null);
  const ltvX = useMemo(() => ltvPoints.map((c) => c.day), [ltvPoints]);
  const ltv = useMemo(() => [{ name: 'LTV per install', values: ltvPoints.map((c) => c.ltv), color: '--series-1' }], [ltvPoints]);

  if (data.cohorts.length === 0) return <p className="empty-state">No install cohorts in this range yet.</p>;
  return (
    <>
      <div className="grid two">
        <Card title="Retention curve" sub="Share of installers who came back on day N, across all cohorts in range that have reached day N">
          <Chart x={x} series={retention} numericX={dayLabel} format={(v) => fmt.pct(v, 0)} target={{ value: game.d1_target, label: `D1 target ${fmt.pct(game.d1_target, 0)}` }} />
        </Card>
        <Card title="LTV curve" sub="Cumulative revenue (ads + IAP net) per installer">
          <Chart x={ltvX} series={ltv} numericX={dayLabel} format={(v) => fmt.usd(v, 2)} />
        </Card>
      </div>
      <div className="card section">
        <h2>Cohorts by install day</h2>
        <p className="sub">Retention on day N. Empty cells have not happened yet. Data complete through {data.last_complete_date}.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Install day</th>
                <th>Installs</th>
                {SHOWN_DAYS.slice(1).map((d) => <th key={d}>D{d}</th>)}
                <th>D7 LTV</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.install_date}>
                  <td>{c.install_date}</td>
                  <td>{fmt.int(c.size)}</td>
                  {SHOWN_DAYS.slice(1).map((d) => {
                    const v = c.retention[d] ?? null;
                    return (
                      <td key={d} className={v == null ? 'empty' : 'heat'} style={heat(v)}>
                        {v == null ? '' : fmt.pct(v, 0)}
                      </td>
                    );
                  })}
                  <td>{fmt.usd(c.ltv[7] ?? null, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
