/**
 * In-memory UnitOfWork with the same semantics as the MongoDB adapter:
 * - writes are buffered per transaction and only become visible on commit,
 * - updates are version-checked at commit (optimistic concurrency),
 * - unique keys are enforced,
 * - a throw inside the callback discards everything.
 * Used by unit tests and by the static browser demo.
 */
import { ConcurrencyError, ConflictError } from '../../shared/errors.js';
import type { Clock } from '../../shared/clock.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Entity, Filter, FindOptions, Repos, Repository, Tx, UnitOfWork } from '../../shared/persistence.js';
import { buildTx } from '../../shared/tx.js';

type CollectionName = keyof Repos;

/** Unique keys per collection (mirrors the Mongo indexes in infra/mongo/models.ts). */
export const UNIQUE_KEYS: Record<CollectionName, string[][]> = {
  rfx: [['tenantId', 'number']],
  bids: [['tenantId', 'rfxId', 'supplierId']],
  contracts: [['tenantId', 'rfxId'], ['tenantId', 'number']],
  changeOrders: [['tenantId', 'contractId', 'number']],
  auditLog: [],
  counters: [],
  outbox: [],
};

const clone = <T>(v: T): T => structuredClone(v);

function matches<T>(doc: T, filter?: Filter<T>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => v === undefined || (doc as Record<string, unknown>)[k] === v);
}

