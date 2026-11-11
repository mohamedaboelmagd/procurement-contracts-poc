import { describe, expect, it } from 'vitest';
import { A, RFQ_INPUT, rfqWithBids, setup } from '../helpers.js';
import { toMinor } from '../../src/shared/money.js';

describe('sourcing: RFx lifecycle and sealed bids', () => {
  it('runs draft → published → closed → awarded and creates the contract through the event', async () => {
    const { p } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000], ['riverside', 90, 1200], ['summit', 95, 1100]]);
    expect(rfx.number).toBe('RFQ-0001');
    await p.sourcing.close(A.buyer, rfx.id);
    const awarded = await p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_granite' });
    expect(awarded.status).toBe('AWARDED');
    expect(awarded.award).toMatchObject({ supplierId: 'sup_granite', totalMinor: toMinor(22_500), lowestBid: true });
    const contract = await p.contracts.byRfx(A.buyer, rfx.id);
    expect(contract).toMatchObject({ number: 'CT-0001', originalValueMinor: toMinor(22_500), revisedValueMinor: toMinor(22_500) });
    expect(contract!.sov.map((s) => s.code)).toEqual(['A', 'B']);
  });

  it('keeps prices sealed until bidding closes', async () => {
    const { p } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000]]);
    await expect(p.sourcing.levelling(A.buyer, rfx.id)).rejects.toThrow(/sealed/);
    const summaries = await p.sourcing.bidSummaries(A.buyer, rfx.id);
    const g = summaries.find((s) => s.supplierId === 'sup_granite')!;
    expect(g.status).toBe('SUBMITTED');
    expect(g.sealHash).toMatch(/^[0-9a-f]{64}$/);
    expect(g.totalMinor).toBeUndefined();
    // The audit trail records the seal, never the price.
    const activity = await p.contracts.recentActivity(A.buyer);
    expect(JSON.stringify(activity)).not.toContain(String(toMinor(100)));
  });

  it('lets only invited suppliers bid, and hides competitors from them', async () => {
    const { p } = setup();
    const rfx = await p.sourcing.create(A.buyer, { ...RFQ_INPUT, suppliers: [RFQ_INPUT.suppliers[0]!, RFQ_INPUT.suppliers[1]!] });
    await p.sourcing.publish(A.buyer, rfx.id);
    await expect(p.sourcing.get(A.summit, rfx.id)).rejects.toThrow(/not found/);
    const seen = await p.sourcing.get(A.granite, rfx.id);
    expect(seen.invitations.map((i) => i.supplierId)).toEqual(['sup_granite']);
    await expect(p.sourcing.submitBid(A.buyer, rfx.id, { lines: [], leadTimeDays: 1, validityDays: 1 })).rejects.toThrow(/permission/);
  });

  it('revises a bid before the deadline with a new seal, and refuses bids after it', async () => {
    const { p, clock } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000]]);
    const line = rfx.lines[0]!.id;
    const r2 = await p.sourcing.submitBid(A.granite, rfx.id, { lines: [{ lineId: line, unitPriceMinor: 9_000 }], leadTimeDays: 50, validityDays: 30 });
    expect(r2.revision).toBe(2);
    clock.advanceDays(8);
    await expect(p.sourcing.submitBid(A.granite, rfx.id, { lines: [{ lineId: line, unitPriceMinor: 1 }], leadTimeDays: 50, validityDays: 30 })).rejects.toThrow(/not open/);
  });

  it('closes early only when every invited supplier has responded', async () => {
    const { p, clock } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000]]);
    await expect(p.sourcing.close(A.buyer, rfx.id)).rejects.toThrow(/2 supplier\(s\) have not responded/);
    await p.sourcing.declineInvitation(A.summit, rfx.id);
    clock.advanceDays(7);
    await expect(p.sourcing.close(A.buyer, rfx.id)).resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('requires a justification to award anything but the recommended bid', async () => {
    const { p } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000], ['riverside', 110, 1100], ['summit', 120, 1200]]);
    await p.sourcing.close(A.buyer, rfx.id);
    await expect(p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_riverside' })).rejects.toThrow(/justification/);
    const r = await p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_riverside', justification: 'Shorter programme and local batching plant' });
    expect(r.award!.lowestBid).toBe(false);
    await expect(p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_granite' })).rejects.toThrow(/must be CLOSED/);
  });

  it('detects a bid that was altered after submission (seal check)', async () => {
    const { p } = setup();
    const rfx = await rfqWithBids(p, [['granite', 100, 1000], ['riverside', 110, 1100], ['summit', 120, 1200]]);
    const store = p.store.data.bids;
    const tampered = [...store.values()].find((b) => (b as unknown as { supplierId: string }).supplierId === 'sup_granite') as unknown as { lines: { unitPriceMinor: number }[] };
    tampered.lines[0]!.unitPriceMinor = 1; // someone edits the database directly
    await p.sourcing.close(A.buyer, rfx.id);
    const summaries = await p.sourcing.bidSummaries(A.buyer, rfx.id);
    expect(summaries.find((s) => s.supplierId === 'sup_granite')!.sealVerified).toBe(false);
    await expect(p.sourcing.award(A.buyer, rfx.id, { supplierId: 'sup_granite' })).rejects.toThrow(/seal does not verify/);
  });

  it('enforces the state machine and RFI rules', async () => {
    const { p } = setup();
    const rfi = await p.sourcing.create(A.buyer, { ...RFQ_INPUT, type: 'RFI', lines: [{ code: 'Q1', description: 'Capacity?', unit: 'answer', quantity: 1 }] });
    expect(rfi.number).toBe('RFI-0001');
    await expect(p.sourcing.close(A.buyer, rfi.id)).rejects.toThrow(/DRAFT/);
    await expect(p.sourcing.create(A.buyer, { ...RFQ_INPUT, lines: [RFQ_INPUT.lines[0]!, RFQ_INPUT.lines[0]!] })).rejects.toThrow(/unique/);
    await expect(p.sourcing.create(A.pm, RFQ_INPUT)).rejects.toThrow(/permission rfx:write/);
  });
});
