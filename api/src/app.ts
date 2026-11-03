import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { canSeeGame, filterGames, gameAccessFor, type GameAccess } from './access.js';
import type { Authenticator, User } from './auth.js';
import type { AccessConfig } from './config.js';
import { addDays, daysBetween } from './metrics.js';
import { KpiService, lastCompleteDate, type Range } from './queries.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    gameAccess?: GameAccess;
  }
}

export interface AppOptions {
  kpis: KpiService;
  authenticate: Authenticator;
  access: AccessConfig;
  /** Public settings the browser needs (Google client id). */
  publicConfig: { googleClientId: string | null; devAuth: boolean };
  /** Folder with the built dashboard (web/dist); served at / when present. */
  webDir?: string;
  logger?: boolean;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const rangeQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  platform: z.enum(['all', 'android', 'ios']).default('all'),
});
const MAX_RANGE_DAYS = 400;

export function parseRange(query: unknown, now = new Date()): Range {
  const q = rangeQuery.parse(query);
  const to = q.to ?? lastCompleteDate(now);
  const from = q.from ?? addDays(to, -29);
  const span = daysBetween(from, to);
  if (span < 0) throw new RangeError('from must be on or before to');
  if (span >= MAX_RANGE_DAYS) throw new RangeError(`range is limited to ${MAX_RANGE_DAYS} days`);
  return { from, to, platform: q.platform };
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError || err instanceof RangeError) {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong; check the server logs.' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/config', async () => opts.publicConfig);

  // Everything else under /api needs a signed-in user.
  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const user = await opts.authenticate(req.headers.authorization);
      if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in with Google.' });
      req.user = user;
      req.gameAccess = gameAccessFor(user.email, opts.access);
    });

    const gameParam = z.object({ gameId: z.string().regex(/^[a-z][a-z0-9_]*$/) });
    const gameFrom = (req: FastifyRequest) => {
      const { gameId } = gameParam.parse(req.params);
      return gameId;
    };
    const guard = (req: FastifyRequest, gameId: string) => canSeeGame(req.gameAccess ?? [], gameId);

    api.get('/me', async (req) => ({ user: req.user, games: req.gameAccess }));

    api.get('/games', async (req) => filterGames(req.gameAccess ?? [], await opts.kpis.games()));

    api.get('/portfolio', async (req) => opts.kpis.portfolio(req.gameAccess ?? [], parseRange(req.query)));

    const perGame: Record<string, (gameId: string, req: FastifyRequest) => Promise<unknown>> = {
      summary: (g, req) => opts.kpis.summary(g, parseRange(req.query)),
      daily: (g, req) => opts.kpis.daily(g, parseRange(req.query)),
      retention: (g, req) => opts.kpis.retention(g, parseRange(req.query)),
      levels: (g, req) => opts.kpis.levels(g, parseRange(req.query)),
      tutorial: (g, req) => opts.kpis.tutorial(g, parseRange(req.query)),
      economy: (g, req) => opts.kpis.economy(g, parseRange(req.query)),
      platforms: (g) => opts.kpis.platforms(g),
      integration: (g) => opts.kpis.integration(g),
    };
    for (const [name, handler] of Object.entries(perGame)) {
      api.get(`/games/:gameId/${name}`, async (req, reply) => {
        const gameId = gameFrom(req);
        // Same answer for "no such game" and "not yours", so ids cannot be probed.
        if (!guard(req, gameId)) return reply.code(404).send({ error: 'not_found', message: 'Unknown game.' });
        return handler(gameId, req);
      });
    }
  }, { prefix: '/api' });

  if (opts.webDir && existsSync(opts.webDir)) {
    app.register(fastifyStatic, { root: opts.webDir });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) => {
      // API paths and missing files (an old asset after a deploy) get a real 404, not the app shell.
      const path = req.url.split('?')[0] ?? '';
      if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
