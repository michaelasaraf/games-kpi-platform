import { useMemo } from 'react';
import type { DailyRow, Filters, Game, Summary } from '../api';
import { Chart } from '../components/Chart';
import { Card, Loadable, Tile, useApi } from '../components/ui';
import { fmt } from '../format';

export function Monetization({ game, filters }: { game: Game; filters: Filters }) {
  const summary = useApi<Summary>(`/games/${game.game_id}/summary`, filters);
  const daily = useApi<DailyRow[]>(`/games/${game.game_id}/daily`, filters);
  return (
    <>
      <Loadable state={summary}>
        {(s) => (
          <>
            <div className="grid tiles">
              <Tile label="Revenue" value={fmt.usd(s.revenue_usd, 0)} meta={`Ads ${fmt.usd(s.ad_revenue_usd, 0)} · IAP ${fmt.usd(s.iap_revenue_net_usd, 0)}`} />
              <Tile label="ARPDAU" value={fmt.usd(s.arpdau)} />
              <Tile label="Payer conversion" value={fmt.pct(s.payer_conversion, 2)} meta="Daily payers / DAU" />
              <Tile label="ARPPU" value={fmt.usd(s.arppu)} meta="IAP net per daily payer" />
              <Tile label="Rewarded opt-in" value={fmt.pct(s.rewarded_opt_in)} meta={`Offer acceptance ${fmt.pct(s.rewarded_offer_acceptance)}`} />
              <Tile label="Store conversion" value={fmt.pct(s.store_conversion)} meta="Store viewers who bought that day" />
            </div>
            <div className="card section">
              <h2>Ads by format</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Format</th><th>Impressions per DAU</th><th>eCPM</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Rewarded</td><td>{fmt.num(s.rewarded_per_dau, 2)}</td><td>{fmt.usd(s.rewarded_ecpm, 2)}</td></tr>
                    <tr><td>Interstitial</td><td>{fmt.num(s.interstitial_per_dau, 2)}</td><td>{fmt.usd(s.interstitial_ecpm, 2)}</td></tr>
                    <tr><td>Banner</td><td>{fmt.num(s.banner_per_dau, 2)}</td><td>{fmt.usd(s.banner_ecpm, 2)}</td></tr>
                    <tr><td><strong>All formats</strong></td><td>{fmt.num(s.impressions_per_dau, 2)}</td><td>{fmt.usd(s.ecpm, 2)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Loadable>
      <Loadable state={daily}>{(rows) => <MoneyCharts rows={rows} />}</Loadable>
    </>
  );
}

function MoneyCharts({ rows }: { rows: DailyRow[] }) {
  const x = useMemo(() => rows.map((r) => r.date.slice(5)), [rows]);
  const revenue = useMemo(() => [
    { name: 'Ads', values: rows.map((r) => r.ad_revenue_usd), color: '--series-1' },
    { name: 'IAP (net)', values: rows.map((r) => r.iap_revenue_net_usd), color: '--series-2' },
  ], [rows]);
  const ecpm = useMemo(() => [
    { name: 'Rewarded', values: rows.map((r) => r.rewarded_ecpm), color: '--series-1' },
    { name: 'Interstitial', values: rows.map((r) => r.interstitial_ecpm), color: '--series-2' },
    { name: 'Banner', values: rows.map((r) => r.banner_ecpm), color: '--series-3' },
  ], [rows]);
  if (rows.length === 0) return null;
  return (
    <div className="grid two section">
      <Card title="Daily revenue by source"><Chart x={x} series={revenue} format={(v) => fmt.usd(v, 0)} /></Card>
      <Card title="eCPM by format"><Chart x={x} series={ecpm} format={(v) => fmt.usd(v, 2)} /></Card>
    </div>
  );
}
