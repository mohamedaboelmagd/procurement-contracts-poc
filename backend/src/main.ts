/**
 * Process entry point.
 *   MONGO_URL set   → MongoDB (replica set required for transactions)
 *   MONGO_URL unset → in-memory adapters (local tinkering; data is lost on restart)
 */
import mongoose from 'mongoose';
import { AuthService } from './identity/auth.service.js';
import { seedIdentities } from './identity/demo-identities.js';
import { MemoryIdentityStore, type IdentityStore } from './identity/identity.js';
import { createApp } from './http/app.js';
import { MongoIdentityStore } from './infra/mongo/mongo-identity.js';
import { createModels, initModels } from './infra/mongo/models.js';
import { MongoUnitOfWork } from './infra/mongo/mongo-uow.js';
import { createInMemoryPlatform, createPlatform, type Platform } from './platform.js';
import { DEMO_TENANT, seedDemo } from './seed.js';
import { systemClock } from './shared/clock.js';
import { randomIds } from './shared/ids.js';

const env = process.env;
const port = Number(env.PORT ?? 3000);
const jwtSecret = env.JWT_SECRET ?? 'dev-only-secret-change-me-dev-only-secret';
if (!env.JWT_SECRET) console.warn('JWT_SECRET not set: using a development secret');

let platform: Platform;
let identity: IdentityStore;
if (env.MONGO_URL) {
  const conn = await mongoose.createConnection(env.MONGO_URL).asPromise();
  const models = createModels(conn);
  await initModels(models);
  platform = createPlatform({ uow: new MongoUnitOfWork(conn, models, randomIds, systemClock) });
  identity = new MongoIdentityStore(models);
  const relayed = await platform.outbox.relayPending(DEMO_TENANT);
  if (relayed) console.log(`relayed ${relayed} pending event(s)`);
} else {
  platform = createInMemoryPlatform();
  identity = new MemoryIdentityStore();
}

if (env.SEED_DEMO !== 'false') {
  await seedIdentities(identity);
  if ((await platform.uow.read.rfx.find(DEMO_TENANT, {}, { limit: 1 })).length === 0) {
    await seedDemo(platform);
    console.log('seeded demo data');
  }
}

const app = createApp({ platform, auth: new AuthService(identity, systemClock, { jwtSecret }) });
app.listen(port, '0.0.0.0', () => console.log(`API on :${port}  (docs: /docs, spec: /openapi.json)`));
