import type { Clock } from './clock.js';
import type { DomainEvent, EventBus } from './events.js';
import type { UnitOfWork } from './persistence.js';

/**
 * Publishes committed events and marks their outbox records dispatched. If a handler fails the record
 * stays pending and `relayPending` (run on boot / on a timer) re-publishes it: at-least-once delivery.
 */
export class OutboxDispatcher {
  constructor(
    private uow: UnitOfWork,
    private bus: EventBus,
    private clock: Clock,
    private log: (msg: string, err?: unknown) => void = (m, e) => console.error(m, e),
  ) {}

  async dispatch(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      try {
        await this.bus.publish(event);
        await this.uow.run(async (tx) => {
          const rec = await tx.outbox.get(event.tenantId, event.id);
          if (rec && !rec.dispatchedAt) await tx.outbox.update({ ...rec, version: rec.version + 1, dispatchedAt: this.clock.now().toISOString() });
        });
      } catch (err) {
        this.log(`event ${event.type} ${event.id} left pending for relay`, err);
      }
    }
  }

  async relayPending(tenantId: string): Promise<number> {
    const pending = await this.uow.read.outbox.find(tenantId, { dispatchedAt: null }, { sort: { field: 'id', dir: 1 } });
    await this.dispatch(pending.map((p) => p.event));
    return pending.length;
  }
}
