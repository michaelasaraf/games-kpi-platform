import { createContext, useContext } from 'react';

/**
 * First day (YYYY-MM-DD) whose numbers are still provisional: Firebase keeps adding events that
 * phones send late (offline play) for a few days after a day ends, so recent days still rise.
 * null when unknown.
 */
export const ProvisionalContext = createContext<string | null>(null);

export function useProvisionalFrom() {
  return useContext(ProvisionalContext);
}

/** Index of the first provisional date in an ascending list of dates, or undefined if none is. */
export function provisionalIndex(dates: string[], from: string | null): number | undefined {
  if (!from) return undefined;
  const i = dates.findIndex((d) => d >= from);
  return i < 0 ? undefined : i;
}

export const PROVISIONAL_NOTE =
  'Recent days are provisional: phones that were offline send their events up to 3 days late, so these days usually still go up a little.';
