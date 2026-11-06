import { useMemo } from 'react';
import type { Filters, Game } from '../api';
import { Chart } from '../components/Chart';
import { Card, Loadable, useApi } from '../components/ui';
import { fmt } from '../format';

interface Level {
  level_number: number;
  level_name: string | null;
  starts: number;
  players_started: number;
  win_rate: number | null;
  attempts_per_completion: number | null;
  avg_completion_sec: number | null;
  reached_share: number | null;
  churned_players: number;
  churn_share: number | null;
}

interface Tutorial {
  installs: number;
  steps: { step: number; label: string; players: number; share_of_installs: number | null }[];
}

export function Progression({ game, filters }: { game: Game; filters: Filters }) {
  const levels = useApi<{ levels: Level[]; note: string }>(`/games/${game.game_id}/levels`, filters);
  const tutorial = useApi<Tutorial>(`/games/${game.game_id}/tutorial`, filters);
  return (
    <>
      <Loadable state={tutorial}>{(t) => <TutorialFunnel t={t} />}</Loadable>
      <Loadable state={levels}>{(l) => <Levels levels={l.levels} />}</Loadable>
    </>
  );
}

function TutorialFunnel({ t }: { t: Tutorial }) {
  const x = useMemo(() => t.steps.map((s) => s.label), [t]);
  const series = useMemo(() => [{ name: 'Share of installs', values: t.steps.map((s) => s.share_of_installs), color: '--series-1', kind: 'bar' as const }], [t]);
  if (t.steps.length === 0) {
    return <Card title="Tutorial funnel"><p className="empty-state">No tutorial events yet. Games send them with Kpi.TutorialBegin / TutorialStep / TutorialComplete.</p></Card>;
  }
  return (
    <Card title="Tutorial funnel" sub={`Share of the ${fmt.int(t.installs)} installs in range that reached each step`}>
      <Chart x={x} series={series} format={(v) => fmt.pct(v, 0)} height={240} />
    </Card>
  );
}

function Levels({ levels }: { levels: Level[] }) {
  const x = useMemo(() => levels.map((l) => l.level_number), [levels]);
  const reach = useMemo(() => [{ name: 'Players reaching level (share of level 1)', values: levels.map((l) => l.reached_share), color: '--series-1' }], [levels]);
  const win = useMemo(() => [{ name: 'Win rate', values: levels.map((l) => l.win_rate), color: '--series-1', kind: 'bar' as const }], [levels]);
  if (levels.length === 0) {
    return <div className="section"><Card title="Levels"><p className="empty-state">No level events yet.</p></Card></div>;
  }
  const worst = [...levels].filter((l) => l.churned_players > 0).sort((a, b) => b.churned_players - a.churned_players).slice(0, 3);
  return (
    <>
      <div className="grid two section">
        <Card title="Level funnel" sub="How far players get"><Chart x={x} series={reach} format={(v) => fmt.pct(v, 0)} xName="Level" /></Card>
        <Card title="Difficulty" sub="Share of attempts won, per level"><Chart x={x} series={win} format={(v) => fmt.pct(v, 0)} xName="Level" /></Card>
      </div>
      <div className="card section">
        <h2>Levels</h2>
        <p className="sub">
          Churned = installers in range who have not played for 3+ days and stopped at this level.
          {worst.length > 0 && ` Biggest churn points: ${worst.map((l) => `level ${l.level_number}`).join(', ')}.`}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Level</th><th>Name</th><th>Players</th><th>Reached</th><th>Win rate</th>
                <th>Attempts per win</th><th>Avg time to win</th><th>Churned here</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.level_number}>
                  <td>{l.level_number}</td>
                  <td>{l.level_name ?? ''}</td>
                  <td>{fmt.int(l.players_started)}</td>
                  <td>{fmt.pct(l.reached_share, 0)}</td>
                  <td>{fmt.pct(l.win_rate, 0)}</td>
                  <td>{fmt.num(l.attempts_per_completion)}</td>
                  <td>{l.avg_completion_sec == null ? '–' : `${Math.round(l.avg_completion_sec)} s`}</td>
                  <td>{fmt.int(l.churned_players)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
