import { ValidationError } from '../shared/errors.js';
import { canonicalJson, sha256Hex } from '../shared/hash.js';
import { lineTotal, sum, type Minor } from '../shared/money.js';
import type { Entity } from '../shared/persistence.js';
import type { Rfx } from './rfx.js';

export interface BidLine {
  lineId: string;
  unitPriceMinor: Minor;
  note?: string;
}

/**
 * A supplier's sealed bid. Buyers can't read prices until the RFx closes; the seal hash is given to the
 * supplier as a receipt and re-verified at bid opening, so any change after submission is detectable.
 */
export interface Bid extends Entity {
  rfxId: string;
  supplierId: string;
  supplierName: string;
  lines: BidLine[];
  totalMinor: Minor;
  leadTimeDays: number;
  validityDays: number;
  exclusions?: string;
  revision: number;
  submittedAt: string;
  sealHash: string;
}

export interface BidInput {
  lines: BidLine[];
  leadTimeDays: number;
  validityDays: number;
  exclusions?: string;
}

/** Prices every line the supplier quoted; lines left out are "no bid" and handled in levelling. */
export function priceBid(rfx: Rfx, input: BidInput): Minor {
  const byId = new Map(rfx.lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!byId.has(l.lineId)) throw new ValidationError(`Unknown line ${l.lineId}`);
    if (seen.has(l.lineId)) throw new ValidationError(`Line ${l.lineId} quoted twice`);
    if (l.unitPriceMinor < 0) throw new ValidationError('Unit prices cannot be negative');
    seen.add(l.lineId);
  }
  if (input.lines.length === 0) throw new ValidationError('Quote at least one line');
  return sum(input.lines.map((l) => lineTotal(l.unitPriceMinor, byId.get(l.lineId)!.quantity)));
}

export function sealPayload(bid: Pick<Bid, 'rfxId' | 'supplierId' | 'lines' | 'leadTimeDays' | 'validityDays' | 'exclusions' | 'revision' | 'submittedAt'>) {
  return canonicalJson({
    rfxId: bid.rfxId,
    supplierId: bid.supplierId,
    lines: bid.lines,
    leadTimeDays: bid.leadTimeDays,
    validityDays: bid.validityDays,
    exclusions: bid.exclusions ?? null,
    revision: bid.revision,
    submittedAt: bid.submittedAt,
  });
}

export function computeSeal(bid: Parameters<typeof sealPayload>[0]): Promise<string> {
  return sha256Hex(sealPayload(bid));
}

export async function verifySeal(bid: Bid): Promise<boolean> {
  return (await computeSeal(bid)) === bid.sealHash;
}
