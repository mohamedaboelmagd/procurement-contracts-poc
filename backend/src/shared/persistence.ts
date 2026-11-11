/**
 * Persistence ports. Services depend on these interfaces only; adapters live in infra/
 * (in-memory for tests and the browser demo, Mongoose/MongoDB for the real thing).
 */
import type { DomainEvent } from './events.js';
import type { Rfx } from '../sourcing/rfx.js';
import type { Bid } from '../sourcing/bid.js';
import type { Contract } from '../contracts/contract.js';
import type { ChangeOrder } from '../contracts/change-order.js';

export interface Entity {
  id: string;
  tenantId: string;
  /** Optimistic concurrency token. Inserts start at 1; every update must bump it by exactly 1. */
  version: number;
}

export type Filter<T> = Partial<{ [K in keyof T]: T[K] }>;

export interface FindOptions<T> {
  sort?: { field: keyof T & string; dir: 1 | -1 };
  limit?: number;
}

export interface Repository<T extends Entity> {
  get(tenantId: string, id: string): Promise<T | null>;
  find(tenantId: string, filter?: Filter<T>, options?: FindOptions<T>): Promise<T[]>;
  /** Throws ConflictError on a unique-key violation. */
  insert(doc: T): Promise<void>;
  /** Writes `doc` only if the stored version is `doc.version - 1`; otherwise throws ConflictError. */
  update(doc: T): Promise<void>;
}

export interface AuditEntry extends Entity {
  entityType: 'rfx' | 'bid' | 'contract' | 'change_order';
  entityId: string;
  action: string;
  actorId: string;
  actorName: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface Counter extends Entity {
  value: number;
}

export interface OutboxRecord extends Entity {
  event: DomainEvent;
  dispatchedAt: string | null;
}

export interface Repos {
  rfx: Repository<Rfx>;
  bids: Repository<Bid>;
  contracts: Repository<Contract>;
  changeOrders: Repository<ChangeOrder>;
  auditLog: Repository<AuditEntry>;
  counters: Repository<Counter>;
  outbox: Repository<OutboxRecord>;
}

/** What a service sees inside a transaction. */
export interface Tx extends Repos {
  /** Queue an integration event; it is written to the outbox in the same transaction. */
  emit(event: Omit<DomainEvent, 'id' | 'occurredAt'>): void;
  /** Append an audit entry in the same transaction. */
  audit(entry: Omit<AuditEntry, 'id' | 'version' | 'at'>): void;
}

export interface UnitOfWork {
  /**
   * Run `work` atomically. The callback may be retried on transient conflicts, so it must not
   * have side effects outside `tx`. Returns the callback result and the events that were committed.
   */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<{ result: T; events: DomainEvent[] }>;
  /** Non-transactional reads. */
  readonly read: Repos;
}
