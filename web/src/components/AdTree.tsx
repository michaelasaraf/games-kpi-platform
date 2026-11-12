import { Fragment, useState } from 'react';
import type { AdNode } from '../api';
import { fmt } from '../format';
import { Roas } from './Pnl';

const LEVEL_LABEL = { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' } as const;

/**
 * Meta campaigns that open into ad sets and ads. Spend, Meta's installs and CPI come from Meta;
 * installs, D1 / D7 and ROAS are our own, from the players each ad brought (decrypted Play referrer).
 */
export function AdTree({ rows }: { rows: AdNode[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hasOwn = rows.some((r) => r.installs > 0);
  const toggle = (key: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const render = (n: AdNode, depth: number, parent: string): React.ReactNode => {
    const key = `${parent}/${n.level}:${n.id}`;
    const isOpen = open.has(key);
    const dim = hasOwn && !n.reliable;
    return (
      <Fragment key={key}>
        <tr className={dim ? 'muted' : undefined} title={dim ? 'Fewer than 300 of our own installs: too few to judge' : undefined}>
          <td style={{ paddingLeft: 10 + depth * 18 }}>
            <span className="ad-name">
              {n.children.length > 0 ? (
                <button type="button" className="link-button" aria-expanded={isOpen} onClick={() => toggle(key)}>
                  {isOpen ? '▾' : '▸'} {n.name}
                </button>
              ) : (
                <>
                  {n.thumbnail_url ? <img className="ad-thumb" src={n.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                  {n.name}
                </>
              )}
              <span className="muted"> {LEVEL_LABEL[n.level]}{n.status && n.status !== 'ACTIVE' ? ` · ${n.status.toLowerCase().replace(/_/g, ' ')}` : ''}</span>
            </span>
          </td>
          <td>{fmt.usd(n.spend_usd, 0)}</td>
          <td>{fmt.int(n.paid_installs)}</td>
          <td>{fmt.usd(n.meta_cpi, 2)}</td>
          <td>{fmt.pct(n.ctr, 2)}</td>
          <td><Roas v={n.meta_roas} /></td>
          {hasOwn ? (
            <>
              <td>{fmt.int(n.installs)}</td>
              <td>{fmt.usd(n.cpi, 2)}</td>
              <td>{fmt.pct(n.d1, 0)}</td>
              <td>{fmt.pct(n.d7, 0)}</td>
              <td>{fmt.usd(n.revenue_usd, 2)}</td>
              <td><Roas v={n.roas_d7} /></td>
              <td><Roas v={n.roas} /></td>
            </>
          ) : null}
        </tr>
        {isOpen ? n.children.map((c) => render(c, depth + 1, key)) : null}
      </Fragment>
    );
  };

  return (
    <div className="card section">
      <h2>Campaigns, ad sets and ads</h2>
      <p className="sub">
        Spend, installs, CPI and purchase ROAS as Meta reports them (its own attribution window).
        {hasOwn
          ? ' Our columns count the players each ad brought (Meta’s encrypted Play install referrer, Android click-through installs) and what they earned (Firebase ad and purchase events). D7 and ROAS D7 use installs at least 7 days old. Grey rows have under 300 of our installs: too few to judge.'
          : ' Our own installs, retention and ROAS per ad appear once the games send Meta’s install referrer (wrapper update) and the decryption key is set.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Spend</th><th>Installs (Meta)</th><th>CPI (Meta)</th><th>CTR</th><th>Purchase ROAS (Meta)</th>
              {hasOwn ? <><th>Installs (ours)</th><th>CPI (ours)</th><th>D1</th><th>D7</th><th>Revenue</th><th>ROAS D7</th><th>ROAS to date</th></> : null}
            </tr>
          </thead>
          <tbody>{rows.map((r) => render(r, 0, ''))}</tbody>
        </table>
      </div>
    </div>
  );
}
