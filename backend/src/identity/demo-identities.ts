/**
 * Demo logins and supplier API clients. These are documented fixtures for local runs, not secrets.
 */
import { DEMO_ACTORS, DEMO_TENANT } from '../seed.js';
import type { IdentityStore } from './identity.js';
import { hashSecret } from './passwords.js';

export const DEMO_PASSWORD = 'demo-password-1';

export const DEMO_EMAILS: Record<keyof typeof DEMO_ACTORS, string> = {
  buyer: 'buyer@demo.test',
  pm: 'pm@demo.test',
  commercial: 'commercial@demo.test',
  director: 'director@demo.test',
  granite: 'granite@supplier.test',
  riverside: 'riverside@supplier.test',
  summit: 'summit@supplier.test',
};

export const DEMO_CLIENTS = [
  { id: 'granite-erp', secret: 'granite-client-secret', supplierId: 'sup_granite', name: 'Granite & Rebar ERP (sample)' },
  { id: 'summit-erp', secret: 'summit-client-secret', supplierId: 'sup_summit', name: 'Summit MEP ERP (sample)' },
];

export async function seedIdentities(store: IdentityStore): Promise<void> {
  const passwordHash = await hashSecret(DEMO_PASSWORD);
  for (const [key, actor] of Object.entries(DEMO_ACTORS) as [keyof typeof DEMO_ACTORS, (typeof DEMO_ACTORS)[keyof typeof DEMO_ACTORS]][]) {
    if (await store.getUser(actor.userId)) continue;
    await store.insertUser({
      id: actor.userId,
      tenantId: actor.tenantId,
      email: DEMO_EMAILS[key],
      name: actor.name,
      roles: actor.roles,
      ...('supplierId' in actor && actor.supplierId ? { supplierId: actor.supplierId } : {}),
      passwordHash,
    });
  }
  for (const c of DEMO_CLIENTS) {
    if (await store.getClient(c.id)) continue;
    await store.insertClient({ id: c.id, tenantId: DEMO_TENANT, name: c.name, supplierId: c.supplierId, secretHash: await hashSecret(c.secret), scopes: ['rfx:read', 'bids:write', 'contracts:read'] });
  }
}
