import type { Role } from '../shared/actor.js';

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: Role[];
  supplierId?: string;
  passwordHash: string;
}

/** OAuth 2.0 client for supplier systems (client-credentials grant). */
export interface ClientRecord {
  id: string; // client_id
  tenantId: string;
  name: string;
  supplierId: string;
  secretHash: string;
  scopes: string[];
}

/** Refresh tokens are opaque; only their SHA-256 is stored. Rotated on every use. */
export interface RefreshTokenRecord {
  id: string; // sha256(token)
  familyId: string;
  userId: string;
  tenantId: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export interface IdentityStore {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  getUser(id: string): Promise<UserRecord | null>;
  getClient(id: string): Promise<ClientRecord | null>;
  insertUser(u: UserRecord): Promise<void>;
  insertClient(c: ClientRecord): Promise<void>;
  insertRefresh(t: RefreshTokenRecord): Promise<void>;
  getRefresh(id: string): Promise<RefreshTokenRecord | null>;
  /** Atomically mark a token used. Returns false if it was already used or revoked (a replay). */
  markRefreshUsed(id: string, at: string): Promise<boolean>;
  revokeFamily(familyId: string, at: string): Promise<void>;
}

export class MemoryIdentityStore implements IdentityStore {
  private users = new Map<string, UserRecord>();
  private clients = new Map<string, ClientRecord>();
  private refresh = new Map<string, RefreshTokenRecord>();
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getClient(id: string) {
    return this.clients.get(id) ?? null;
  }
  async insertUser(u: UserRecord) {
    this.users.set(u.id, { ...u, email: u.email.toLowerCase() });
  }
  async insertClient(c: ClientRecord) {
    this.clients.set(c.id, c);
  }
  async insertRefresh(t: RefreshTokenRecord) {
    this.refresh.set(t.id, t);
  }
  async getRefresh(id: string) {
    return this.refresh.get(id) ?? null;
  }
  async markRefreshUsed(id: string, at: string) {
    const t = this.refresh.get(id);
    if (!t || t.usedAt || t.revokedAt) return false;
    this.refresh.set(id, { ...t, usedAt: at });
    return true;
  }
  async revokeFamily(familyId: string, at: string) {
    for (const [k, t] of this.refresh) if (t.familyId === familyId && !t.revokedAt) this.refresh.set(k, { ...t, revokedAt: at });
  }
}
