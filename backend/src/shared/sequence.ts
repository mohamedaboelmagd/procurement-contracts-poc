import type { Tx } from './persistence.js';

/**
 * Human-readable document numbers (RFQ-0001, CT-0001, CO-003) from a counter document updated in the
 * caller's transaction. Two concurrent creators collide on the counter's version and one retries,
 * so numbers are gap-free per tenant and never duplicated.
 */
export async function nextNumber(tx: Tx, tenantId: string, key: string, prefix: string, pad = 4): Promise<string> {
  const id = `${tenantId}:${key}`;
  const current = await tx.counters.get(tenantId, id);
  let value: number;
  if (current) {
    value = current.value + 1;
    await tx.counters.update({ ...current, value, version: current.version + 1 });
  } else {
    value = 1;
    await tx.counters.insert({ id, tenantId, version: 1, value });
  }
  return `${prefix}-${String(value).padStart(pad, '0')}`;
}
