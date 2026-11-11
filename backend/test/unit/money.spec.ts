import { describe, expect, it } from 'vitest';
import { allocate, applyBps, deltaBps, divRound, formatMoney, lineTotal, toMinor } from '../../src/shared/money.js';

describe('money (integer minor units)', () => {
  it('multiplies unit price by fractional quantities without float drift', () => {
    expect(lineTotal(toMinor(980), 180.5)).toBe(17_689_000); // 176,890.00
    expect(lineTotal(1, 0.5)).toBe(1); // half away from zero
    expect(lineTotal(333, 0.333)).toBe(111); // 110.889 → 111
    expect(0.1 * 3).not.toBe(0.3); // the reason for all of this
    expect(lineTotal(10, 3) / 10).toBe(3);
  });

  it('rejects quantities with more than 3 decimals', () => {
    expect(() => lineTotal(100, 1.2345)).toThrow(/3 decimals/);
  });

  it('applies basis points with symmetric rounding', () => {
    expect(applyBps(1_687_600, 1_000)).toBe(168_760);
    expect(applyBps(5, 1_000)).toBe(1); // 0.5 → 1
    expect(applyBps(-5, 1_000)).toBe(-1);
    expect(divRound(-7, 2)).toBe(-4);
  });

  it('allocates a lump sum so the parts add up exactly', () => {
    const parts = allocate(1_000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(-100, [3, 1]).reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('computes deltas and formats amounts', () => {
    expect(deltaBps(110, 100)).toBe(1_000);
    expect(formatMoney(-123_456, 'USD')).toBe('−USD 1,234.56');
  });
});
