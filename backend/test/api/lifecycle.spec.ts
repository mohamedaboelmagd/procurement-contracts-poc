/**
 * End-to-end through HTTP against a real MongoDB replica set:
 * RFQ → sealed bids (user + OAuth client) → close → levelling → award → contract → change order approvals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi } from './mongo-harness.js';

let api: Awaited<ReturnType<typeof startApi>>;
const H: Record<string, string> = {};
const state: { rfxId?: string; lines?: { id: string; code: string }[]; contractId?: string; coId?: string; etag?: string; clientToken?: string } = {};

beforeAll(async () => {
  api = await startApi();
  for (const [k, email] of Object.entries({ buyer: 'buyer@demo.test', pm: 'pm@demo.test', cm: 'commercial@demo.test', dir: 'director@demo.test', riverside: 'riverside@supplier.test', summit: 'summit@supplier.test' })) {
    H[k] = await api.bearer(email);
  }
}, 120_000);
afterAll(async () => api?.stop());

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('API: sourcing → contract → change orders (MongoDB)', () => {
  it('serves health, OpenAPI and rejects anonymous calls', async () => {
    await api.http.get('/health').expect(200, { status: 'ok' });
    const spec = await api.http.get('/openapi.json').expect(200);
    expect(spec.body.openapi).toBe('3.1.0');
    expect(spec.body.paths['/api/v1/change-orders/{id}/decision'].post.requestBody).toBeDefined();
    const res = await api.http.get('/api/v1/rfx').expect(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('validates input with field-level errors', async () => {
    const res = await api.http.post('/api/v1/rfx').set('Authorization', H.buyer!).send({ type: 'RFQ', title: '', lines: [] }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.details.fieldErrors).toHaveProperty('title');
  });

  it('creates and publishes an RFQ (buyer only)', async () => {
    const body = {
      type: 'RFQ',
      title: 'Podium slab package',
      projectName: 'API test project',
      currency: 'USD',
      bidDueAt: inDays(5),
      lines: [
        { code: 'A', description: 'Concrete C40', unit: 'm³', quantity: 100 },
        { code: 'B', description: 'Rebar', unit: 't', quantity: 12.5 },
      ],
      suppliers: [
        { supplierId: 'sup_granite', supplierName: 'Granite (sample)' },
        { supplierId: 'sup_riverside', supplierName: 'Riverside (sample)' },
        { supplierId: 'sup_summit', supplierName: 'Summit (sample)' },
      ],
    };
    await api.http.post('/api/v1/rfx').set('Authorization', H.pm!).send(body).expect(403);
    const created = await api.http.post('/api/v1/rfx').set('Authorization', H.buyer!).send(body).expect(201);
    expect(created.body).toMatchObject({ number: 'RFQ-0001', status: 'DRAFT' });
    state.rfxId = created.body.id;
    state.lines = created.body.lines;
    await api.http.post(`/api/v1/rfx/${state.rfxId}/publish`).set('Authorization', H.buyer!).expect(200);
  });

  it('accepts a sealed bid from a supplier ERP via OAuth 2.0 client credentials', async () => {
    const basic = Buffer.from('granite-erp:granite-client-secret').toString('base64');
    await api.http.post('/oauth/token').type('form').send({ grant_type: 'client_credentials' }).set('Authorization', 'Basic ' + Buffer.from('granite-erp:bad').toString('base64')).expect(401);
    const tok = await api.http.post('/oauth/token').type('form').set('Authorization', `Basic ${basic}`).send({ grant_type: 'client_credentials', scope: 'rfx:read bids:write' }).expect(200);
    expect(tok.body).toMatchObject({ token_type: 'Bearer', scope: 'rfx:read bids:write' });
    state.clientToken = `Bearer ${tok.body.access_token}`;
    const list = await api.http.get('/supplier/v1/rfx').set('Authorization', state.clientToken).expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(state.rfxId);
    expect(list.body.data[0].invitations).toHaveLength(1); // can't see competitors
    const [a, b] = state.lines!;
    const receipt = await api.http
      .put(`/supplier/v1/rfx/${state.rfxId}/bid`)
      .set('Authorization', state.clientToken)
      .send({ lines: [{ lineId: a!.id, unitPriceMinor: 10_000 }, { lineId: b!.id, unitPriceMinor: 100_000 }], leadTimeDays: 60, validityDays: 30 })
      .expect(200);
    expect(receipt.body.sealHash).toMatch(/^[0-9a-f]{64}$/);
    // Machine tokens stay inside the supplier API.
    await api.http.get('/api/v1/contracts').set('Authorization', state.clientToken).expect(403);
  });

  it('keeps bids sealed from the buyer until closing', async () => {
    await api.http.get(`/api/v1/rfx/${state.rfxId}/levelling`).set('Authorization', H.buyer!).expect(403);
    const bids = await api.http.get(`/api/v1/rfx/${state.rfxId}/bids`).set('Authorization', H.buyer!).expect(200);
    const granite = bids.body.data.find((b: { supplierId: string }) => b.supplierId === 'sup_granite');
    expect(granite.status).toBe('SUBMITTED');
    expect(granite.totalMinor).toBeUndefined();
    await api.http.post(`/api/v1/rfx/${state.rfxId}/close`).set('Authorization', H.buyer!).expect(409); // 2 still to respond
  });

  it('takes bids from supplier users, then closes, levels and awards', async () => {
    const [a, b] = state.lines!;
    const bid = (pa: number, pb?: number) => ({ lines: [{ lineId: a!.id, unitPriceMinor: pa }, ...(pb ? [{ lineId: b!.id, unitPriceMinor: pb }] : [])], leadTimeDays: 45, validityDays: 30 });
    await api.http.put(`/supplier/v1/rfx/${state.rfxId}/bid`).set('Authorization', H.riverside!).send(bid(9_000)).expect(200);
    await api.http.put(`/supplier/v1/rfx/${state.rfxId}/bid`).set('Authorization', H.summit!).send(bid(12_000, 110_000)).expect(200);
    await api.http.post(`/api/v1/rfx/${state.rfxId}/close`).set('Authorization', H.buyer!).expect(200);

    const lv = await api.http.get(`/api/v1/rfx/${state.rfxId}/levelling`).set('Authorization', H.buyer!).expect(200);
    expect(lv.body.suppliers.map((s: { supplierId: string }) => s.supplierId)).toEqual(['sup_granite', 'sup_riverside', 'sup_summit']);
    const riverside = lv.body.suppliers[1];
    expect(riverside.missingLineIds).toHaveLength(1); // raw total cheapest, but incomplete
    expect(riverside.quotedTotalMinor).toBeLessThan(lv.body.suppliers[0].quotedTotalMinor);
    expect(lv.body.recommendedSupplierId).toBe('sup_granite');

    const awarded = await api.http.post(`/api/v1/rfx/${state.rfxId}/award`).set('Authorization', H.buyer!).send({ supplierId: 'sup_granite' }).expect(200);
    expect(awarded.body.rfx.status).toBe('AWARDED');
    state.contractId = awarded.body.contractId;
    const c = await api.http.get(`/api/v1/contracts/${state.contractId}`).set('Authorization', H.buyer!).expect(200);
    expect(c.body).toMatchObject({ number: 'CT-0001', originalValueMinor: 2_250_000, revisedValueMinor: 2_250_000, supplierId: 'sup_granite' });
    await api.http.get(`/api/v1/contracts/${state.contractId}`).set('Authorization', H.riverside!).expect(404);
  });

  it('drafts a change order with optimistic concurrency (If-Match)', async () => {
    const granite = await api.bearer('granite@supplier.test');
    H.granite = granite;
    const created = await api.http
      .post(`/api/v1/contracts/${state.contractId}/change-orders`)
      .set('Authorization', granite)
      .send({
        title: 'Extra drains',
        reason: 'DESIGN_CHANGE',
        lines: [{ kind: 'ADD', description: 'Floor drains', costType: 'MATERIAL', quantity: 4, unit: 'nr', unitPriceMinor: 5_000 }],
        markupBps: 1_000,
        scheduleImpactDays: 3,
      })
      .expect(201);
    expect(created.body.totals.totalMinor).toBe(22_000);
    state.coId = created.body.id;
    state.etag = created.headers.etag;
    const edit = { ...created.body, lines: [{ ...created.body.lines[0], quantity: 6 }] };
    delete edit.id;
    const payload = { title: edit.title, reason: edit.reason, description: '', lines: edit.lines.map(({ id: _id, ...l }: { id: string }) => l), markupBps: 1_000, scheduleImpactDays: 3 };
    await api.http.put(`/api/v1/change-orders/${state.coId}`).set('Authorization', granite).send(payload).expect(428);
    const ok = await api.http.put(`/api/v1/change-orders/${state.coId}`).set('Authorization', granite).set('If-Match', state.etag!).send(payload).expect(200);
    expect(ok.body.totals.totalMinor).toBe(33_000);
    await api.http.put(`/api/v1/change-orders/${state.coId}`).set('Authorization', granite).set('If-Match', state.etag!).send(payload).expect(412);
  });

  it('runs the approval workflow and revises the contract atomically', async () => {
    await api.http.post(`/api/v1/change-orders/${state.coId}/submit`).set('Authorization', H.granite!).expect(200);
    await api.http.post(`/api/v1/change-orders/${state.coId}/decision`).set('Authorization', H.cm!).send({ decision: 'APPROVE' }).expect(403);
    await api.http.post(`/api/v1/change-orders/${state.coId}/decision`).set('Authorization', H.pm!).send({ decision: 'APPROVE', comment: 'OK' }).expect(200);
    // Two commercial approvals racing: exactly one wins, the contract is revised once.
    const [r1, r2] = await Promise.all([
      api.http.post(`/api/v1/change-orders/${state.coId}/decision`).set('Authorization', H.cm!).send({ decision: 'APPROVE' }),
      api.http.post(`/api/v1/change-orders/${state.coId}/decision`).set('Authorization', H.cm!).send({ decision: 'APPROVE' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const c = await api.http.get(`/api/v1/contracts/${state.contractId}`).set('Authorization', H.buyer!).expect(200);
    expect(c.body).toMatchObject({ revisedValueMinor: 2_283_000, approvedChangesMinor: 33_000, revision: 2, scheduleDaysAdded: 3 });
    expect(c.body.revisions).toHaveLength(2);
    const audit = await api.http.get(`/api/v1/audit/${state.coId}`).set('Authorization', H.buyer!).expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['created', 'edited', 'submitted', 'approved.project_manager', 'approved.commercial_manager']));
  });

  it('rolls back the whole transaction when the contract update fails', async () => {
    const created = await api.http
      .post(`/api/v1/contracts/${state.contractId}/change-orders`)
      .set('Authorization', H.granite!)
      .send({ title: 'Small add', reason: 'OWNER_REQUEST', lines: [{ kind: 'ADD', description: 'Sleeve', costType: 'MATERIAL', quantity: 1, unit: 'nr', unitPriceMinor: 1_000 }], markupBps: 0, scheduleImpactDays: 0 })
      .expect(201);
    const id = created.body.id as string;
    await api.http.post(`/api/v1/change-orders/${id}/submit`).set('Authorization', H.granite!).expect(200);
    await api.http.post(`/api/v1/change-orders/${id}/decision`).set('Authorization', H.pm!).send({ decision: 'APPROVE' }).expect(200);
    // Someone bumps the contract version behind our back between read and write → write conflict.
    const original = api.models.contracts.replaceOne.bind(api.models.contracts);
    let sabotaged = false;
    api.models.contracts.replaceOne = ((...args: Parameters<typeof original>) => {
      if (!sabotaged) {
        sabotaged = true;
        throw Object.assign(new Error('simulated failure'), { code: 'SIM' });
      }
      return original(...args);
    }) as typeof original;
    await api.http.post(`/api/v1/change-orders/${id}/decision`).set('Authorization', H.cm!).send({ decision: 'APPROVE' }).expect(500);
    api.models.contracts.replaceOne = original;
    const co = await api.http.get(`/api/v1/change-orders/${id}`).set('Authorization', H.buyer!).expect(200);
    expect(co.body.status).toBe('PENDING_APPROVAL'); // CO approval rolled back with the failed contract write
    expect(co.body.steps[1].status).toBe('PENDING');
    // Retry succeeds.
    await api.http.post(`/api/v1/change-orders/${id}/decision`).set('Authorization', H.cm!).send({ decision: 'APPROVE' }).expect(200);
  });

  it('rotates refresh tokens over HTTP and detects reuse', async () => {
    const first = await api.login('pm@demo.test');
    const second = await api.http.post('/auth/refresh').send({ refresh_token: first.refresh_token }).expect(200);
    expect(second.headers['cache-control']).toBe('no-store');
    await api.http.post('/auth/refresh').send({ refresh_token: first.refresh_token }).expect(401);
    await api.http.post('/auth/refresh').send({ refresh_token: second.body.refresh_token }).expect(401);
  });

  it('creates the contract once even if rfx.awarded is delivered again', async () => {
    const rec = await api.models.outbox.findOne({ 'event.type': 'rfx.awarded' }).lean<{ event: never }>();
    await api.platform.contracts.onRfxAwarded(rec!.event);
    expect(await api.models.contracts.countDocuments({ rfxId: state.rfxId })).toBe(1);
    expect(await api.models.outbox.countDocuments({ dispatchedAt: null })).toBe(0);
  });
});