function applyFind<T extends Entity>(docs: T[], tenantId: string, filter?: Filter<T>, options?: FindOptions<T>): T[] {
  let out = docs.filter((d) => d.tenantId === tenantId && matches(d, filter));
  if (options?.sort) {
    const { field, dir } = options.sort;
    out = out.sort((a, b) => {
      const x = a[field] as unknown as string | number;
      const y = b[field] as unknown as string | number;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  if (options?.limit) out = out.slice(0, options.limit);
  return out.map(clone);
}

export class MemoryStore {
  readonly data: Record<CollectionName, Map<string, Entity>> = {
    rfx: new Map(),
    bids: new Map(),
    contracts: new Map(),
    changeOrders: new Map(),
    auditLog: new Map(),
    counters: new Map(),
    outbox: new Map(),
  };

  uniqueViolation(name: CollectionName, doc: Entity, docs: Iterable<Entity>): string | null {
    for (const key of UNIQUE_KEYS[name]) {
      const sig = key.map((k) => String((doc as unknown as Record<string, unknown>)[k])).join('|');
      for (const other of docs) {
        if (other.id === doc.id) continue;
        if (key.map((k) => String((other as unknown as Record<string, unknown>)[k])).join('|') === sig) {
          return `Duplicate ${name} for ${key.join('+')}`;
        }
      }
    }
    return null;
  }
}

class StoreRepository<T extends Entity> implements Repository<T> {
  constructor(
    private store: MemoryStore,
    private name: CollectionName,
  ) {}
  private get map() {
    return this.store.data[this.name] as Map<string, T>;
  }
  async get(tenantId: string, id: string) {
    const d = this.map.get(id);
    return d && d.tenantId === tenantId ? clone(d) : null;
  }
  async find(tenantId: string, filter?: Filter<T>, options?: FindOptions<T>) {
    return applyFind([...this.map.values()], tenantId, filter, options);
  }
  async insert(doc: T) {
    if (this.map.has(doc.id)) throw new ConflictError(`${this.name} ${doc.id} already exists`);
    const dup = this.store.uniqueViolation(this.name, doc, this.map.values());
    if (dup) throw new ConflictError(dup);
    this.map.set(doc.id, clone(doc));
  }
  async update(doc: T) {
    const cur = this.map.get(doc.id);
    if (!cur || cur.version !== doc.version - 1) throw new ConcurrencyError(`${this.name} ${doc.id} was modified concurrently`);
    this.map.set(doc.id, clone(doc));
  }
}

interface Write {
  name: CollectionName;
  doc: Entity;
  kind: 'insert' | 'update';
  /** For updates: the committed version this transaction read. */
  baseVersion?: number;
}

/** Repository view inside a transaction: reads see the transaction's own writes. */
class TxRepository<T extends Entity> implements Repository<T> {
  constructor(
    private store: MemoryStore,
    private name: CollectionName,
    private writes: Map<string, Write>,
  ) {}
  private key(id: string) {
    return `${this.name}:${id}`;
  }
  private merged(): T[] {
    const base = new Map(this.store.data[this.name] as Map<string, T>);
    for (const w of this.writes.values()) if (w.name === this.name) base.set(w.doc.id, w.doc as T);
    return [...base.values()];
  }
  async get(tenantId: string, id: string) {
    const w = this.writes.get(this.key(id));
    const d = (w?.doc as T | undefined) ?? (this.store.data[this.name].get(id) as T | undefined);
    return d && d.tenantId === tenantId ? clone(d) : null;
  }
  async find(tenantId: string, filter?: Filter<T>, options?: FindOptions<T>) {
    return applyFind(this.merged(), tenantId, filter, options);
  }
  async insert(doc: T) {
    if (this.writes.has(this.key(doc.id)) || this.store.data[this.name].has(doc.id)) {
      throw new ConflictError(`${this.name} ${doc.id} already exists`);
    }
    const dup = this.store.uniqueViolation(this.name, doc, this.merged());
    if (dup) throw new ConflictError(dup);
    this.writes.set(this.key(doc.id), { name: this.name, doc: clone(doc), kind: 'insert' });
  }
  async update(doc: T) {
    const existing = this.writes.get(this.key(doc.id));
    const cur = (existing?.doc as T | undefined) ?? (this.store.data[this.name].get(doc.id) as T | undefined);
    if (!cur || cur.version !== doc.version - 1) throw new ConcurrencyError(`${this.name} ${doc.id} was modified concurrently`);
    // Keep "insert" if the doc was created in this same transaction; remember the committed version otherwise.
    this.writes.set(this.key(doc.id), {
      name: this.name,
      doc: clone(doc),
      kind: existing?.kind ?? 'update',
      baseVersion: existing ? existing.baseVersion : cur.version,
    });
  }
}

function reposFor(make: <T extends Entity>(name: CollectionName) => Repository<T>): Repos {
  return {
    rfx: make('rfx'),
    bids: make('bids'),
    contracts: make('contracts'),
    changeOrders: make('changeOrders'),
    auditLog: make('auditLog'),
    counters: make('counters'),
    outbox: make('outbox'),
  };
}

export class MemoryUnitOfWork implements UnitOfWork {
  readonly read: Repos;
  constructor(
    readonly store: MemoryStore,
    private ids: IdGenerator,
    private clock: Clock,
  ) {
    this.read = reposFor((name) => new StoreRepository(store, name));
  }

  async run<T>(work: (tx: Tx) => Promise<T>) {
    const writes = new Map<string, Write>();
    const repos = reposFor((name) => new TxRepository(this.store, name, writes));
    const { tx, flush, events } = buildTx(repos, this.ids, this.clock);
    const result = await work(tx);
    await flush();
    this.commit(writes);
    return { result, events };
  }

  /** Synchronous: validate every write, then apply all of them. Nothing can interleave. */
  private commit(writes: Map<string, Write>): void {
    for (const w of writes.values()) {
      const map = this.store.data[w.name];
      const cur = map.get(w.doc.id);
      if (w.kind === 'insert') {
        if (cur) throw new ConcurrencyError(`${w.name} ${w.doc.id} was created concurrently`);
        const dup = this.store.uniqueViolation(w.name, w.doc, map.values());
        if (dup) throw new ConflictError(dup);
      } else if (!cur || cur.version !== w.baseVersion) {
        throw new ConcurrencyError(`${w.name} ${w.doc.id} was modified concurrently`);
      }
    }
    for (const w of writes.values()) this.store.data[w.name].set(w.doc.id, w.doc);
  }
}
