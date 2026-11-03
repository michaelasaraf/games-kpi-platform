import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, validateCatalog } from '../src/catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('the real catalog is valid', () => {
  assert.deepEqual(validateCatalog(loadCatalog(resolve(root, 'catalog/events.yaml'))), []);
});

test('rejects Firebase reserved names and prefixes', () => {
  const errors = validateCatalog({
    events: [
      { name: 'session_start', method: 'A', group: 'x', params: [] },
      { name: 'firebase_thing', method: 'B', group: 'x', params: [] },
      { name: 'ok_event', method: 'C', group: 'x', params: [{ name: 'ga_x', type: 'string', required: true }] },
    ],
  });
  assert.equal(errors.length, 3);
});

test('rejects too many params, bad types and duplicates', () => {
  const params = Array.from({ length: 23 }, (_, i) => ({ name: `p${i}`, type: 'int', required: false }));
  const errors = validateCatalog({
    events: [
      { name: 'big', method: 'Big', group: 'x', params },
      { name: 'big', method: 'Big', group: 'x', params: [{ name: 'a', type: 'float', required: true }] },
    ],
  });
  assert.ok(errors.some((e) => e.includes('more than 22 params')));
  assert.ok(errors.some((e) => e.includes('duplicate event name')));
  assert.ok(errors.some((e) => e.includes('duplicate method')));
  assert.ok(errors.some((e) => e.includes('type must be')));
});
