import { useMemo } from 'react';
import type { DailyRow, Filters, Game, Summary } from '../api';
import { Chart } from '../components/Chart';
import { Card, Loadable, Tile, useApi, vsTarget } from '../components/ui';
import { fmt } from '../format';

/** The launch scorecard: the five go/no-go KPIs first, then the daily trends. */
export function Overview({ game, filters }: { game: Game; filters: Filters }) {
  const summary = useApi<Summary>(`/games/${game.game_id}/summary`, filters);
  const daily = useApi<DailyRow[]>(`/games/${game.game_id}/daily`, filters);

  return (
    <>
      <Loadable state={summary}>
        {(s) => {
          const d1 = s.retention.d1;
          const d7 = s.retention.d7;
          const note = (players: number, reliable?: boolean) =>
            `${fmt.int(players)} installs${reliable === false ? ' · too few to trust' : ''}`;
          return (
            <div className="grid tiles">
              <Tile label="D1 retention" value={fmt.pct(d1.retention)} status={vsTarget(d1.retention, game.d1_target, d1.reliable)} meta={note(d1.players, d1.reliable)} unreliable={d1.reliable === false} />
              <Tile label="D7 retention" value={fmt.pct(d7.retention)} status={vsTarget(d7.retention, game.d7_target, d7.reliable)} meta={note(d7.players, d7.reliable)} unreliable={d7.reliable === false} />
              <Tile label="Playtime per DAU" value={fmt.min(s.playtime_min_per_dau)} meta={`${fmt.num(s.sessions_per_dau)} sessions per DAU`} />
              <Tile label="ARPDAU" value={fmt.usd(s.arpdau)} meta={`Ads ${fmt.usd(s.ad_arpdau)} · IAP ${fmt.usd(s.iap_arpdau)}`} />
              <Tile label="D7 LTV" value={fmt.usd(s.ltv.d7.ltv)} meta={note(s.ltv.d7.players, s.ltv.d7.reliable)} unreliable={s.ltv.d7.reliable === false} />
              <Tile label="Average DAU" value={fmt.int(s.avg_dau)} meta={`${fmt.int(s.installs)} installs · DAU/MAU ${fmt.pct(s.stickiness, 0)}`} />
            </div>
          );
        }}
      </Loadable>
      <Loadable state={daily}>
        {(rows) => <DailyCharts rows={rows} />}
      </Loadable>
    </>
  );
}

function DailyCharts({ rows }: { rows: DailyRow[] }) {
  const x = useMemo(() => rows.map((r) => r.date.slice(5)), [rows]);
  const dau = useMemo(() => [
    { name: 'DAU', values: rows.map((r) => r.avg_dau), color: '--series-1' },
  ], [rows]);
  const installs = useMemo(() => [
    { name: 'Installs', values: rows.map((r) => r.installs), color: '--series-1', kind: 'bar' as const },
  ], [rows]);
  const arpdau = useMemo(() => [
    { name: 'Ads', values: rows.map((r) => r.ad_arpdau), color: '--series-1' },
    { name: 'IAP', values: rows.map((r) => r.iap_arpdau), color: '--series-2' },
  ], [rows]);
  const playtime = useMemo(() => [
    { name: 'Minutes per DAU', values: rows.map((r) => r.playtime_min_per_dau), color: '--series-1' },
  ], [rows]);

  if (rows.length === 0) return <p className="empty-state">No data for this range yet.</p>;
  return (
    <div className="grid two section">
      <Card title="Daily active players"><Chart x={x} series={dau} format={fmt.int} /></Card>
      <Card title="Installs"><Chart x={x} series={installs} format={fmt.int} /></Card>
      <Card title="ARPDAU by source" sub="Revenue per daily active player, ads and IAP (net of store fee)"><Chart x={x} series={arpdau} format={(v) => fmt.usd(v, 3)} /></Card>
      <Card title="Playtime per DAU"><Chart x={x} series={playtime} format={(v) => fmt.num(v)} /></Card>
    </div>
  );
}
