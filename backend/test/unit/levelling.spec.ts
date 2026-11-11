import { describe, expect, it } from 'vitest';
import { levelBids } from '../../src/sourcing/levelling.js';
import type { Bid } from '../../src/sourcing/bid.js';
import type { Rfx } from '../../src/sourcing/rfx.js';

const rfx = {
  id: 'rfx_1',
  currency: 'USD',
  lines: [
    { id: 'l1', code: 'A', description: 'a', unit: 'm', quantity: 10 },
    { id: 'l2', code: 'B', description: 'b', unit: 'm', quantity: 2 },
    { id: 'l3', code: 'C', description: 'c', unit: 'nr', quantity: 1 },
  ],
} as Rfx;

const bid = (supplierId: string, prices: Record<string, number>, leadTimeDays = 30): Bid =>
  ({
    id: `bid_${supplierId}`,
    supplierId,
    supplierName: supplierId,
    leadTimeDays,
    lines: Object.entries(prices).map(([lineId, unitPriceMinor]) => ({ lineId, unitPriceMinor })),
    totalMinor: Object.entries(prices).reduce((s, [id, p]) => s + p * rfx.lines.find((l) => l.id === id)!.quantity, 0),
  }) as Bid;

describe('bid levelling', () => {
  it('plugs missing lines with the highest quote so a gap never looks cheaper', () => {
    const m = levelBids(rfx, [bid('full', { l1: 100, l2: 500, l3: 2000 }), bid('gappy', { l1: 90, l2: 450 }), bid('pricey', { l1: 120, l2: 520, l3: 2600 })]);
    const gappy = m.suppliers.find((s) => s.supplierId === 'gappy')!;
    expect(gappy.quotedTotalMinor).toBe(1800);
    expect(gappy.normalisedTotalMinor).toBe(1800 + 2600);
    expect(gappy.missingLineIds).toEqual(['l3']);
    expect(m.lines[2]!.cells.gappy).toMatchObject({ plugged: true, unitPriceMinor: 2600, isLowest: false });
    expect(m.suppliers.map((s) => s.supplierId)).toEqual(['full', 'gappy', 'pricey']);
    expect(m.recommendedSupplierId).toBe('full');
  });

  it('marks the lowest cell per line and the spread', () => {
    const m = levelBids(rfx, [bid('x', { l1: 100, l2: 500, l3: 1000 }), bid('y', { l1: 80, l2: 600, l3: 1000 })]);
    expect(m.lines[0]!.cells.y!.isLowest).toBe(true);
    expect(m.lines[0]!.cells.x!.deltaVsLowestBps).toBe(2_500);
    expect(m.lines[0]!.spreadBps).toBe(2_500);
    expect(m.lines[2]!.cells.x!.isLowest && m.lines[2]!.cells.y!.isLowest).toBe(true); // ties
  });

  it('flags unit prices far from the median as outliers (needs 3+ quotes)', () => {
    const m = levelBids(rfx, [bid('a', { l1: 100, l2: 500, l3: 1000 }), bid('b', { l1: 105, l2: 510, l3: 1000 }), bid('c', { l1: 200, l2: 505, l3: 1000 })]);
    expect(m.lines[0]!.cells.c!.outlier).toBe(true);
    expect(m.suppliers.find((s) => s.supplierId === 'c')!.outlierCount).toBe(1);
  });

  it('breaks ties on lead time', () => {
    const m = levelBids(rfx, [bid('slow', { l1: 100, l2: 500, l3: 1000 }, 90), bid('fast', { l1: 100, l2: 500, l3: 1000 }, 30)]);
    expect(m.suppliers[0]!.supplierId).toBe('fast');
  });
});
