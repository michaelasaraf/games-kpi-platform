import type { AccessConfig } from './config.js';

/** The games a signed-in user may see: '*' for all, a list, or none (empty list). */
export type GameAccess = '*' | string[];

export function gameAccessFor(email: string, access: AccessConfig): GameAccess {
  const e = email.trim().toLowerCase();
  if (access.admins.some((a) => a.toLowerCase() === e)) return '*';

  const grants: GameAccess[] = [];
  for (const [user, games] of Object.entries(access.users)) {
    if (user.toLowerCase() === e) grants.push(games);
  }
  const domain = e.split('@')[1] ?? '';
  for (const [d, games] of Object.entries(access.domains)) {
    if (d.toLowerCase() === domain) grants.push(games);
  }
  if (grants.includes('*')) return '*';
  return [...new Set(grants.flatMap((g) => (g === '*' ? [] : g)))];
}

export function canSeeGame(access: GameAccess, gameId: string): boolean {
  return access === '*' || access.includes(gameId);
}

export function filterGames<T extends { game_id: string }>(access: GameAccess, games: T[]): T[] {
  return access === '*' ? games : games.filter((g) => access.includes(g.game_id));
}
