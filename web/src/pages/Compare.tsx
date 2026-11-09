import { useMemo } from 'react';
import type { Filters } from '../api';
import { Chart, type Series } from '../components/Chart';
import { Card, Loadable, useApi } from '../components/ui';
import { fmt } from '../format';

export interface CompareData {
  last_complete_date: string;
  games: {
    game_id: string;
    name: string;
    retention: { day: number; players: number; retention: number | null; reliable: boolean }[];
    daily: { date: string; dau: number | null; arpdau: number | null; playtime_min_per_dau: number | null }[];
  }[];
}

const SERIES_COLORS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];

/** Each game keeps one color everywhere (by its place in the name-sorted game list), never by rank. */
export function gameColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

/** Ratios from fewer players than this are hidden: one player on day 3 would read as 100% retention. */
const MIN_PLAYERS = 20;

const RETENTION_DAYS = [1, 2, 3, 4, 5, 6, 7, 14, 21, 30];
const dayLabel = (d: number) => `D${d}`;
const pct = (v: number | null) => fmt.pct(v, 0);
const usd = (v: number | null) => fmt.usd(v, 3);
const minutes = (v: number | null) => fmt.min(v);

/** Games side by side: retention curve and daily DAU, ARPDAU and playtime, using every filter. */
export function Compare({ filters }: { filters: Filters }) {
  const state = useApi<CompareData>('/compare', filters);
  return (
    <Loadable state={state}>
      {(data) => (data.games.length < 2 ? null : <CompareCharts data={data} />)}
    </Loadable>
  );
}

function CompareCharts({ data }: { data: CompareData }) {
  const retention = useMemo<Series[]>(
    () =>
      data.games.map((g, i) => {
        const byDay = new Map(g.retention.filter((c) => c.players >= MIN_PLAYERS).map((c) => [c.day, c.retention]));
        return { name: g.name, values: RETENTION_DAYS.map((d) => byDay.get(d) ?? null), color: gameColor(i) };
      }),
    [data],
  );
  const dates = useMemo(() => [...new Set(data.games.flatMap((g) => g.daily.map((d) => d.date)))].sort(), [data]);
  const x = useMemo(() => dates.map((d) => d.slice(5)), [dates]);
  const daily = useMemo(() => {
    const pick = (key: 'dau' | 'arpdau' | 'playtime_min_per_dau'): Series[] =>
      data.games.map((g, i) => {
        // Per-player ratios skip days with too few players (a game's first, partial export day).
        const shown = key === 'dau' ? g.daily : g.daily.filter((d) => (d.dau ?? 0) >= MIN_PLAYERS);
        const byDate = new Map(shown.map((d) => [d.date, d[key]]));
        return { name: g.name, values: dates.map((d) => byDate.get(d) ?? null), color: gameColor(i) };
      });
    return { dau: pick('dau'), arpdau: pick('arpdau'), playtime: pick('playtime_min_per_dau') };
  }, [data, dates]);
  const smallCohorts = data.games.some((g) => g.retention.some((c) => c.day === 1 && c.players > 0 && !c.reliable));

  return (
    <div className="section">
      <h2 className="section-title">Compare games</h2>
      <div className="grid two">
        <Card
          title="Retention curve"
          sub={`Share of installers back on day N, over install cohorts in range that have reached day N. Days with fewer than ${MIN_PLAYERS} installers behind them are left out.${
            smallCohorts ? ' Some games have fewer than 1,000 installs behind these numbers, so expect noise.' : ''
          }`}
        >
          <Chart x={RETENTION_DAYS} series={retention} numericX={dayLabel} format={pct} />
        </Card>
        <Card
          title="ARPDAU"
          sub={`Revenue per daily active player (ads + IAP net of store fee). Not complete yet: IAP reads $0 until the Google Play reports load, so this is mostly ad revenue from AdMob. Store revenue has no UA source, so it drops out when a UA source filter is set. Days with fewer than ${MIN_PLAYERS} players are left out.`}
        >
          <Chart x={x} series={daily.arpdau} format={usd} />
        </Card>
        <Card title="Playtime per DAU" sub={`Minutes played per daily active player. Days with fewer than ${MIN_PLAYERS} players are left out.`}>
          <Chart x={x} series={daily.playtime} format={minutes} />
        </Card>
        <Card title="Daily active players">
          <Chart x={x} series={daily.dau} format={fmt.int} />
        </Card>
      </div>
    </div>
  );
}
