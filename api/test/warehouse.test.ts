import { describe, expect, it } from 'vitest';
import { parseServiceAccountKey } from '../src/warehouse.js';

const key = { type: 'service_account', client_email: 'kpi@p.iam.gserviceaccount.com', private_key: '-----BEGIN-----\nabc\n-----END-----\n' };
const pretty = JSON.stringify(key, null, 2);

describe('parseServiceAccountKey', () => {
  it('reads the key file as pasted, one line or several', () => {
    expect(parseServiceAccountKey(pretty)).toEqual(key);
    expect(parseServiceAccountKey(JSON.stringify(key))).toEqual(key);
  });
  it('reads a quoted one-line key', () => {
    expect(parseServiceAccountKey(`'${JSON.stringify(key)}'`)).toEqual(key);
  });
  it('reads a base64-encoded key file', () => {
    expect(parseServiceAccountKey(Buffer.from(pretty).toString('base64'))).toEqual(key);
  });
  it('rejects text that is not a service account key', () => {
    expect(() => parseServiceAccountKey('{"a":1}')).toThrow(/service account/);
    expect(() => parseServiceAccountKey('not a key')).toThrow(/not valid JSON/);
  });
});
