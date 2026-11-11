import { describe, expect, it } from 'vitest';
import { A, RFQ_INPUT, setup } from '../helpers.js';

describe('in-memory unit of work (same semantics as the Mongo adapter)', () => {
  it('rolls back every write when the callback throws', async () => {
    const { p } = setup();
    await expect(
      p.uow.run(async (tx) => {
        await tx.counters.insert({ id: 'c1', tenantId: 't', version: 1, value: 1 });
        tx.audit({ tenantId: 't', entityType: 'rfx', entityId: 'x', action: 'test', actorId: 'a', actorName: 'a' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await p.uow.read.counters.get('t', 'c1')).toBeNull();
    expect(await p.uow.read.auditLog.find('t')).toEqual([]);
  });

  it('detects a lost update between two concurrent transactions', async () => {
    const { p } = setup();
    await p.uow.run(async (tx) => tx.counters.insert({ id: 'c', tenantId: 't', version: 1, value: 0 }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = p.uow.run(async (tx) => {
      const c = (await tx.counters.get('t', 'c'))!;
      await gate;
      await tx.counters.update({ ...c, value: c.value + 1, version: c.version + 1 });
    });
    await p.uow.run(async (tx) => {
      const c = (await tx.counters.get('t', 'c'))!;
      await tx.counters.update({ ...c, value: c.value + 10, version: c.version + 1 });
    });
    release();
    await expect(slow).rejects.toThrow(/modified concurrently/);
    expect((await p.uow.read.counters.get('t', 'c'))!.value).toBe(10);
  });

  it('numbers documents without gaps or duplicates under concurrency (retry on conflict)', async () => {
    const { p } = setup();
    const made = await Promise.all(Array.from({ length: 5 }, () => p.sourcing.create(A.buyer, RFQ_INPUT)));
    expect(made.map((r) => r.number).sort()).toEqual(['RFQ-0001', 'RFQ-0002', 'RFQ-0003', 'RFQ-0004', 'RFQ-0005']);
  });

  it('isolates tenants', async () => {
    const { p } = setup();
    const rfx = await p.sourcing.create(A.buyer, RFQ_INPUT);
    await expect(p.sourcing.get({ ...A.buyer, tenantId: 'other' }, rfx.id)).rejects.toThrow(/not found/);
  });
});
