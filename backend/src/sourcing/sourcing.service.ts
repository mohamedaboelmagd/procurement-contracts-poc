import { authorize, isSupplier, type Actor } from '../shared/actor.js';
import type { Clock } from '../shared/clock.js';
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from '../shared/errors.js';
import type { RfxAwardedPayload } from '../shared/events.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Currency } from '../shared/money.js';
import type { Tx, UnitOfWork } from '../shared/persistence.js';
import { withConflictRetry } from '../shared/retry.js';
import { nextNumber } from '../shared/sequence.js';
import { computeSeal, priceBid, verifySeal, type Bid, type BidInput } from './bid.js';
import { levelBids, type LevellingMatrix } from './levelling.js';
import { assertClosable, assertPublishable, isBiddingOpen, transition, type Rfx, type RfxType } from './rfx.js';

export interface CreateRfxInput {
  type: RfxType;
  title: string;
  projectName: string;
  currency: Currency;
  bidDueAt: string;
  lines: { code: string; description: string; unit: string; quantity: number }[];
  suppliers: { supplierId: string; supplierName: string }[];
}

/** What anyone can see about a bid before opening: that it exists, never its prices. */
export interface SealedBidSummary {
  supplierId: string;
  supplierName: string;
  status: 'INVITED' | 'SUBMITTED' | 'DECLINED';
  submittedAt?: string;
  revision?: number;
  sealHash?: string;
  /** Present only after the RFx closes. */
  totalMinor?: number;
  sealVerified?: boolean;
}

export interface BidReceipt {
  bidId: string;
  rfxId: string;
  revision: number;
  submittedAt: string;
  sealHash: string;
}

export type Dispatch = (events: import('../shared/events.js').DomainEvent[]) => Promise<void>;

export class SourcingService {
  constructor(
    private uow: UnitOfWork,
    private clock: Clock,
    private ids: IdGenerator,
    private dispatch: Dispatch,
  ) {}

  private async load(tx: Pick<Tx, 'rfx'>, actor: Actor, id: string): Promise<Rfx> {
    const rfx = await tx.rfx.get(actor.tenantId, id);
    if (!rfx) throw new NotFoundError('RFx', id);
    // Suppliers only see events they're invited to; for anyone else it doesn't exist (404, not 403).
    if (isSupplier(actor) && !rfx.invitations.some((i) => i.supplierId === actor.supplierId)) {
      throw new NotFoundError('RFx', id);
    }
    return rfx;
  }

  /** Suppliers never see the invitation list (who else is bidding). */
  private view(actor: Actor, rfx: Rfx): Rfx {
    if (!isSupplier(actor)) return rfx;
    const { award, ...rest } = rfx;
    return {
      ...rest,
      invitations: rfx.invitations.filter((i) => i.supplierId === actor.supplierId),
      ...(award && award.supplierId === actor.supplierId ? { award } : {}),
    };
  }

