import { BigQuery } from '@google-cloud/bigquery';
import type { Config } from './config.js';

export type Params = Record<string, string | number | boolean>;

/** The only thing the KPI code needs from BigQuery; tests pass a fake. */
export interface Warehouse {
  /** `sql` may use {{dataset}} for the KPI dataset and @name for params. */
  query<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
}

export class BigQueryWarehouse implements Warehouse {
  private readonly bq: BigQuery;
  private readonly datasetRef: string;

  constructor(private readonly config: Config) {
    const credentials = config.GCP_SA_KEY_JSON ? parseServiceAccountKey(config.GCP_SA_KEY_JSON) : undefined;
    this.bq = new BigQuery({ projectId: config.GCP_PROJECT, credentials });
    this.datasetRef = `\`${config.GCP_PROJECT}.${config.BQ_DATASET}\``;
  }

  async query<T>(sql: string, params: Params = {}): Promise<T[]> {
    const [rows] = await this.bq.query({
      query: sql.replaceAll('{{dataset}}', this.datasetRef),
      params,
      location: this.config.BQ_LOCATION,
      maximumBytesBilled: String(this.config.MAX_BYTES_BILLED),
      useLegacySql: false,
    });
    return (rows as Record<string, unknown>[]).map(normalizeRow) as T[];
  }
}

/**
 * Reads a service account key from an environment variable. Accepts the JSON itself (on one line or
 * several, optionally wrapped in quotes) or the key file base64-encoded, since some env editors only
 * take one KEY=value line.
 */
export function parseServiceAccountKey(text: string): Record<string, unknown> {
  let t = text.trim();
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t.at(-1) === t[0]) t = t.slice(1, -1).trim();
  if (!t.startsWith('{')) t = Buffer.from(t, 'base64').toString('utf8').trim();
  let key: unknown;
  try {
    key = JSON.parse(t);
  } catch {
    throw new Error('GCP_SA_KEY_JSON is not valid JSON or base64-encoded JSON');
  }
  if (!key || typeof key !== 'object' || !('client_email' in key) || !('private_key' in key)) {
    throw new Error('GCP_SA_KEY_JSON is not a service account key (no client_email or private_key)');
  }
  return key as Record<string, unknown>;
}

/** BigQuery returns DATE as {value: 'YYYY-MM-DD'} and NUMERIC/BIGNUMERIC as objects; flatten them. */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && 'value' in v && Object.keys(v).length === 1) {
      out[k] = (v as { value: unknown }).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Caches query results in memory for a few minutes; the KPI tables change hourly. */
export class CachedWarehouse implements Warehouse {
  private readonly cache = new Map<string, { at: number; rows: Promise<unknown[]> }>();

  constructor(
    private readonly inner: Warehouse,
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  query<T>(sql: string, params: Params = {}): Promise<T[]> {
    if (this.ttlMs <= 0) return this.inner.query<T>(sql, params);
    const key = sql + '\u0000' + JSON.stringify(Object.entries(params).sort());
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.ttlMs) return hit.rows as Promise<T[]>;

    const rows = this.inner.query<T>(sql, params);
    this.cache.set(key, { at: now, rows });
    rows.catch(() => this.cache.delete(key));
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return rows;
  }
}
