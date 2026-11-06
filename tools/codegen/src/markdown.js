import { camel, orderedParams } from './catalog.js';

const GROUP_TITLES = {
  attribution: 'Attribution (UA source)',
  progression: 'Progression',
  ads: 'Ads',
  iap: 'Store and in-app purchases',
  economy: 'Economy',
};

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

export function generateMarkdown(catalog) {
  const lines = [
    '<!-- Generated from catalog/events.yaml by tools/codegen. Do not edit by hand. -->',
    '# Event catalog',
    '',
    `Catalog version ${catalog.version}. Every game sends these events through the wrapper for its engine.`,
    'Each event also carries `kpi_event_id`, `kpi_seq` and `kpi_sdk`, added by the wrapper.',
    '',
    '## Logged by Firebase automatically',
    '',
    '| Event | Feeds |',
    '| --- | --- |',
    ...(catalog.automatic ?? []).map((a) => `| \`${a.name}\` | ${cell(a.feeds)} |`),
    '',
  ];

  const groups = [...new Set(catalog.events.map((e) => e.group))];
  for (const g of groups) {
    lines.push(`## ${GROUP_TITLES[g] ?? g}`, '');
    for (const ev of catalog.events.filter((e) => e.group === g)) {
      const unity = `Kpi.${ev.method}(...)`;
      const flutter = `KpiEvents.${ev.method.charAt(0).toLowerCase()}${ev.method.slice(1)}(...)`;
      lines.push(`### \`${ev.name}\``, '', cell(ev.description), '', `Unity: \`${unity}\` · Flutter: \`${flutter}\``, '');
      const params = orderedParams(ev);
      if (params.length) {
        lines.push('| Param | Type | Required | Unity / Dart argument | Description |', '| --- | --- | --- | --- | --- |');
        for (const p of params) {
          lines.push(`| \`${p.name}\` | ${p.type} | ${p.required ? 'yes' : 'no'} | \`${camel(p.name)}\` | ${cell(p.description)} |`);
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}
