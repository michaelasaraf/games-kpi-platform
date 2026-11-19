import { describe, expect, it } from 'vitest';
import { provisionalFrom } from '../src/queries.js';

describe('provisionalFrom', () => {
  it('is today minus settle_days in UTC', () => {
    const now = new Date('2026-11-19T07:50:00Z');
    expect(provisionalFrom(3, now)).toBe('2026-11-16');
    expect(provisionalFrom(1, now)).toBe('2026-11-18');
    expect(provisionalFrom(0, now)).toBe('2026-11-19');
  });

  it('crosses month ends and ignores negative values', () => {
    expect(provisionalFrom(3, new Date('2026-12-02T23:59:00Z'))).toBe('2026-11-29');
    expect(provisionalFrom(-2, new Date('2026-12-02T00:00:00Z'))).toBe('2026-12-02');
  });
});
