import { z } from 'zod';

/**
 * Who may see which games. Set ACCESS_JSON on Railway, for example:
 *   {"admins":["michael@studio.com"],"users":{"pm@studio.com":["gems_crafter","storm_bloom"]},"domains":{"studio.com":"*"}}
 * - admins see every game.
 * - users maps an email to "*" (all games) or a list of game ids.
 * - domains maps an email domain to "*" or a list of game ids.
 */
export const accessSchema = z.object({
  admins: z.array(z.string().email()).default([]),
  users: z.record(z.union([z.literal('*'), z.array(z.string())])).default({}),
  domains: z.record(z.union([z.literal('*'), z.array(z.string())])).default({}),
});
export type AccessConfig = z.infer<typeof accessSchema>;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  GCP_PROJECT: z.string().min(1),
  BQ_DATASET: z.string().min(1).default('games_kpi'),
  BQ_LOCATION: z.string().min(1).default('US'),
  /** Service account key as JSON text. Leave empty locally to use gcloud application-default credentials. */
  GCP_SA_KEY_JSON: z.string().optional(),
  /** OAuth client id of the dashboard's Google sign-in button. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  ACCESS_JSON: z.string().default('{}'),
  /** Local development only: skip sign-in and act as this email. Refused when NODE_ENV=production. */
  DEV_AUTH_EMAIL: z.string().email().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  /** Most bytes one dashboard query may scan; protects against a runaway query bill. */
  MAX_BYTES_BILLED: z.coerce.number().int().positive().default(5_000_000_000),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof envSchema> & { access: AccessConfig };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.DEV_AUTH_EMAIL && parsed.NODE_ENV === 'production') {
    throw new Error('DEV_AUTH_EMAIL must not be set in production');
  }
  if (!parsed.DEV_AUTH_EMAIL && !parsed.GOOGLE_CLIENT_ID) {
    throw new Error('Set GOOGLE_CLIENT_ID (or DEV_AUTH_EMAIL for local development)');
  }
  const access = accessSchema.parse(JSON.parse(parsed.ACCESS_JSON));
  return { ...parsed, access };
}
