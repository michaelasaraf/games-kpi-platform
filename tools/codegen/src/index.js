// Generates the Unity and Flutter event helpers and the catalog docs from catalog/events.yaml.
// Usage: node src/index.js          write the generated files
//        node src/index.js --check  fail if any generated file is out of date (for CI)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, validateCatalog } from './catalog.js';
import { generateCSharp } from './csharp.js';
import { generateDart } from './dart.js';
import { generateMarkdown } from './markdown.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = loadCatalog(resolve(root, 'catalog/events.yaml'));

const errors = validateCatalog(catalog);
if (errors.length) {
  console.error('Catalog is invalid:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

const outputs = {
  'sdk/unity/Runtime/KpiEvents.g.cs': generateCSharp(catalog),
  'sdk/flutter/lib/src/kpi_events.g.dart': generateDart(catalog),
  'docs/event-catalog.md': generateMarkdown(catalog),
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, content] of Object.entries(outputs)) {
  const path = resolve(root, rel);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (check) {
    if (current !== content) {
      console.error(`out of date: ${rel}`);
      stale++;
    }
  } else if (current !== content) {
    writeFileSync(path, content);
    console.log(`wrote ${rel}`);
  }
}
if (check && stale) {
  console.error('Run `npm run codegen` in tools/codegen and commit the result.');
  process.exit(1);
}
console.log(`catalog v${catalog.version}: ${catalog.events.length} events OK`);
