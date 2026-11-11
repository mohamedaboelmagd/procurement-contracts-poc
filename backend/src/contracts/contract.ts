import { InvariantError } from './invariant.js';
import { applyBps, lineTotal, sum, type Currency, type Minor } from '../shared/money.js';
import type { RfxAwardedPayload } from '../shared/events.js';
import type { Entity } from '../shared/persistence.js';
import { addDays } from '../shared/clock.js';

/** One line of the schedule of values (SOV): what the contract pays for, and how changes moved it. */
export interface SovLine {
  id: string;
  code: string;
  description: string;
  originalValueMinor: Minor;
  /** Sum of approved change orders against this line. */
  changeOrderValueMinor: Minor;
  source: 'BID' | 'CHANGE_ORDER';
  changeOrderNumber?: string;
}

/** Immutable snapshot appended on every value or date change: contract versioning. */
export interface ContractRevision {
  revision: number;
  reason: string;
  changeOrderId?: string;
  changeOrderNumber?: string;
  valueMinor: Minor;
  completionDate: string;
  at: string;
  by: string;
}

export interface Contract extends Entity {
  number: string;
  title: string;
  projectName: string;
  rfxId: string;
  rfxNumber: string;
  bidId: string;
  supplierId: string;
  supplierName: string;
  currency: Currency;
  status: 'ACTIVE' | 'CLOSED';
  sov: SovLine[];
  originalValueMinor: Minor;
  approvedChangesMinor: Minor;
  revisedValueMinor: Minor;
  retentionBps: number;
  startDate: string;
  originalCompletionDate: string;
  revisedCompletionDate: string;
  scheduleDaysAdded: number;
  revision: number;
  revisions: ContractRevision[];
  createdAt: string;
}

export const DEFAULT_RETENTION_BPS = 1_000; // 10% retention, released at completion

export function contractFromAward(p: RfxAwardedPayload, ids: { contractId: string; number: string; lineId: (i: number) => string; tenantId: string }): Contract {
  const sov: SovLine[] = p.lines.map((l, i) => ({
    id: ids.lineId(i),
    code: l.code,
    description: `${l.description} (${l.quantity} ${l.unit})`,
    originalValueMinor: lineTotal(l.unitPriceMinor, l.quantity),
    changeOrderValueMinor: 0,
    source: 'BID',
  }));
  const original = sum(sov.map((s) => s.originalValueMinor));
  const completion = addDays(p.awardedAt, Math.max(p.leadTimeDays, 1)).slice(0, 10);
  return {
    id: ids.contractId,
    tenantId: ids.tenantId,
    version: 1,
    number: ids.number,
    title: p.title,
    projectName: p.projectName,
    rfxId: p.rfxId,
    rfxNumber: p.rfxNumber,
    bidId: p.bidId,
    supplierId: p.supplierId,
    supplierName: p.supplierName,
    currency: p.currency as Currency,
    status: 'ACTIVE',
    sov,
    originalValueMinor: original,
    approvedChangesMinor: 0,
    revisedValueMinor: original,
    retentionBps: DEFAULT_RETENTION_BPS,
    startDate: p.awardedAt.slice(0, 10),
    originalCompletionDate: completion,
    revisedCompletionDate: completion,
    scheduleDaysAdded: 0,
    revision: 1,
    revisions: [{ revision: 1, reason: `Awarded from ${p.rfxNumber}`, valueMinor: original, completionDate: completion, at: p.awardedAt, by: 'system' }],
    createdAt: p.awardedAt,
  };
}

export function retentionMinor(c: Contract): Minor {
  return applyBps(c.revisedValueMinor, c.retentionBps);
}

/** The SOV must always add up to the revised contract value. Checked after every change. */
export function assertContractInvariants(c: Contract): void {
  const original = sum(c.sov.map((s) => s.originalValueMinor));
  const changes = sum(c.sov.map((s) => s.changeOrderValueMinor));
  if (original !== c.originalValueMinor) throw new InvariantError(`SOV original ${original} ≠ contract original ${c.originalValueMinor}`);
  if (changes !== c.approvedChangesMinor) throw new InvariantError(`SOV changes ${changes} ≠ approved changes ${c.approvedChangesMinor}`);
  if (c.originalValueMinor + c.approvedChangesMinor !== c.revisedValueMinor) throw new InvariantError('Revised value ≠ original + approved changes');
  if (c.sov.some((s) => s.originalValueMinor + s.changeOrderValueMinor < 0)) throw new InvariantError('A schedule-of-values line went negative');
}
