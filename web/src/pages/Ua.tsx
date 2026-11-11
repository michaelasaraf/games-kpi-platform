import { useMemo } from 'react';
import { countryLabel, type Filters, type Game, type UaResponse } from '../api';
import { Chart } from '../components/Chart';
import { Card, Loadable, Tile, useApi } from '../components/ui';
import { fmt } from '../format';

export const UA_NOTE =
  'Income and spend over the same days, by platform and country. The UA source filter does not apply: store revenue has no player, so it cannot be split by UA source. ROAS is income in the range divided by spend in the range.';

/** Profit in green or red, so a loss is visible at a glance. */
export function Money({ v, digits = 0 }: { v: number | null | undefined; digits?: number }) {
  return <span className={v == null ? undefined : v < 0 ? 'neg' : v > 0 ? 'pos' : undefined}>{fmt.usd(v, digits)}</span>;
}

export function Roas({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="muted">–</span>;
  return <span className={v < 1 ? 'neg' : 'pos'}>{fmt.pct(v, 0)}</span>;
}

export function UaPage({ game, filters }: { game: Game; filters: Filters }) {
  const state = useApi<UaResponse>(`/games/${game.game_id}/ua`, filters);
  return (
    <Loadable state={state}>
      {(ua) => {
        const t = ua.total;
        if (t.spend_usd === 0 && ua.campaigns.length === 0) {
          return (
            <>
              <p className="empty-state">No UA spend for {game.name} in this range. Spend comes from Meta Ads, matched by the app each ad set promotes.</p>
              <UaCharts rows={ua.daily} />
            </>
          );
        }
        return (
          <>
            <p className="sub">{UA_NOTE}</p>
            <div className="grid tiles">
              <Tile label="UA spend" value={fmt.usd(t.spend_usd, 0)} meta={`${fmt.int(t.paid_installs)} installs reported by Meta`} />
              <Tile label="CPI" value={fmt.usd(t.cpi, 2)} meta={`Blended over all ${fmt.int(t.installs)} installs: ${fmt.usd(t.blended_cpi, 2)}`} />
              <Tile label="ROAS" value={fmt.pct(t.roas, 0)} meta={`Income ${fmt.usd(t.income_usd, 0)} / spend`} />
              <Tile label="Profit" value={fmt.usd(t.profit_usd, 0)} meta={`Ads ${fmt.usd(t.ad_revenue_usd, 0)} + IAP ${fmt.usd(t.iap_revenue_net_usd, 0)} − spend`} />
              <Tile label="CTR" value={fmt.pct(t.ctr, 2)} meta={`${fmt.int(t.clicks)} clicks · ${fmt.int(t.impressions)} impressions`} />
            </div>
            <UaCharts rows={ua.daily} />
            <div className="card section">
              <h2>Campaigns</h2>
              <p className="sub">Installs and CPI as Meta reports them (its own attribution window).</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Campaign</th><th>Platform</th><th>Days</th><th>Spend</th><th>Share</th><th>Impressions</th><th>CTR</th><th>CPM</th><th>Installs</th><th>CPI</th></tr>
                  </thead>
                  <tbody>
                    {ua.campaigns.map((c) => (
                      <tr key={`${c.channel}|${c.campaign_id}|${c.platform}`}>
                        <td>{c.campaign_name} <span className="muted">{c.channel === 'meta' ? 'Meta' : c.channel}</span></td>
                        <td>{c.platform === 'ios' ? 'iOS' : c.platform === 'android' ? 'Android' : c.platform}</td>
                        <td className="muted">{c.first_date.slice(5)} → {c.last_date.slice(5)}</td>
                        <td>{fmt.usd(c.spend_usd, 0)}</td>
                        <td>{fmt.pct(c.spend_share, 0)}</td>
                        <td>{fmt.int(c.impressions)}</td>
                        <td>{fmt.pct(c.ctr, 2)}</td>
                        <td>{fmt.usd(c.cpm, 2)}</td>
                        <td>{fmt.int(c.paid_installs)}</td>
                        <td>{fmt.usd(c.cpi, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card section">
              <h2>By country</h2>
              <p className="sub">The 15 countries with the most spend, then the rest together. Income is everything the country earned in the range, organic included.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Country</th><th>Spend</th><th>Installs (Meta)</th><th>CPI</th><th>All installs</th><th>Income</th><th>Profit</th><th>ROAS</th></tr>
                  </thead>
                  <tbody>
                    {ua.countries.map((c) => (
                      <tr key={c.country}>
                        <td>{c.other ? <span className="muted">{c.country}</span> : countryLabel(c.country)}</td>
                        <td>{fmt.usd(c.spend_usd, 0)}</td>
                        <td>{fmt.int(c.paid_installs)}</td>
                        <td>{fmt.usd(c.cpi, 2)}</td>
                        <td>{fmt.int(c.installs)}</td>
                        <td>{fmt.usd(c.income_usd, 0)}</td>
                        <td><Money v={c.profit_usd} /></td>
                        <td><Roas v={c.roas} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}

function UaCharts({ rows }: { rows: UaResponse['daily'] }) {
  const x = useMemo(() => rows.map((r) => r.date.slice(5)), [rows]);
  const money = useMemo(() => [
    { name: 'Income', values: rows.map((r) => r.income_usd), color: '--series-3' },
    { name: 'UA spend', values: rows.map((r) => r.spend_usd), color: '--series-2' },
  ], [rows]);
  const cpi = useMemo(() => [
    { name: 'CPI (Meta)', values: rows.map((r) => r.cpi), color: '--series-1' },
    { name: 'Blended CPI', values: rows.map((r) => r.blended_cpi), color: '--series-4' },
  ], [rows]);
  if (rows.length === 0) return null;
  return (
    <div className="grid two section">
      <Card title="Daily income and UA spend"><Chart x={x} series={money} format={(v) => fmt.usd(v, 0)} /></Card>
      <Card title="Daily CPI"><Chart x={x} series={cpi} format={(v) => fmt.usd(v, 2)} /></Card>
    </div>
  );
}
