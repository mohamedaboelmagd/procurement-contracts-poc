/**
 * Authentication: JWT access tokens (short-lived) + rotating opaque refresh tokens with reuse detection,
 * and the OAuth 2.0 client-credentials grant for supplier systems.
 */
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Actor, Role } from '../shared/actor.js';
import type { Clock } from '../shared/clock.js';
import { UnauthenticatedError, ValidationError } from '../shared/errors.js';
import type { IdentityStore, UserRecord } from './identity.js';
import { opaqueToken, sha256, verifySecret } from './passwords.js';

export interface AuthConfig {
  jwtSecret: string;
  issuer?: string;
  audience?: string;
  accessTtlSec?: number;
  clientTtlSec?: number;
  refreshTtlSec?: number;
}

export interface TokenPair {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

export const SUPPORTED_SCOPES = ['rfx:read', 'bids:write', 'contracts:read'] as const;

interface Claims {
  tid: string;
  name: string;
  roles: Role[];
  sid?: string;
  scope?: string;
}

export class AuthService {
  private key: Uint8Array;
  private issuer: string;
  private audience: string;
  private accessTtl: number;
  private clientTtl: number;
  private refreshTtl: number;

  constructor(
    private store: IdentityStore,
    private clock: Clock,
    cfg: AuthConfig,
  ) {
    if (cfg.jwtSecret.length < 32) throw new Error('JWT secret must be at least 32 characters');
    this.key = new TextEncoder().encode(cfg.jwtSecret);
    this.issuer = cfg.issuer ?? 'procurement-contracts-poc';
    this.audience = cfg.audience ?? 'procurement-api';
    this.accessTtl = cfg.accessTtlSec ?? 900;
    this.clientTtl = cfg.clientTtlSec ?? 600;
    this.refreshTtl = cfg.refreshTtlSec ?? 7 * 86_400;
  }

  private nowSec() {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  private sign(sub: string, claims: Claims, ttl: number): Promise<string> {
    const iat = this.nowSec();
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttl)
      .setJti(randomUUID())
      .sign(this.key);
  }

  private async issuePair(user: UserRecord, familyId: string): Promise<TokenPair> {
    const access = await this.sign(user.id, { tid: user.tenantId, name: user.name, roles: user.roles, ...(user.supplierId ? { sid: user.supplierId } : {}) }, this.accessTtl);
    const refresh = opaqueToken();
    await this.store.insertRefresh({
      id: sha256(refresh),
      familyId,
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt: new Date((this.nowSec() + this.refreshTtl) * 1000).toISOString(),
      usedAt: null,
      revokedAt: null,
    });
    return { token_type: 'Bearer', access_token: access, expires_in: this.accessTtl, refresh_token: refresh };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.store.findUserByEmail(email);
    // Same error and similar work whether the user exists or not.
    const ok = await verifySecret(password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || !ok) throw new UnauthenticatedError('Invalid email or password');
    return this.issuePair(user, randomUUID());
  }

  /**
   * Rotate: the presented refresh token is burned and a new pair issued in the same family.
   * Presenting an already-used token means it leaked: the whole family is revoked.
   */
  async refresh(token: string): Promise<TokenPair> {
    const id = sha256(token);
    const rec = await this.store.getRefresh(id);
    const at = this.clock.now().toISOString();
    if (!rec || rec.revokedAt || new Date(rec.expiresAt) <= this.clock.now()) throw new UnauthenticatedError('Refresh token is invalid or expired');
    if (!(await this.store.markRefreshUsed(id, at))) {
      await this.store.revokeFamily(rec.familyId, at);
      throw new UnauthenticatedError('Refresh token reuse detected; session revoked');
    }
    const user = await this.store.getUser(rec.userId);
    if (!user) throw new UnauthenticatedError('User no longer exists');
    return this.issuePair(user, rec.familyId);
  }

  async logout(token: string): Promise<void> {
    const rec = await this.store.getRefresh(sha256(token));
    if (rec) await this.store.revokeFamily(rec.familyId, this.clock.now().toISOString());
  }

  /** OAuth 2.0 client credentials (RFC 6749 §4.4). Requested scopes must be a subset of the client's. */
  async clientCredentials(clientId: string, clientSecret: string, scope?: string): Promise<{ token_type: 'Bearer'; access_token: string; expires_in: number; scope: string }> {
    const client = await this.store.getClient(clientId);
    const ok = client ? await verifySecret(clientSecret, client.secretHash) : false;
    if (!client || !ok) throw new UnauthenticatedError('invalid_client');
    const requested = scope ? scope.split(' ').filter(Boolean) : client.scopes;
    const denied = requested.filter((s) => !client.scopes.includes(s));
    if (denied.length) throw new ValidationError(`invalid_scope: ${denied.join(' ')}`);
    const token = await this.sign(`client:${client.id}`, { tid: client.tenantId, name: client.name, roles: ['supplier'], sid: client.supplierId, scope: requested.join(' ') }, this.clientTtl);
    return { token_type: 'Bearer', access_token: token, expires_in: this.clientTtl, scope: requested.join(' ') };
  }

  async verify(token: string): Promise<Actor> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      const c = payload as unknown as Claims & { sub: string };
      return {
        userId: c.sub,
        name: c.name,
        tenantId: c.tid,
        roles: c.roles,
        ...(c.sid ? { supplierId: c.sid } : {}),
        ...(c.scope !== undefined ? { scopes: c.scope.split(' ').filter(Boolean) } : {}),
      };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw new UnauthenticatedError('Access token expired');
      throw new UnauthenticatedError('Invalid access token');
    }
  }
}
