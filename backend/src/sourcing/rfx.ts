import { InvalidStateError, ValidationError } from '../shared/errors.js';
import type { Currency, Minor } from '../shared/money.js';
import type { Entity } from '../shared/persistence.js';

export type RfxType = 'RFI' | 'RFQ' | 'RFP';
export type RfxStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'AWARDED' | 'CANCELLED';

export interface RfxLine {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
}

export interface Invitation {
  supplierId: string;
  supplierName: string;
  status: 'INVITED' | 'SUBMITTED' | 'DECLINED';
  invitedAt: string;
  respondedAt?: string;
}

export interface Award {
  supplierId: string;
  supplierName: string;
  bidId: string;
  totalMinor: Minor;
  awardedAt: string;
  awardedBy: string;
  justification?: string;
  lowestBid: boolean;
}

/** A sourcing event (RFI / RFQ / RFP). Aggregate root of the sourcing module. */
export interface Rfx extends Entity {
  number: string;
  type: RfxType;
  title: string;
  projectName: string;
  currency: Currency;
  status: RfxStatus;
  lines: RfxLine[];
  invitations: Invitation[];
  bidDueAt: string;
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
  closedAt?: string;
  award?: Award;
}

/** Allowed transitions. Anything not in the table is rejected. */
const TRANSITIONS: Record<RfxStatus, readonly RfxStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['CLOSED', 'CANCELLED'],
  CLOSED: ['AWARDED', 'CANCELLED'],
  AWARDED: [],
  CANCELLED: [],
};

export function transition(rfx: Rfx, to: RfxStatus): Rfx {
  if (!TRANSITIONS[rfx.status].includes(to)) {
    throw new InvalidStateError(`${rfx.number} is ${rfx.status}; cannot move to ${to}`);
  }
  return { ...rfx, status: to, version: rfx.version + 1 };
}

export function assertPublishable(rfx: Rfx, now: Date): void {
  if (rfx.lines.length === 0) throw new ValidationError('Add at least one line item before publishing');
  if (rfx.invitations.length === 0) throw new ValidationError('Invite at least one supplier before publishing');
  if (new Date(rfx.bidDueAt) <= now) throw new ValidationError('Bid due date must be in the future');
  if (rfx.type === 'RFI' && rfx.lines.some((l) => l.quantity !== 1)) {
    throw new ValidationError('RFI line items are questions; use quantity 1');
  }
}

/** Bidding can close after the deadline, or early once every invited supplier has responded. */
export function assertClosable(rfx: Rfx, now: Date): void {
  const allResponded = rfx.invitations.every((i) => i.status !== 'INVITED');
  if (new Date(rfx.bidDueAt) > now && !allResponded) {
    const waiting = rfx.invitations.filter((i) => i.status === 'INVITED').length;
    throw new InvalidStateError(`Bidding is open until ${rfx.bidDueAt}; ${waiting} supplier(s) have not responded`);
  }
}

export function isBiddingOpen(rfx: Rfx, now: Date): boolean {
  return rfx.status === 'PUBLISHED' && new Date(rfx.bidDueAt) > now;
}
