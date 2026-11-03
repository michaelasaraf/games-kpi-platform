import type { Game } from '../api';
import { Card, Loadable, useApi } from '../components/ui';
import { fmt } from '../format';

interface Check {
  group: string;
  label: string;
  status: 'ok' | 'warning' | 'missing';
  missing_events: string[];
  problems: string[];
  events_7d: number;
  last_seen_at: string | null;
}

interface Integration {
  wrapper_versions: string[];
  checklist: Check[];
  events: { event_name: string; events_7d: number; events_24h: number; players_7d: number; last_seen_at: string | null }[];
}

function when(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const STATUS = {
  ok: { cls: 'good', text: 'Receiving' },
  warning: { cls: 'warn', text: 'Check' },
  missing: { cls: 'bad', text: 'Missing' },
} as const;

/** The integration checklist game teams use to confirm their work, from the last 7 days of events. */
export function IntegrationPage({ game }: { game: Game }) {
  const state = useApi<Integration>(`/games/${game.game_id}/integration`);
  return (
    <Loadable state={state}>
      {(data) => {
        const done = data.checklist.filter((c) => c.status === 'ok').length;
        return (
          <div className="grid two">
            <Card
              title={`Integration checklist: ${done} of ${data.checklist.length} receiving`}
              sub={`Last 7 days. Wrapper versions seen: ${data.wrapper_versions.join(', ') || 'none yet'}. Updates hourly.`}
            >
              {data.checklist.map((c) => (
                <div className="check" key={c.group}>
                  <div className="status">
                    <span className={`badge ${STATUS[c.status].cls}`}>
                      <span className={`dot ${STATUS[c.status].cls}`} />
                      {STATUS[c.status].text}
                    </span>
                  </div>
                  <div>
                    <div>{c.label}</div>
                    <div className="muted">
                      {fmt.int(c.events_7d)} events{c.last_seen_at ? ` · last ${when(c.last_seen_at)}` : ''}
                    </div>
                    {(c.missing_events.length > 0 || c.problems.length > 0) && (
                      <ul>
                        {c.missing_events.length > 0 && <li>Not seen yet: {c.missing_events.join(', ')}</li>}
                        {c.problems.map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </Card>
            <Card title="Events received" sub="Every event name this game sent in the last 7 days">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Event</th><th>Last 24 h</th><th>Last 7 days</th><th>Players</th></tr></thead>
                  <tbody>
                    {data.events.map((e) => (
                      <tr key={e.event_name}>
                        <td>{e.event_name}</td>
                        <td>{fmt.int(e.events_24h)}</td>
                        <td>{fmt.int(e.events_7d)}</td>
                        <td>{fmt.int(e.players_7d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }}
    </Loadable>
  );
}
