import { createInMemoryPlatform } from '../src/platform.js';
import { DEMO_ACTORS, SUPPLIERS } from '../src/seed.js';
import { FixedClock, addDays } from '../src/shared/clock.js';
import { SequentialIds } from '../src/shared/ids.js';
import { toMinor } from '../src/shared/money.js';

export const T0 = '2026-11-02T08:00:00.000Z';
export const A = DEMO_ACTORS;

export function setup() {
  const clock = new FixedClock(T0);
  const p = createInMemoryPlatform({ clock, ids: new SequentialIds(), log: () => {} });
  return { p, clock };
}

export const RFQ_INPUT = {
  type: 'RFQ' as const,
  title: 'Test package',
  projectName: 'Test project',
  currency: 'USD' as const,
  bidDueAt: addDays(T0, 7),
  lines: [
    { code: 'A', description: 'Concrete', unit: 'm³', quantity: 100 },
    { code: 'B', description: 'Rebar', unit: 't', quantity: 12.5 },
  ],
  suppliers: [...SUPPLIERS],
};

/** Published RFQ with bids from the given suppliers: [actorKey, priceA, priceB?] */
export async function rfqWithBids(p: ReturnType<typeof setup>['p'], bids: [keyof typeof A, number, number | undefined][]) {
  const rfx = await p.sourcing.create(A.buyer, RFQ_INPUT);
  await p.sourcing.publish(A.buyer, rfx.id);
  const [a, b] = rfx.lines.map((l) => l.id) as [string, string];
  for (const [who, pa, pb] of bids) {
    await p.sourcing.submitBid(A[who], rfx.id, {
      lines: [{ lineId: a, unitPriceMinor: toMinor(pa) }, ...(pb !== undefined ? [{ lineId: b, unitPriceMinor: toMinor(pb) }] : [])],
      leadTimeDays: 60,
      validityDays: 30,
    });
  }
  return rfx;
}

/** A closed, awarded RFQ (granite cheapest) and its contract. Contract value = 100×100 + 12.5×1000 = 22,500.00 */
export async function awardedContract(p: ReturnType<typeof setup>['p']) {
  const rfx = await rfqWithBids(p, [
    ['granite', 100, 1000],
    ['riverside', 110, 1100],
    ['summit', 120, 1050],
  ]);
  await p.sourcing.close(A.buyer, rfx.id);
  await p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_granite' });
  const contract = (await p.contracts.byRfx(A.buyer, rfx.id))!;
  return { rfx, contract };
}
