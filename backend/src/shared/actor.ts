import { ForbiddenError } from './errors.js';

export type Role = 'buyer' | 'project_manager' | 'commercial_manager' | 'director' | 'supplier' | 'admin';

/** Who is calling. Built from a verified JWT (users) or a client-credentials token (supplier systems). */
export interface Actor {
  userId: string;
  name: string;
  tenantId: string;
  roles: Role[];
  /** Set for supplier users and supplier API clients. */
  supplierId?: string;
  /** OAuth scopes for machine clients; undefined for interactive users. */
  scopes?: string[];
}

export type Permission =
  | 'rfx:read'
  | 'rfx:write'
  | 'rfx:award'
  | 'bids:read'
  | 'bids:write'
  | 'contracts:read'
  | 'change_orders:write'
  | 'change_orders:decide'
  | 'audit:read';

/** Role → permission matrix. One place to review who can do what. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  buyer: ['rfx:read', 'rfx:write', 'rfx:award', 'bids:read', 'contracts:read', 'audit:read'],
  project_manager: ['rfx:read', 'contracts:read', 'change_orders:write', 'change_orders:decide', 'audit:read'],
  commercial_manager: ['rfx:read', 'rfx:award', 'bids:read', 'contracts:read', 'change_orders:write', 'change_orders:decide', 'audit:read'],
  director: ['rfx:read', 'rfx:award', 'bids:read', 'contracts:read', 'change_orders:decide', 'audit:read'],
  supplier: ['rfx:read', 'bids:write', 'contracts:read', 'change_orders:write'],
  admin: ['rfx:read', 'contracts:read', 'audit:read'],
};

/** OAuth scope that a machine client needs for a permission (users get scopes implicitly from roles). */
const SCOPE_FOR: Partial<Record<Permission, string>> = {
  'rfx:read': 'rfx:read',
  'bids:write': 'bids:write',
  'contracts:read': 'contracts:read',
};

export function can(actor: Actor, permission: Permission): boolean {
  const byRole = actor.roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
  if (!byRole) return false;
  if (actor.scopes) {
    const scope = SCOPE_FOR[permission];
    return scope !== undefined && actor.scopes.includes(scope);
  }
  return true;
}

export function authorize(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

export function isSupplier(actor: Actor): boolean {
  return actor.roles.includes('supplier');
}
