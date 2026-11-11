/** Integration events between modules. Names are the contract; payloads carry the state the consumer needs. */
export interface DomainEvent<T = unknown> {
  id: string;
  type: EventType;
  tenantId: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
}

export type EventType =
  | 'rfx.published'
  | 'bid.submitted'
  | 'rfx.closed'
  | 'rfx.awarded'
  | 'contract.created'
  | 'change_order.submitted'
  | 'change_order.approved'
  | 'change_order.rejected';

export interface RfxAwardedPayload {
  rfxId: string;
  rfxNumber: string;
  title: string;
  projectName: string;
  currency: string;
  supplierId: string;
  supplierName: string;
  bidId: string;
  leadTimeDays: number;
  awardedAt: string;
  lines: { lineId: string; code: string; description: string; unit: string; quantity: number; unitPriceMinor: number }[];
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

/** In-process bus. Delivery is at-least-once (outbox), so handlers must be idempotent. */
export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private listeners: ((e: DomainEvent) => void)[] = [];

  subscribe(type: EventType, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  /** Observe every event (demo event stream, logging). */
  tap(listener: (e: DomainEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    for (const l of this.listeners) l(event);
    for (const h of this.handlers.get(event.type) ?? []) await h(event);
  }
}
