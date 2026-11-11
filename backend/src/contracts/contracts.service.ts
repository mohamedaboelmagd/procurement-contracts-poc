import { authorize, isSupplier, type Actor } from '../shared/actor.js';
import { addDays, type Clock } from '../shared/clock.js';
import { ForbiddenError, InvalidStateError, NotFoundError, PreconditionFailedError, ValidationError } from '../shared/errors.js';
import type { DomainEvent, RfxAwardedPayload } from '../shared/events.js';
import type { IdGenerator } from '../shared/ids.js';
import type { AuditEntry, Tx, UnitOfWork } from '../shared/persistence.js';
import { withConflictRetry } from '../shared/retry.js';
import { nextNumber } from '../shared/sequence.js';
import { DelegationOfAuthorityPolicy, type ApprovalPolicy } from './approval-policy.js';
import {
  assertEditable,
  computeTotals,
  currentStep,
  lineAmount,
  validateDraft,
  type ChangeOrder,
  type ChangeOrderDraft,
} from './change-order.js';
import { assertContractInvariants, contractFromAward, type Contract, type SovLine } from './contract.js';
import { ConflictError } from '../shared/errors.js';

export type Dispatch = (events: DomainEvent[]) => Promise<void>;

export class ContractsService {
  constructor(
    private uow: UnitOfWork,
    private clock: Clock,
    private ids: IdGenerator,
    private dispatch: Dispatch,
    private policy: ApprovalPolicy = new DelegationOfAuthorityPolicy(),
  ) {}

