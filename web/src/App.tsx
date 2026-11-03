import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, type Filters, type Game } from './api';
import { Loadable, useApi } from './components/ui';
import { daysBefore, yesterday } from './format';
import { Economy } from './pages/Economy';
import { IntegrationPage } from './pages/Integration';
import { Monetization } from './pages/Monetization';
import { Overview } from './pages/Overview';
import { Portfolio } from './pages/Portfolio';
import { Progression } from './pages/Progression';
import { Retention } from './pages/Retention';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'retention', label: 'Retention' },
  { id: 'monetization', label: 'Monetization' },
  { id: 'progression', label: 'Progression' },
  { id: 'economy', label: 'Economy' },
  { id: 'integration', label: 'Integration' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const PRESETS = [7, 30, 90] as const;

/** View state lives in the URL hash so any view can be shared as a link. */
interface View extends Filters {
  game: string | null;
  tab: TabId;
}

function readView(): View {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const to = p.get('to') ?? yesterday();
  const platform = p.get('platform');
  const tab = p.get('tab');
  return {
    game: p.get('game'),
    tab: TABS.some((t) => t.id === tab) ? (tab as TabId) : 'overview',
    to,
    from: p.get('from') ?? daysBefore(to, 29),
    platform: platform === 'android' || platform === 'ios' ? platform : 'all',
  };
}

function writeView(v: View) {
  const p = new URLSearchParams();
  if (v.game) p.set('game', v.game);
  p.set('tab', v.tab);
  p.set('from', v.from);
  p.set('to', v.to);
  p.set('platform', v.platform);
  window.history.replaceState(null, '', `#${p}`);
}

function SignIn({ clientId, onToken }: { clientId: string; onToken: (t: string) => void }) {
  const button = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      const g = window.google;
      if (g && button.current) {
        window.clearInterval(timer);
        g.accounts.id.initialize({ client_id: clientId, callback: (r) => onToken(r.credential), auto_select: true });
        g.accounts.id.renderButton(button.current, { theme: 'outline', size: 'large', text: 'signin_with' });
      } else if (++tries > 50) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [clientId, onToken]);
  return (
    <div className="signin">
      <div className="card">
        <h2>Games KPI</h2>
        <p className="sub">Sign in with your work Google account to see your games.</p>
        <div ref={button} style={{ display: 'flex', justifyContent: 'center' }} />
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<{ googleClientId: string | null; devAuth: boolean } | null>(null);
  const [token, setTok] = useState<string | null>(getToken());

  useEffect(() => {
    api<{ googleClientId: string | null; devAuth: boolean }>('/config').then(setConfig).catch(() => setConfig({ googleClientId: null, devAuth: false }));
  }, []);

  const onToken = useCallback((t: string) => {
    setToken(t);
    setTok(t);
  }, []);

  if (!config) return <p className="muted app">Loading…</p>;
  if (!config.devAuth && !token) {
    if (!config.googleClientId) return <p className="error app">The server has no GOOGLE_CLIENT_ID configured.</p>;
    return <SignIn clientId={config.googleClientId} onToken={onToken} />;
  }
  return (
    <Dashboard
      onSignOut={() => {
        setToken(null);
        setTok(null);
        window.google?.accounts.id.disableAutoSelect();
      }}
    />
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<View>(readView);
  const update = (patch: Partial<View>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      writeView(next);
      return next;
    });
  useEffect(() => {
    // Pasted or edited links update the view without a reload.
    const onHash = () => setView(readView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const me = useApi<{ user: { email: string } }>('/me');
  const games = useApi<Game[]>('/games');

  useEffect(() => {
    if (me.error?.toLowerCase().includes('sign in')) onSignOut();
  }, [me.error, onSignOut]);

  const filters: Filters = { from: view.from, to: view.to, platform: view.platform };
  const span = Math.round((Date.parse(view.to) - Date.parse(view.from)) / 86_400_000) + 1;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Games KPI</div>
        <span className="user">{me.data?.user.email}</span>
        <button className="link-button" onClick={onSignOut}>Sign out</button>
      </header>

      <Loadable state={games}>
        {(list) => {
          const game = list.find((g) => g.game_id === view.game) ?? null;
          if (list.length === 0) {
            return <p className="empty-state">You don't have access to any game yet. Ask an admin to add your email.</p>;
          }
          return (
            <>
              <div className="filters" role="toolbar" aria-label="Filters">
                <select className="control" aria-label="Game" value={game?.game_id ?? ''} onChange={(e) => update({ game: e.target.value || null })}>
                  <option value="">All games</option>
                  {list.map((g) => <option key={g.game_id} value={g.game_id}>{g.name}</option>)}
                </select>
                <div className="segmented" role="group" aria-label="Date range">
                  {PRESETS.map((d) => (
                    <button key={d} aria-pressed={span === d && view.to === yesterday()} onClick={() => update({ to: yesterday(), from: daysBefore(yesterday(), d - 1) })}>
                      {d} days
                    </button>
                  ))}
                </div>
                <input className="control" type="date" aria-label="From" value={view.from} max={view.to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
                <input className="control" type="date" aria-label="To" value={view.to} min={view.from} onChange={(e) => e.target.value && update({ to: e.target.value })} />
                <div className="segmented" role="group" aria-label="Platform">
                  {(['all', 'android', 'ios'] as const).map((p) => (
                    <button key={p} aria-pressed={view.platform === p} onClick={() => update({ platform: p })}>
                      {p === 'all' ? 'All platforms' : p === 'ios' ? 'iOS' : 'Android'}
                    </button>
                  ))}
                </div>
              </div>

              {!game ? (
                <Portfolio filters={filters} onOpen={(id) => update({ game: id, tab: 'overview' })} />
              ) : (
                <>
                  <nav className="tabs" role="tablist">
                    {TABS.map((t) => (
                      <button key={t.id} role="tab" aria-selected={view.tab === t.id} onClick={() => update({ tab: t.id })}>
                        {t.label}
                      </button>
                    ))}
                  </nav>
                  {view.tab === 'overview' && <Overview game={game} filters={filters} />}
                  {view.tab === 'retention' && <Retention game={game} filters={filters} />}
                  {view.tab === 'monetization' && <Monetization game={game} filters={filters} />}
                  {view.tab === 'progression' && <Progression game={game} filters={filters} />}
                  {view.tab === 'economy' && <Economy game={game} filters={filters} />}
                  {view.tab === 'integration' && <IntegrationPage game={game} />}
                </>
              )}
            </>
          );
        }}
      </Loadable>
    </div>
  );
}
