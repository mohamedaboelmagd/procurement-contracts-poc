/**
 * MongoDB adapter: repositories over Mongoose models, a UnitOfWork backed by multi-document
 * transactions (requires a replica set), optimistic concurrency via `version` in the update filter.
 */
import type { ClientSession, Connection } from 'mongoose';
import type { Clock } from '../../shared/clock.js';
import { ConcurrencyError, ConflictError } from '../../shared/errors.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Entity, Filter, FindOptions, Repos, Repository, Tx, UnitOfWork } from '../../shared/persistence.js';
import { buildTx } from '../../shared/tx.js';
import type { AnyModel, Models } from './models.js';

type Doc = Record<string, unknown> & { _id: string };

const toDoc = <T extends Entity>({ id, ...rest }: T): Doc => ({ _id: id, ...rest });
const fromDoc = <T>(doc: Doc | null): T | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest } as T;
};

function isDuplicateKey(err: unknown): err is { code: number; keyValue?: unknown } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export class MongoRepository<T extends Entity> implements Repository<T> {
  constructor(
    private model: AnyModel,
    private name: string,
    private session?: ClientSession,
  ) {}

  async get(tenantId: string, id: string): Promise<T | null> {
    const doc = await this.model.findOne({ _id: id, tenantId }, null, { session: this.session }).lean<Doc>();
    return fromDoc<T>(doc);
  }

  async find(tenantId: string, filter: Filter<T> = {}, options: FindOptions<T> = {}): Promise<T[]> {
    const q: Record<string, unknown> = { tenantId };
    for (const [k, v] of Object.entries(filter)) if (v !== undefined) q[k === 'id' ? '_id' : k] = v;
    let query = this.model.find(q, null, { session: this.session });
    if (options.sort) query = query.sort({ [options.sort.field === 'id' ? '_id' : options.sort.field]: options.sort.dir, _id: 1 });
    if (options.limit) query = query.limit(options.limit);
    const docs = await query.lean<Doc[]>();
    return docs.map((d) => fromDoc<T>(d)!);
  }

  async insert(doc: T): Promise<void> {
    try {
      await this.model.create([toDoc(doc)], { session: this.session });
    } catch (err) {
      if (isDuplicateKey(err)) {
        const keys = Object.keys((err.keyValue ?? {}) as object);
        // Same _id inserted by two transactions = a race (retry); any other unique key = a business conflict.
        if (keys.length === 1 && keys[0] === '_id') throw new ConcurrencyError(`${this.name} ${doc.id} was created concurrently`);
        throw new ConflictError(`Duplicate ${this.name} for ${keys.join('+')}`);
      }
      throw err;
    }
  }

  async update(doc: T): Promise<void> {
    const { _id, ...rest } = toDoc(doc);
    try {
      const res = await this.model.replaceOne({ _id, tenantId: doc.tenantId, version: doc.version - 1 }, { _id, ...rest }, { session: this.session });
      if (res.matchedCount === 0) throw new ConcurrencyError(`${this.name} ${doc.id} was modified concurrently`);
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictError(`Duplicate ${this.name}`);
      throw err;
    }
  }
}

const NAMES: Record<keyof Repos, string> = {
  rfx: 'rfx',
  bids: 'bids',
  contracts: 'contracts',
  changeOrders: 'changeOrders',
  auditLog: 'audit',
  counters: 'counters',
  outbox: 'outbox',
};

function reposFor(models: Models, session?: ClientSession): Repos {
  const r = <T extends Entity>(k: keyof Repos) => new MongoRepository<T>(models[k], NAMES[k], session);
  return {
    rfx: r('rfx'),
    bids: r('bids'),
    contracts: r('contracts'),
    changeOrders: r('changeOrders'),
    auditLog: r('auditLog'),
    counters: r('counters'),
    outbox: r('outbox'),
  };
}

export class MongoUnitOfWork implements UnitOfWork {
  readonly read: Repos;
  constructor(
    private conn: Connection,
    private models: Models,
    private ids: IdGenerator,
    private clock: Clock,
  ) {
    this.read = reposFor(models);
  }

  async run<T>(work: (tx: Tx) => Promise<T>) {
    const session = await this.conn.startSession();
    try {
      let out: { result: T; events: Awaited<ReturnType<typeof buildTx>>['events'] } | undefined;
      // withTransaction retries the callback on TransientTransactionError (e.g. write conflicts),
      // which is why the callback rebuilds the tx buffers each attempt.
      await session.withTransaction(
        async () => {
          const { tx, flush, events } = buildTx(reposFor(this.models, session), this.ids, this.clock);
          const result = await work(tx);
          await flush();
          out = { result, events };
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
      return out!;
    } finally {
      await session.endSession();
    }
  }
}
