import type { ClientRecord, IdentityStore, RefreshTokenRecord, UserRecord } from '../../identity/identity.js';
import type { Models } from './models.js';

type WithId = { _id: string };
const out = <T>(d: (WithId & Record<string, unknown>) | null): T | null => {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...rest } as T;
};

export class MongoIdentityStore implements IdentityStore {
  constructor(private m: Models) {}
  async findUserByEmail(email: string) {
    return out<UserRecord>(await this.m.users.findOne({ email: email.toLowerCase() }).lean());
  }
  async getUser(id: string) {
    return out<UserRecord>(await this.m.users.findById(id).lean());
  }
  async getClient(id: string) {
    return out<ClientRecord>(await this.m.clients.findById(id).lean());
  }
  async insertUser({ id, ...u }: UserRecord) {
    await this.m.users.create({ _id: id, ...u });
  }
  async insertClient({ id, ...c }: ClientRecord) {
    await this.m.clients.create({ _id: id, ...c });
  }
  async insertRefresh({ id, ...t }: RefreshTokenRecord) {
    await this.m.refreshTokens.create({ _id: id, ...t });
  }
  async getRefresh(id: string) {
    return out<RefreshTokenRecord>(await this.m.refreshTokens.findById(id).lean());
  }
  async markRefreshUsed(id: string, at: string) {
    const res = await this.m.refreshTokens.updateOne({ _id: id, usedAt: null, revokedAt: null }, { $set: { usedAt: at } });
    return res.modifiedCount === 1;
  }
  async revokeFamily(familyId: string, at: string) {
    await this.m.refreshTokens.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: at } });
  }
}
