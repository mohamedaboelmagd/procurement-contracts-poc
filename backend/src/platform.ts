/**
 * Composition root. Wires the two domain modules (sourcing, contracts) to a UnitOfWork, a clock and
 * the in-process event bus. The same wiring is used by the API (MongoDB), the tests and the browser demo
 * (in-memory adapters).
 */
import { systemClock, type Clock } from './shared/clock.js';
import { EventBus } from './shared/events.js';
import { randomIds, type IdGenerator } from './shared/ids.js';
import { OutboxDispatcher } from './shared/outbox.js';
import type { UnitOfWork } from './shared/persistence.js';
import { SourcingService } from './sourcing/sourcing.service.js';
import { ContractsService } from './contracts/contracts.service.js';
import { MemoryStore, MemoryUnitOfWork } from './infra/memory/memory-uow.js';

export interface PlatformDeps {
  uow: UnitOfWork;
  clock?: Clock;
  ids?: IdGenerator;
  log?: (msg: string, err?: unknown) => void;
}

export function createPlatform(deps: PlatformDeps) {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? randomIds;
  const bus = new EventBus();
  const outbox = new OutboxDispatcher(deps.uow, bus, clock, deps.log);
  const dispatch = (events: Parameters<OutboxDispatcher['dispatch']>[0]) => outbox.dispatch(events);
  const sourcing = new SourcingService(deps.uow, clock, ids, dispatch);
  const contracts = new ContractsService(deps.uow, clock, ids, dispatch);

  // Module boundary: contracts learns about awards only through the event, never by reading RFx data.
  bus.subscribe('rfx.awarded', (e) => contracts.onRfxAwarded(e));

  return { uow: deps.uow, clock, ids, bus, outbox, sourcing, contracts };
}

export type Platform = ReturnType<typeof createPlatform>;

export function createInMemoryPlatform(opts: { clock?: Clock; ids?: IdGenerator; log?: PlatformDeps['log'] } = {}) {
  const clock = opts.clock ?? systemClock;
  const ids = opts.ids ?? randomIds;
  const store = new MemoryStore();
  const uow = new MemoryUnitOfWork(store, ids, clock);
  return { ...createPlatform({ uow, clock, ids, ...(opts.log ? { log: opts.log } : {}) }), store };
}