  private async commit<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const { result, events } = await withConflictRetry(() => this.uow.run(work));
    await this.dispatch(events);
    return result;
  }

  async create(actor: Actor, input: CreateRfxInput): Promise<Rfx> {
    authorize(actor, 'rfx:write');
    const codes = new Set(input.lines.map((l) => l.code));
    if (codes.size !== input.lines.length) throw new ValidationError('Line codes must be unique');
    const supplierIds = new Set(input.suppliers.map((s) => s.supplierId));
    if (supplierIds.size !== input.suppliers.length) throw new ValidationError('A supplier is invited twice');
    const now = this.clock.now().toISOString();
    return this.commit(async (tx) => {
      const rfx: Rfx = {
        id: this.ids.next('rfx'),
        tenantId: actor.tenantId,
        version: 1,
        number: await nextNumber(tx, actor.tenantId, `rfx-${input.type}`, input.type),
        type: input.type,
        title: input.title,
        projectName: input.projectName,
        currency: input.currency,
        status: 'DRAFT',
        lines: input.lines.map((l) => ({ ...l, id: this.ids.next('ln') })),
        invitations: input.suppliers.map((s) => ({ ...s, status: 'INVITED' as const, invitedAt: now })),
        bidDueAt: new Date(input.bidDueAt).toISOString(),
        createdBy: actor.userId,
        createdAt: now,
      };
      await tx.rfx.insert(rfx);
      tx.audit({ tenantId: actor.tenantId, entityType: 'rfx', entityId: rfx.id, action: 'created', actorId: actor.userId, actorName: actor.name, details: { number: rfx.number, lines: rfx.lines.length } });
      return rfx;
    });
  }

  async list(actor: Actor): Promise<Rfx[]> {
    authorize(actor, 'rfx:read');
    const all = await this.uow.read.rfx.find(actor.tenantId, {}, { sort: { field: 'createdAt', dir: -1 } });
    return all
      .filter((r) => !isSupplier(actor) || (r.status !== 'DRAFT' && r.invitations.some((i) => i.supplierId === actor.supplierId)))
      .map((r) => this.view(actor, r));
  }

  async get(actor: Actor, id: string): Promise<Rfx> {
    authorize(actor, 'rfx:read');
    const rfx = await this.load(this.uow.read, actor, id);
    if (isSupplier(actor) && rfx.status === 'DRAFT') throw new NotFoundError('RFx', id);
    return this.view(actor, rfx);
  }

  async publish(actor: Actor, id: string): Promise<Rfx> {
    authorize(actor, 'rfx:write');
    return this.commit(async (tx) => {
      const rfx = await this.load(tx, actor, id);
      assertPublishable(rfx, this.clock.now());
      const next = { ...transition(rfx, 'PUBLISHED'), publishedAt: this.clock.now().toISOString() };
      await tx.rfx.update(next);
      tx.audit({ tenantId: actor.tenantId, entityType: 'rfx', entityId: id, action: 'published', actorId: actor.userId, actorName: actor.name, details: { invited: rfx.invitations.length, bidDueAt: rfx.bidDueAt } });
      tx.emit({ type: 'rfx.published', tenantId: actor.tenantId, aggregateId: id, payload: { number: rfx.number, supplierIds: rfx.invitations.map((i) => i.supplierId) } });
      return next;
    });
  }

  /** Create or revise the caller's sealed bid. Only invited suppliers, only while bidding is open. */
  async submitBid(actor: Actor, rfxId: string, input: BidInput): Promise<BidReceipt> {
    authorize(actor, 'bids:write');
    if (!actor.supplierId) throw new ForbiddenError('Only suppliers can submit bids');
    const supplierId = actor.supplierId;
    return this.commit(async (tx) => {
      const rfx = await this.load(tx, actor, rfxId);
      if (!isBiddingOpen(rfx, this.clock.now())) throw new InvalidStateError(`Bidding on ${rfx.number} is not open`);
      const invitation = rfx.invitations.find((i) => i.supplierId === supplierId)!;
      if (invitation.status === 'DECLINED') throw new InvalidStateError('You declined this invitation');
      const totalMinor = priceBid(rfx, input);
      const existing = (await tx.bids.find(actor.tenantId, { rfxId, supplierId }))[0];
      const submittedAt = this.clock.now().toISOString();
      const base = {
        rfxId,
        supplierId,
        supplierName: invitation.supplierName,
        lines: input.lines.map((l) => ({ lineId: l.lineId, unitPriceMinor: l.unitPriceMinor, ...(l.note ? { note: l.note } : {}) })),
        totalMinor,
        leadTimeDays: input.leadTimeDays,
        validityDays: input.validityDays,
        ...(input.exclusions ? { exclusions: input.exclusions } : {}),
        revision: (existing?.revision ?? 0) + 1,
        submittedAt,
      };
      const sealHash = await computeSeal(base);
      const bid: Bid = existing
        ? { ...existing, ...base, sealHash, version: existing.version + 1 }
        : { ...base, sealHash, id: this.ids.next('bid'), tenantId: actor.tenantId, version: 1 };
      if (existing) await tx.bids.update(bid);
      else await tx.bids.insert(bid);
      await tx.rfx.update({
        ...rfx,
        version: rfx.version + 1,
        invitations: rfx.invitations.map((i) => (i.supplierId === supplierId ? { ...i, status: 'SUBMITTED' as const, respondedAt: submittedAt } : i)),
      });
      // The audit trail records that a bid arrived and its seal, never the price.
      tx.audit({ tenantId: actor.tenantId, entityType: 'bid', entityId: bid.id, action: existing ? 'bid.revised' : 'bid.submitted', actorId: actor.userId, actorName: actor.name, details: { rfxId, revision: bid.revision, sealHash } });
      tx.emit({ type: 'bid.submitted', tenantId: actor.tenantId, aggregateId: rfxId, payload: { supplierId, revision: bid.revision } });
      return { bidId: bid.id, rfxId, revision: bid.revision, submittedAt, sealHash };
    });
  }

  async declineInvitation(actor: Actor, rfxId: string): Promise<void> {
    authorize(actor, 'bids:write');
    await this.commit(async (tx) => {
      const rfx = await this.load(tx, actor, rfxId);
      if (!isBiddingOpen(rfx, this.clock.now())) throw new InvalidStateError(`Bidding on ${rfx.number} is not open`);
      const inv = rfx.invitations.find((i) => i.supplierId === actor.supplierId)!;
      if (inv.status === 'SUBMITTED') throw new InvalidStateError('You already submitted a bid');
      await tx.rfx.update({
        ...rfx,
        version: rfx.version + 1,
        invitations: rfx.invitations.map((i) => (i === inv ? { ...i, status: 'DECLINED' as const, respondedAt: this.clock.now().toISOString() } : i)),
      });
      tx.audit({ tenantId: actor.tenantId, entityType: 'rfx', entityId: rfxId, action: 'invitation.declined', actorId: actor.userId, actorName: actor.name });
    });
  }

  /** Before closing: who has responded and their seal receipts. After closing: totals too. */
  async bidSummaries(actor: Actor, rfxId: string): Promise<SealedBidSummary[]> {
    authorize(actor, 'bids:read');
    const rfx = await this.load(this.uow.read, actor, rfxId);
    const bids = await this.uow.read.bids.find(actor.tenantId, { rfxId });
    const opened = rfx.status === 'CLOSED' || rfx.status === 'AWARDED';
    return Promise.all(
      rfx.invitations.map(async (inv) => {
        const bid = bids.find((b) => b.supplierId === inv.supplierId);
        const summary: SealedBidSummary = { supplierId: inv.supplierId, supplierName: inv.supplierName, status: inv.status };
        if (bid) {
          Object.assign(summary, { submittedAt: bid.submittedAt, revision: bid.revision, sealHash: bid.sealHash });
          if (opened) Object.assign(summary, { totalMinor: bid.totalMinor, sealVerified: await verifySeal(bid) });
        }
        return summary;
      }),
    );
  }

  async close(actor: Actor, id: string): Promise<Rfx> {
    authorize(actor, 'rfx:write');
    return this.commit(async (tx) => {
      const rfx = await this.load(tx, actor, id);
      if (rfx.status !== 'PUBLISHED') throw new InvalidStateError(`${rfx.number} is ${rfx.status}`);
      assertClosable(rfx, this.clock.now());
      const next = { ...transition(rfx, 'CLOSED'), closedAt: this.clock.now().toISOString() };
      await tx.rfx.update(next);
      const bids = await tx.bids.find(actor.tenantId, { rfxId: id });
      const tampered = (await Promise.all(bids.map(async (b) => ((await verifySeal(b)) ? null : b.supplierId)))).filter(Boolean);
      tx.audit({ tenantId: actor.tenantId, entityType: 'rfx', entityId: id, action: 'bids.opened', actorId: actor.userId, actorName: actor.name, details: { bids: bids.length, sealsVerified: tampered.length === 0, tampered } });
      tx.emit({ type: 'rfx.closed', tenantId: actor.tenantId, aggregateId: id, payload: { bids: bids.length } });
      return next;
    });
  }

  async levelling(actor: Actor, id: string): Promise<LevellingMatrix> {
    authorize(actor, 'bids:read');
    const rfx = await this.load(this.uow.read, actor, id);
    if (rfx.status !== 'CLOSED' && rfx.status !== 'AWARDED') {
      throw new ForbiddenError('Bids are sealed until bidding closes');
    }
    const bids = await this.uow.read.bids.find(actor.tenantId, { rfxId: id });
    return levelBids(rfx, bids);
  }

  /**
   * Award to one supplier. Awarding anything other than the recommended (cheapest complete) bid needs a
   * written justification. The award event carries the bid lines so the contracts module never reads
   * sourcing's collections.
   */
  async award(actor: Actor, id: string, input: { supplierId: string; justification?: string }): Promise<Rfx> {
    authorize(actor, 'rfx:award');
    return this.commit(async (tx) => {
      const rfx = await this.load(tx, actor, id);
      if (rfx.status !== 'CLOSED') throw new InvalidStateError(`${rfx.number} must be CLOSED to award (is ${rfx.status})`);
      if (rfx.type === 'RFI') throw new InvalidStateError('An RFI gathers information; it cannot be awarded');
      const bids = await tx.bids.find(actor.tenantId, { rfxId: id });
      const bid = bids.find((b) => b.supplierId === input.supplierId);
      if (!bid) throw new ValidationError('That supplier has no bid on this event');
      if (!(await verifySeal(bid))) throw new InvalidStateError('Bid seal does not verify; investigate before awarding');
      const matrix = levelBids(rfx, bids);
      const lowest = matrix.recommendedSupplierId === input.supplierId;
      if (!lowest && (input.justification ?? '').trim().length < 15) {
        throw new ValidationError('Awarding a bid other than the recommended one needs a justification (15+ characters)');
      }
      const awardedAt = this.clock.now().toISOString();
      const next: Rfx = {
        ...transition(rfx, 'AWARDED'),
        award: {
          supplierId: bid.supplierId,
          supplierName: bid.supplierName,
          bidId: bid.id,
          totalMinor: bid.totalMinor,
          awardedAt,
          awardedBy: actor.userId,
          lowestBid: lowest,
          ...(input.justification ? { justification: input.justification.trim() } : {}),
        },
      };
      await tx.rfx.update(next);
      tx.audit({ tenantId: actor.tenantId, entityType: 'rfx', entityId: id, action: 'awarded', actorId: actor.userId, actorName: actor.name, details: { supplierId: bid.supplierId, totalMinor: bid.totalMinor, recommended: lowest } });
      const payload: RfxAwardedPayload = {
        rfxId: id,
        rfxNumber: rfx.number,
        title: rfx.title,
        projectName: rfx.projectName,
        currency: rfx.currency,
        supplierId: bid.supplierId,
        supplierName: bid.supplierName,
        bidId: bid.id,
        leadTimeDays: bid.leadTimeDays,
        awardedAt,
        lines: rfx.lines
          .filter((l) => bid.lines.some((b) => b.lineId === l.id))
          .map((l) => ({ lineId: l.id, code: l.code, description: l.description, unit: l.unit, quantity: l.quantity, unitPriceMinor: bid.lines.find((b) => b.lineId === l.id)!.unitPriceMinor })),
      };
      tx.emit({ type: 'rfx.awarded', tenantId: actor.tenantId, aggregateId: id, payload });
      return next;
    });
  }
}
