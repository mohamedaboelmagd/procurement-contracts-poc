import { describe, expect, it } from 'vitest';
import { A, awardedContract, setup } from '../helpers.js';
import { DelegationOfAuthorityPolicy } from '../../src/contracts/approval-policy.js';
import { computeTotals, type ChangeOrderDraft } from '../../src/contracts/change-order.js';
import { assertContractInvariants } from '../../src/contracts/contract.js';
import { toMinor } from '../../src/shared/money.js';

const draft = (over: Partial<ChangeOrderDraft> = {}): ChangeOrderDraft => ({
  title: 'Extra drains',
  reason: 'DESIGN_CHANGE',
  description: '',
  lines: [{ kind: 'ADD', sovLineId: null, description: 'Floor drains', costType: 'MATERIAL', quantity: 4, unit: 'nr', unitPriceMinor: toMinor(50) }],
  markupBps: 1_000,
  scheduleImpactDays: 2,
  ...over,
});

describe('change orders', () => {
  it('computes totals with markup on added work only (credits at cost)', () => {
    const t = computeTotals(
      [
        { kind: 'ADD', quantity: 10, unitPriceMinor: 1_000 },
        { kind: 'OMIT', quantity: 2, unitPriceMinor: 1_500 },
      ],
      1_000,
    );
    expect(t).toEqual({ addsMinor: 10_000, omitsMinor: -3_000, costMinor: 7_000, markupMinor: 1_000, totalMinor: 8_000 });
  });

  it('routes approvals by delegation of authority', () => {
    const policy = new DelegationOfAuthorityPolicy();
    const ctx = { contractOriginalMinor: 1_000_000, approvedChangesMinor: 0, scheduleImpactDays: 0 };
    expect(policy.steps({ ...ctx, totalMinor: 0 }).map((s) => s.role)).toEqual(['project_manager']);
    expect(policy.steps({ ...ctx, totalMinor: 10_000 }).map((s) => s.role)).toEqual(['project_manager', 'commercial_manager']);
    expect(policy.steps({ ...ctx, totalMinor: 50_000 }).map((s) => s.role)).toContain('director'); // ≥ 5%
    expect(policy.steps({ ...ctx, totalMinor: 10_000, approvedChangesMinor: 95_000 }).map((s) => s.role)).toContain('director'); // cumulative > 10%
    expect(policy.steps({ ...ctx, totalMinor: 10_000, scheduleImpactDays: 21 }).map((s) => s.role)).toContain('director');
  });

  it('approves step by step and revises the contract in the same transaction', async () => {
    const { p } = setup();
    const { contract } = await awardedContract(p);
    const co = await p.contracts.createChangeOrder(A.granite, contract.id, draft());
    expect(co).toMatchObject({ number: 'CO-001', status: 'DRAFT', totals: { totalMinor: toMinor(220) } });
    const submitted = await p.contracts.submit(A.granite, co.id);
    expect(submitted.steps.map((s) => `${s.role}:${s.status}`)).toEqual(['project_manager:PENDING', 'commercial_manager:WAITING']);
    await expect(p.contracts.decide(A.commercial, co.id, { decision: 'APPROVE' })).rejects.toThrow(/Waiting for Project manager/);
    await p.contracts.decide(A.pm, co.id, { decision: 'APPROVE' });
    const approved = await p.contracts.decide(A.commercial, co.id, { decision: 'APPROVE' });
    expect(approved.status).toBe('APPROVED');

    const revised = await p.contracts.get(A.buyer, contract.id);
    expect(revised.revisedValueMinor).toBe(toMinor(22_500 + 220));
    expect(revised.revision).toBe(2);
    expect(revised.revisions.at(-1)).toMatchObject({ changeOrderNumber: 'CO-001', valueMinor: toMinor(22_720) });
    expect(revised.revisedCompletionDate > revised.originalCompletionDate).toBe(true);
    expect(revised.sov.map((s) => s.code)).toEqual(['A', 'B', 'CO-001.1', 'CO-001.OHP']);
    expect(() => assertContractInvariants(revised)).not.toThrow();
  });

  it('enforces segregation of duties', async () => {
    const { p } = setup();
    const { contract } = await awardedContract(p);
    const co = await p.contracts.createChangeOrder(A.pm, contract.id, draft());
    await p.contracts.submit(A.pm, co.id);
    await expect(p.contracts.decide(A.pm, co.id, { decision: 'APPROVE' })).rejects.toThrow(/someone else/);
    const both = { ...A.pm, userId: 'usr_both', roles: ['project_manager' as const, 'commercial_manager' as const] };
    const co2 = await p.contracts.createChangeOrder(A.granite, contract.id, draft());
    await p.contracts.submit(A.granite, co2.id);
    await p.contracts.decide(both, co2.id, { decision: 'APPROVE' });
    await expect(p.contracts.decide(both, co2.id, { decision: 'APPROVE' })).rejects.toThrow(/earlier step/);
  });

  it('needs a comment to reject; a rework starts a new revision and keeps history', async () => {
    const { p } = setup();
    const { contract } = await awardedContract(p);
    const co = await p.contracts.createChangeOrder(A.granite, contract.id, draft());
    await p.contracts.submit(A.granite, co.id);
    await expect(p.contracts.decide(A.pm, co.id, { decision: 'REJECT' })).rejects.toThrow(/comment/);
    const rejected = await p.contracts.decide(A.pm, co.id, { decision: 'REJECT', comment: 'Rate too high' });
    expect(rejected.status).toBe('REJECTED');
    const reworked = await p.contracts.updateChangeOrder(A.granite, co.id, draft({ markupBps: 500 }), rejected.version);
    expect(reworked).toMatchObject({ status: 'DRAFT', revision: 2, steps: [] });
    expect(reworked.history).toHaveLength(1);
    expect(reworked.history[0]).toMatchObject({ revision: 1, status: 'REJECTED', totals: { totalMinor: toMinor(220) } });
    await expect(p.contracts.updateChangeOrder(A.granite, co.id, draft(), rejected.version)).rejects.toThrow(/changed since you loaded it/);
    const contractAfter = await p.contracts.get(A.buyer, contract.id);
    expect(contractAfter.revisedValueMinor).toBe(contract.revisedValueMinor);
  });

  it('rejects omissions larger than the schedule-of-values line', async () => {
    const { p } = setup();
    const { contract } = await awardedContract(p);
    const lineA = contract.sov[0]!; // 10,000.00
    const omit = { kind: 'OMIT' as const, sovLineId: lineA.id, description: 'Omit', costType: 'MATERIAL' as const, quantity: 101, unit: 'm³', unitPriceMinor: toMinor(100) };
    await expect(p.contracts.createChangeOrder(A.pm, contract.id, draft({ lines: [omit] }))).rejects.toThrow(/exceed/);
    await expect(p.contracts.createChangeOrder(A.pm, contract.id, draft({ lines: [{ ...omit, sovLineId: null }] }))).rejects.toThrow(/must reference/);
  });

  it('keeps suppliers to their own contracts', async () => {
    const { p } = setup();
    const { contract } = await awardedContract(p);
    await expect(p.contracts.get(A.riverside, contract.id)).rejects.toThrow(/not found/);
    expect(await p.contracts.list(A.riverside)).toEqual([]);
    await expect(p.contracts.createChangeOrder(A.director, contract.id, draft())).rejects.toThrow(/permission/);
  });

  it('handles a redelivered rfx.awarded event without creating a second contract', async () => {
    const { p } = setup();
    const { rfx } = await awardedContract(p);
    const evt = [...p.store.data.outbox.values()].map((o) => (o as unknown as { event: { type: string } }).event).find((e) => e.type === 'rfx.awarded')!;
    await p.contracts.onRfxAwarded(evt as never);
    expect((await p.contracts.list(A.buyer)).filter((c) => c.rfxId === rfx.id)).toHaveLength(1);
  });
});
