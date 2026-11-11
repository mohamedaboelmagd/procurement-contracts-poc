import { InvalidStateError, ValidationError } from '../shared/errors.js';
import { applyBps, lineTotal, sum, type Minor } from '../shared/money.js';
import type { Entity } from '../shared/persistence.js';
import type { ApprovalStep } from './approval-policy.js';
import type { Contract } from './contract.js';

export type ChangeOrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export type ChangeReason = 'OWNER_REQUEST' | 'DESIGN_CHANGE' | 'UNFORESEEN_CONDITION' | 'VALUE_ENGINEERING' | 'REGULATORY';
export type CostType = 'LABOR' | 'MATERIAL' | 'EQUIPMENT' | 'SUBCONTRACT';

export interface ChangeOrderLine {
  id: string;
  /** ADD increases the contract; OMIT is a credit (deducted scope). */
  kind: 'ADD' | 'OMIT';
  /** Adjust an existing SOV line, or null to add a new one. */
  sovLineId: string | null;
  description: string;
  costType: CostType;
  quantity: number;
  unit: string;
  unitPriceMinor: Minor;
}

export interface ChangeOrderTotals {
  addsMinor: Minor;
  omitsMinor: Minor;
  costMinor: Minor;
  markupMinor: Minor;
  totalMinor: Minor;
}

export interface ChangeOrderDraft {
  title: string;
  reason: ChangeReason;
  description: string;
  lines: Omit<ChangeOrderLine, 'id'>[];
  markupBps: number;
  scheduleImpactDays: number;
}

export interface ChangeOrderRevision {
  revision: number;
  totals: ChangeOrderTotals;
  scheduleImpactDays: number;
  status: ChangeOrderStatus;
  at: string;
  by: string;
  note: string;
}

export interface ChangeOrder extends Entity {
  number: string;
  contractId: string;
  title: string;
  reason: ChangeReason;
  description: string;
  lines: ChangeOrderLine[];
  markupBps: number;
  scheduleImpactDays: number;
  totals: ChangeOrderTotals;
  status: ChangeOrderStatus;
  /** Bumped every time a rejected CO is reworked; earlier versions stay in `history`. */
  revision: number;
  history: ChangeOrderRevision[];
  approvalPolicy?: string;
  steps: ApprovalStep[];
  requestedBy: string;
  requestedByName: string;
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
}

export const MAX_MARKUP_BPS = 2_500;

/** Signed line amount: OMIT lines are credits. Shared by the API and the React form (live totals). */
export function lineAmount(line: Pick<ChangeOrderLine, 'kind' | 'quantity' | 'unitPriceMinor'>): Minor {
  const amount = lineTotal(line.unitPriceMinor, line.quantity);
  return line.kind === 'OMIT' ? -amount : amount;
}

export function computeTotals(lines: Pick<ChangeOrderLine, 'kind' | 'quantity' | 'unitPriceMinor'>[], markupBps: number): ChangeOrderTotals {
  const amounts = lines.map(lineAmount);
  const addsMinor = sum(amounts.filter((a) => a > 0));
  const omitsMinor = sum(amounts.filter((a) => a < 0));
  const costMinor = addsMinor + omitsMinor;
  // Markup (overhead & profit) applies to added work only; credits come back at cost.
  const markupMinor = applyBps(addsMinor, markupBps);
  return { addsMinor, omitsMinor, costMinor, markupMinor, totalMinor: costMinor + markupMinor };
}

export function validateDraft(draft: ChangeOrderDraft, contract: Contract): void {
  if (draft.lines.length === 0) throw new ValidationError('Add at least one line');
  if (draft.markupBps < 0 || draft.markupBps > MAX_MARKUP_BPS) throw new ValidationError(`Markup must be between 0% and ${MAX_MARKUP_BPS / 100}%`);
  const sovById = new Map(contract.sov.map((s) => [s.id, s]));
  const omitBySov = new Map<string, Minor>();
  draft.lines.forEach((l, i) => {
    if (l.quantity <= 0) throw new ValidationError(`Line ${i + 1}: quantity must be positive`);
    if (l.unitPriceMinor < 0) throw new ValidationError(`Line ${i + 1}: unit price cannot be negative`);
    if (l.sovLineId && !sovById.has(l.sovLineId)) throw new ValidationError(`Line ${i + 1}: unknown schedule-of-values line`);
    if (l.kind === 'OMIT') {
      if (!l.sovLineId) throw new ValidationError(`Line ${i + 1}: an omission must reference the schedule-of-values line it reduces`);
      omitBySov.set(l.sovLineId, (omitBySov.get(l.sovLineId) ?? 0) + lineTotal(l.unitPriceMinor, l.quantity));
    }
  });
  for (const [sovId, omitted] of omitBySov) {
    const s = sovById.get(sovId)!;
    if (omitted > s.originalValueMinor + s.changeOrderValueMinor) {
      throw new ValidationError(`Omissions on ${s.code} exceed its current value`);
    }
  }
}

export function assertEditable(co: ChangeOrder): void {
  if (co.status !== 'DRAFT' && co.status !== 'REJECTED') throw new InvalidStateError(`${co.number} is ${co.status} and can't be edited`);
}

export function currentStep(co: ChangeOrder): ApprovalStep | undefined {
  return co.steps.find((s) => s.status === 'PENDING');
}
