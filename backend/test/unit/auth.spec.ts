import { beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/identity/auth.service.js';
import { DEMO_PASSWORD, seedIdentities } from '../../src/identity/demo-identities.js';
import { MemoryIdentityStore } from '../../src/identity/identity.js';
import { FixedClock } from '../../src/shared/clock.js';
import { can } from '../../src/shared/actor.js';

const clock = new FixedClock('2026-11-02T08:00:00Z');
const store = new MemoryIdentityStore();
const auth = new AuthService(store, clock, { jwtSecret: 'test-secret-test-secret-test-secret-123' });

describe('auth: JWT, refresh rotation, client credentials', () => {
  beforeAll(() => seedIdentities(store));

  it('logs in and verifies the access token into an actor', async () => {
    const pair = await auth.login('buyer@demo.test', DEMO_PASSWORD);
    const actor = await auth.verify(pair.access_token);
    expect(actor).toMatchObject({ userId: 'usr_buyer', tenantId: 'tnt_demo', roles: ['buyer'] });
    expect(actor.scopes).toBeUndefined();
    await expect(auth.login('buyer@demo.test', 'wrong')).rejects.toThrow(/Invalid email or password/);
    await expect(auth.login('nobody@demo.test', DEMO_PASSWORD)).rejects.toThrow(/Invalid email or password/);
  });

  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const first = await auth.login('pm@demo.test', DEMO_PASSWORD);
    const second = await auth.refresh(first.refresh_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(auth.refresh(first.refresh_token)).rejects.toThrow(/reuse detected/);
    await expect(auth.refresh(second.refresh_token)).rejects.toThrow(/invalid or expired/); // whole family revoked
  });

  it('expires access tokens', async () => {
    const pair = await auth.login('director@demo.test', DEMO_PASSWORD);
    clock.advanceMs(16 * 60_000);
    await expect(auth.verify(pair.access_token)).rejects.toThrow(/expired/);
  });

  it('issues scoped client-credentials tokens and limits what they can do', async () => {
    const t = await auth.clientCredentials('granite-erp', 'granite-client-secret', 'rfx:read');
    const actor = await auth.verify(t.access_token);
    expect(actor).toMatchObject({ supplierId: 'sup_granite', roles: ['supplier'], scopes: ['rfx:read'] });
    expect(can(actor, 'rfx:read')).toBe(true);
    expect(can(actor, 'bids:write')).toBe(false); // not in the granted scope
    expect(can(actor, 'change_orders:write')).toBe(false); // never for machine clients
    await expect(auth.clientCredentials('granite-erp', 'nope')).rejects.toThrow(/invalid_client/);
    await expect(auth.clientCredentials('granite-erp', 'granite-client-secret', 'admin')).rejects.toThrow(/invalid_scope/);
  });

  it('rejects tokens signed with another key', async () => {
    const other = new AuthService(store, clock, { jwtSecret: 'another-secret-another-secret-another' });
    const pair = await other.login('buyer@demo.test', DEMO_PASSWORD);
    await expect(auth.verify(pair.access_token)).rejects.toThrow(/Invalid access token/);
  });
});
