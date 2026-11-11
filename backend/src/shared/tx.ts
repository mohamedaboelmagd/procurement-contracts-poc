import type { Clock } from './clock.js';
import type { DomainEvent } from './events.js';
import type { IdGenerator } from './ids.js';
import type { AuditEntry, Repos, Tx } from './persistence.js';

/**
 * Shared transaction bookkeeping for every adapter: events and audit entries are buffered while the
 * work runs and written (outbox + audit collections) inside the same transaction just before commit.
 */
export function buildTx(repos: Repos, ids: IdGenerator, clock: Clock) {
  const events: DomainEvent[] = [];
  const audits: AuditEntry[] = [];
  const tx: Tx = {
    ...repos,
    emit(e) {
      events.push({ ...e, id: ids.next('evt'), occurredAt: clock.now().toISOString() });
    },
    audit(a) {
      audits.push({ ...a, id: ids.next('aud'), version: 1, at: clock.now().toISOString() });
    },
  };
  async function flush(): Promise<void> {
    for (const a of audits) await repos.auditLog.insert(a);
    for (const e of events) {
      await repos.outbox.insert({ id: e.id, tenantId: e.tenantId, version: 1, event: e, dispatchedAt: null });
    }
  }
  return { tx, flush, events };
}
