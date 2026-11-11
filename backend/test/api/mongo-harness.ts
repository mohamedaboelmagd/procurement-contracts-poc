import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/http/app.js';
import { AuthService } from '../../src/identity/auth.service.js';
import { DEMO_PASSWORD, seedIdentities } from '../../src/identity/demo-identities.js';
import { MongoIdentityStore } from '../../src/infra/mongo/mongo-identity.js';
import { createModels, initModels, type Models } from '../../src/infra/mongo/models.js';
import { MongoUnitOfWork } from '../../src/infra/mongo/mongo-uow.js';
import { createPlatform, type Platform } from '../../src/platform.js';
import { systemClock } from '../../src/shared/clock.js';
import { randomIds } from '../../src/shared/ids.js';

/** Real MongoDB (single-node replica set, so transactions work) + the real Express app. */
export async function startApi() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const conn: Connection = await mongoose.createConnection(replSet.getUri()).asPromise();
  const models: Models = createModels(conn);
  await initModels(models);
  const platform: Platform = createPlatform({ uow: new MongoUnitOfWork(conn, models, randomIds, systemClock), log: () => {} });
  const identity = new MongoIdentityStore(models);
  await seedIdentities(identity);
  const app = createApp({ platform, auth: new AuthService(identity, systemClock, { jwtSecret: 'api-test-secret-api-test-secret-12345' }) });
  const http = request(app);

  async function login(email: string) {
    const res = await http.post('/auth/login').send({ email, password: DEMO_PASSWORD }).expect(200);
    return res.body as { access_token: string; refresh_token: string };
  }
  async function bearer(email: string) {
    return `Bearer ${(await login(email)).access_token}`;
  }

  return {
    http,
    platform,
    models,
    login,
    bearer,
    async stop() {
      await conn.close();
      await replSet.stop();
    },
  };
}
