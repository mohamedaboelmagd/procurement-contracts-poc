import type { Role } from '../shared/actor.js';
import { applyBps, type Minor } from '../shared/money.js';

export interface ApprovalStep {
  role: Role;
  label: string;
  status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED';
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  comment?: string;
}

export interface ApprovalContext {
  totalMinor: Minor;
  scheduleImpactDays: number;
  contractOriginalMinor: Minor;
  /** Approved changes so far, to catch "death by a thousand small change orders". */
  approvedChangesMinor: Minor;
}

/** Strategy: which roles must approve a change order, in order. Swap per tenant or contract type. */
export interface ApprovalPolicy {
  readonly name: string;
  steps(ctx: ApprovalContext): ApprovalStep[];
}

/**
 * Default delegation of authority:
 * 1. Project manager always reviews scope and quantities.
 * 2. Commercial manager approves anything with a cost.
 * 3. Director approves if this CO is ≥ 5% of the original value, if cumulative changes would pass 10%,
 *    or if the schedule moves by more than 14 days.
 */
export class DelegationOfAuthorityPolicy implements ApprovalPolicy {
  readonly name = 'delegation-of-authority';
  constructor(
    private singleCoBps = 500,
    private cumulativeBps = 1_000,
    private scheduleDays = 14,
  ) {}

  steps(ctx: ApprovalContext): ApprovalStep[] {
    const steps: ApprovalStep[] = [{ role: 'project_manager', label: 'Project manager review', status: 'PENDING' }];
    if (ctx.totalMinor !== 0) steps.push({ role: 'commercial_manager', label: 'Commercial approval', status: 'WAITING' });
    const abs = Math.abs(ctx.totalMinor);
    const needsDirector =
      abs >= applyBps(ctx.contractOriginalMinor, this.singleCoBps) ||
      Math.abs(ctx.approvedChangesMinor + ctx.totalMinor) > applyBps(ctx.contractOriginalMinor, this.cumulativeBps) ||
      Math.abs(ctx.scheduleImpactDays) > this.scheduleDays;
    if (needsDirector) steps.push({ role: 'director', label: 'Director sign-off', status: 'WAITING' });
    return steps;
  }
}