  private async commit<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const { result, events } = await withConflictRetry(() => this.uow.run(work));
    await this.dispatch(events);
    return result;
  }

  private async loadContract(tx: Pick<Tx, 'contracts'>, actor: Actor, id: string): Promise<Contract> {
    const c = await tx.contracts.get(actor.tenantId, id);
    if (!c || (isSupplier(actor) && c.supplierId !== actor.supplierId)) throw new NotFoundError('Contract', id);
    return c;
  }

  private async loadCo(tx: Pick<Tx, 'contracts' | 'changeOrders'>, actor: Actor, id: string): Promise<{ co: ChangeOrder; contract: Contract }> {
    const co = await tx.changeOrders.get(actor.tenantId, id);
    if (!co) throw new NotFoundError('Change order', id);
    const contract = await this.loadContract(tx, actor, co.contractId).catch(() => {
      throw new NotFoundError('Change order', id);
    });
    return { co, contract };
  }

  /**
   * Event handler for `rfx.awarded`. Idempotent: the outbox delivers at least once, and the unique
   * (tenantId, rfxId) key means a redelivery can't create a second contract.
   */
  async onRfxAwarded(event: DomainEvent): Promise<void> {
    const p = event.payload as RfxAwardedPayload;
    const existing = await this.uow.read.contracts.find(event.tenantId, { rfxId: p.rfxId });
    if (existing.length) return;
    try {
      await this.commit(async (tx) => {
        const contract = contractFromAward(p, {
          contractId: this.ids.next('ct'),
          number: await nextNumber(tx, event.tenantId, 'contract', 'CT'),
          lineId: () => this.ids.next('sov'),
          tenantId: event.tenantId,
        });
        assertContractInvariants(contract);
        await tx.contracts.insert(contract);
        tx.audit({ tenantId: event.tenantId, entityType: 'contract', entityId: contract.id, action: 'created', actorId: 'system', actorName: 'System', details: { from: p.rfxNumber, valueMinor: contract.originalValueMinor } });
        tx.emit({ type: 'contract.created', tenantId: event.tenantId, aggregateId: contract.id, payload: { rfxId: p.rfxId, number: contract.number } });
      });
    } catch (err) {
      if (err instanceof ConflictError && /Duplicate contracts/.test(err.message)) return; // lost a redelivery race
      throw err;
    }
  }

  async list(actor: Actor): Promise<Contract[]> {
    authorize(actor, 'contracts:read');
    const all = await this.uow.read.contracts.find(actor.tenantId, {}, { sort: { field: 'createdAt', dir: -1 } });
    return isSupplier(actor) ? all.filter((c) => c.supplierId === actor.supplierId) : all;
  }

  async get(actor: Actor, id: string): Promise<Contract> {
    authorize(actor, 'contracts:read');
    return this.loadContract(this.uow.read, actor, id);
  }

  async byRfx(actor: Actor, rfxId: string): Promise<Contract | null> {
    authorize(actor, 'contracts:read');
    const [c] = await this.uow.read.contracts.find(actor.tenantId, { rfxId });
    if (!c || (isSupplier(actor) && c.supplierId !== actor.supplierId)) return null;
    return c;
  }

  async listChangeOrders(actor: Actor, contractId: string): Promise<ChangeOrder[]> {
    authorize(actor, 'contracts:read');
    await this.loadContract(this.uow.read, actor, contractId);
    return this.uow.read.changeOrders.find(actor.tenantId, { contractId }, { sort: { field: 'number', dir: 1 } });
  }

  async getChangeOrder(actor: Actor, id: string): Promise<ChangeOrder> {
    authorize(actor, 'contracts:read');
    return (await this.loadCo(this.uow.read, actor, id)).co;
  }

  async createChangeOrder(actor: Actor, contractId: string, draft: ChangeOrderDraft): Promise<ChangeOrder> {
    authorize(actor, 'change_orders:write');
    return this.commit(async (tx) => {
      const contract = await this.loadContract(tx, actor, contractId);
      if (contract.status !== 'ACTIVE') throw new InvalidStateError(`${contract.number} is ${contract.status}`);
      validateDraft(draft, contract);
      const now = this.clock.now().toISOString();
      const co: ChangeOrder = {
        id: this.ids.next('co'),
        tenantId: actor.tenantId,
        version: 1,
        number: await nextNumber(tx, actor.tenantId, `co-${contractId}`, 'CO', 3),
        contractId,
        title: draft.title,
        reason: draft.reason,
        description: draft.description,
        lines: draft.lines.map((l) => ({ ...l, id: this.ids.next('col') })),
        markupBps: draft.markupBps,
        scheduleImpactDays: draft.scheduleImpactDays,
        totals: computeTotals(draft.lines, draft.markupBps),
        status: 'DRAFT',
        revision: 1,
        history: [],
        steps: [],
        requestedBy: actor.userId,
        requestedByName: actor.name,
        createdAt: now,
      };
      await tx.changeOrders.insert(co);
      tx.audit(this.auditFor(actor, co, 'created', { totalMinor: co.totals.totalMinor }));
      return co;
    });
  }

  /** Edit a draft, or rework a rejected CO (which starts a new revision). `expectedVersion` = If-Match. */
  async updateChangeOrder(actor: Actor, id: string, draft: ChangeOrderDraft, expectedVersion?: number): Promise<ChangeOrder> {
    authorize(actor, 'change_orders:write');
    return this.commit(async (tx) => {
      const { co, contract } = await this.loadCo(tx, actor, id);
      if (expectedVersion !== undefined && expectedVersion !== co.version) {
        throw new PreconditionFailedError(`${co.number} changed since you loaded it (version ${co.version}, you had ${expectedVersion})`);
      }
      if (co.requestedBy !== actor.userId) throw new ForbiddenError('Only the requester can edit a change order');
      assertEditable(co);
      validateDraft(draft, contract);
      const now = this.clock.now().toISOString();
      const rework = co.status === 'REJECTED';
      const next: ChangeOrder = {
        ...co,
        version: co.version + 1,
        title: draft.title,
        reason: draft.reason,
        description: draft.description,
        lines: draft.lines.map((l) => ({ ...l, id: this.ids.next('col') })),
        markupBps: draft.markupBps,
        scheduleImpactDays: draft.scheduleImpactDays,
        totals: computeTotals(draft.lines, draft.markupBps),
        status: 'DRAFT',
        revision: rework ? co.revision + 1 : co.revision,
        history: rework ? [...co.history, this.snapshot(co, actor, now, 'Reworked after rejection')] : co.history,
        steps: rework ? [] : co.steps,
      };
      await tx.changeOrders.update(next);
      tx.audit(this.auditFor(actor, next, rework ? 'revised' : 'edited', { revision: next.revision, totalMinor: next.totals.totalMinor }));
      return next;
    });
  }

  async submit(actor: Actor, id: string): Promise<ChangeOrder> {
    authorize(actor, 'change_orders:write');
    return this.commit(async (tx) => {
      const { co, contract } = await this.loadCo(tx, actor, id);
      if (co.requestedBy !== actor.userId) throw new ForbiddenError('Only the requester can submit a change order');
      if (co.status !== 'DRAFT') throw new InvalidStateError(`${co.number} is ${co.status}`);
      validateDraft(co, contract);
      const now = this.clock.now().toISOString();
      const steps = this.policy.steps({
        totalMinor: co.totals.totalMinor,
        scheduleImpactDays: co.scheduleImpactDays,
        contractOriginalMinor: contract.originalValueMinor,
        approvedChangesMinor: contract.approvedChangesMinor,
      });
      const next: ChangeOrder = { ...co, version: co.version + 1, status: 'PENDING_APPROVAL', steps, approvalPolicy: this.policy.name, submittedAt: now };
      await tx.changeOrders.update(next);
      tx.audit(this.auditFor(actor, next, 'submitted', { steps: steps.map((s) => s.role), totalMinor: co.totals.totalMinor }));
      tx.emit({ type: 'change_order.submitted', tenantId: actor.tenantId, aggregateId: co.id, payload: { number: co.number, contractId: co.contractId } });
      return next;
    });
  }

  /**
   * Approve or reject the current step. Segregation of duties: the requester can't approve, and one
   * person can't approve two steps. The final approval updates the contract in the SAME transaction.
   */
  async decide(actor: Actor, id: string, input: { decision: 'APPROVE' | 'REJECT'; comment?: string }): Promise<ChangeOrder> {
    authorize(actor, 'change_orders:decide');
    return this.commit(async (tx) => {
      const { co, contract } = await this.loadCo(tx, actor, id);
      if (co.status !== 'PENDING_APPROVAL') throw new InvalidStateError(`${co.number} is ${co.status}`);
      const step = currentStep(co)!;
      if (!actor.roles.includes(step.role)) throw new ForbiddenError(`Waiting for ${step.label}`);
      if (co.requestedBy === actor.userId) throw new ForbiddenError('You requested this change order; someone else must approve it');
      if (co.steps.some((s) => s.decidedBy === actor.userId)) throw new ForbiddenError('You already approved an earlier step');
      const comment = input.comment?.trim();
      if (input.decision === 'REJECT' && !comment) throw new ValidationError('A rejection needs a comment');
      const now = this.clock.now().toISOString();
      const idx = co.steps.indexOf(step);
      const decided = { ...step, status: input.decision === 'APPROVE' ? ('APPROVED' as const) : ('REJECTED' as const), decidedBy: actor.userId, decidedByName: actor.name, decidedAt: now, ...(comment ? { comment } : {}) };
      const steps = co.steps.map((s, i) => (i === idx ? decided : i === idx + 1 && input.decision === 'APPROVE' ? { ...s, status: 'PENDING' as const } : s));
      const final = input.decision === 'APPROVE' && idx === co.steps.length - 1;
      const status = input.decision === 'REJECT' ? 'REJECTED' : final ? 'APPROVED' : 'PENDING_APPROVAL';
      const next: ChangeOrder = { ...co, version: co.version + 1, steps, status, ...(status !== 'PENDING_APPROVAL' ? { decidedAt: now } : {}) };
      await tx.changeOrders.update(next);
      tx.audit(this.auditFor(actor, next, input.decision === 'APPROVE' ? `approved.${step.role}` : `rejected.${step.role}`, comment ? { comment } : undefined));

      if (status === 'APPROVED') {
        const revised = this.applyToContract(contract, next, actor, now);
        await tx.contracts.update(revised);
        tx.audit({ tenantId: actor.tenantId, entityType: 'contract', entityId: contract.id, action: 'revised', actorId: actor.userId, actorName: actor.name, details: { changeOrder: co.number, revision: revised.revision, deltaMinor: co.totals.totalMinor, revisedValueMinor: revised.revisedValueMinor } });
        tx.emit({ type: 'change_order.approved', tenantId: actor.tenantId, aggregateId: co.id, payload: { number: co.number, contractId: contract.id, totalMinor: co.totals.totalMinor } });
      } else if (status === 'REJECTED') {
        tx.emit({ type: 'change_order.rejected', tenantId: actor.tenantId, aggregateId: co.id, payload: { number: co.number, contractId: contract.id } });
      }
      return next;
    });
  }

  async withdraw(actor: Actor, id: string): Promise<ChangeOrder> {
    authorize(actor, 'change_orders:write');
    return this.commit(async (tx) => {
      const { co } = await this.loadCo(tx, actor, id);
      if (co.requestedBy !== actor.userId) throw new ForbiddenError('Only the requester can withdraw a change order');
      if (co.status === 'APPROVED' || co.status === 'WITHDRAWN') throw new InvalidStateError(`${co.number} is ${co.status}`);
      const next: ChangeOrder = { ...co, version: co.version + 1, status: 'WITHDRAWN', decidedAt: this.clock.now().toISOString() };
      await tx.changeOrders.update(next);
      tx.audit(this.auditFor(actor, next, 'withdrawn'));
      return next;
    });
  }

  async auditTrail(actor: Actor, entityId: string): Promise<AuditEntry[]> {
    authorize(actor, 'audit:read');
    return this.uow.read.auditLog.find(actor.tenantId, { entityId }, { sort: { field: 'at', dir: 1 } });
  }

  async recentActivity(actor: Actor, limit = 40): Promise<AuditEntry[]> {
    authorize(actor, 'audit:read');
    return this.uow.read.auditLog.find(actor.tenantId, {}, { sort: { field: 'at', dir: -1 }, limit });
  }

  /** Pure: produce the next contract version with the CO applied to the schedule of values. */
  private applyToContract(contract: Contract, co: ChangeOrder, actor: Actor, now: string): Contract {
    validateDraft(co, contract); // the contract may have moved since the CO was drafted
    const sov: SovLine[] = contract.sov.map((s) => ({ ...s }));
    let n = 0;
    for (const line of co.lines) {
      const amount = lineAmount(line);
      const target = line.sovLineId ? sov.find((s) => s.id === line.sovLineId) : undefined;
      if (target) target.changeOrderValueMinor += amount;
      else {
        n += 1;
        sov.push({ id: this.ids.next('sov'), code: `${co.number}.${n}`, description: line.description, originalValueMinor: 0, changeOrderValueMinor: amount, source: 'CHANGE_ORDER', changeOrderNumber: co.number });
      }
    }
    if (co.totals.markupMinor !== 0) {
      sov.push({ id: this.ids.next('sov'), code: `${co.number}.OHP`, description: `Overhead & profit on ${co.number} (${co.markupBps / 100}%)`, originalValueMinor: 0, changeOrderValueMinor: co.totals.markupMinor, source: 'CHANGE_ORDER', changeOrderNumber: co.number });
    }
    const approvedChangesMinor = contract.approvedChangesMinor + co.totals.totalMinor;
    const scheduleDaysAdded = contract.scheduleDaysAdded + co.scheduleImpactDays;
    const revisedCompletionDate = addDays(`${contract.originalCompletionDate}T00:00:00.000Z`, scheduleDaysAdded).slice(0, 10);
    const revision = contract.revision + 1;
    const next: Contract = {
      ...contract,
      version: contract.version + 1,
      sov,
      approvedChangesMinor,
      revisedValueMinor: contract.originalValueMinor + approvedChangesMinor,
      scheduleDaysAdded,
      revisedCompletionDate,
      revision,
      revisions: [
        ...contract.revisions,
        { revision, reason: `${co.number}: ${co.title}`, changeOrderId: co.id, changeOrderNumber: co.number, valueMinor: contract.originalValueMinor + approvedChangesMinor, completionDate: revisedCompletionDate, at: now, by: actor.name },
      ],
    };
    assertContractInvariants(next);
    return next;
  }

  private snapshot(co: ChangeOrder, actor: Actor, at: string, note: string) {
    return { revision: co.revision, totals: co.totals, scheduleImpactDays: co.scheduleImpactDays, status: co.status, at, by: actor.name, note };
  }

  private auditFor(actor: Actor, co: ChangeOrder, action: string, details?: Record<string, unknown>) {
    return { tenantId: actor.tenantId, entityType: 'change_order' as const, entityId: co.id, action, actorId: actor.userId, actorName: actor.name, details: { number: co.number, ...details } };
  }
}
