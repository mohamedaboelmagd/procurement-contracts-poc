/**
 * Bid levelling: put every bid on the same basis so they can be compared line by line.
 *
 * - Each cell is unit price × quantity (integer minor units).
 * - A line a supplier did not quote is "plugged" with the HIGHEST unit price any other supplier
 *   quoted for it. That is the conservative industry convention: a gap never makes a bid look cheaper.
 * - Ranking uses the normalised (plugged) total, not the raw total.
 * - Unit prices more than 35% away from the line median are flagged as outliers (likely a typo or a
 *   scope misunderstanding worth a clarification before award).
 */
import { deltaBps, lineTotal, sum, type Currency, type Minor } from '../shared/money.js';
import type { Bid } from './bid.js';
import type { Rfx } from './rfx.js';

export const OUTLIER_BPS = 3_500;

export interface LevellingCell {
  unitPriceMinor: Minor;
  extendedMinor: Minor;
  /** Cheapest quoted price on this line. */
  isLowest: boolean;
  /** Extended amount vs the cheapest quote on this line. */
  deltaVsLowestBps: number;
  outlier: boolean;
  /** True when the supplier didn't quote and the plug price was used. */
  plugged: boolean;
}

export interface LevellingLine {
  lineId: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  lowestExtendedMinor: Minor | null;
  medianUnitMinor: Minor | null;
  /** Highest vs lowest quoted extended amount. */
  spreadBps: number;
  cells: Record<string, LevellingCell | null>;
}

export interface LevellingSupplier {
  supplierId: string;
  supplierName: string;
  bidId: string;
  quotedTotalMinor: Minor;
  normalisedTotalMinor: Minor;
  missingLineIds: string[];
  outlierCount: number;
  leadTimeDays: number;
  rank: number;
  deltaVsLowestBps: number;
}

export interface LevellingMatrix {
  rfxId: string;
  currency: Currency;
  suppliers: LevellingSupplier[];
  lines: LevellingLine[];
  recommendedSupplierId: string | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function levelBids(rfx: Rfx, bids: Bid[]): LevellingMatrix {
  const priceOf = (bid: Bid, lineId: string) => bid.lines.find((l) => l.lineId === lineId)?.unitPriceMinor;
  const normalised = new Map<string, Minor[]>(bids.map((b) => [b.id, []]));
  const missing = new Map<string, string[]>(bids.map((b) => [b.id, []]));
  const outliers = new Map<string, number>(bids.map((b) => [b.id, 0]));

  const lines: LevellingLine[] = rfx.lines.map((line) => {
    const quoted = bids.map((b) => priceOf(b, line.id)).filter((p): p is number => p !== undefined);
    const med = median(quoted);
    const plug = quoted.length ? Math.max(...quoted) : null;
    const extendedQuoted = quoted.map((p) => lineTotal(p, line.quantity));
    const lowest = extendedQuoted.length ? Math.min(...extendedQuoted) : null;
    const highest = extendedQuoted.length ? Math.max(...extendedQuoted) : null;
    const cells: Record<string, LevellingCell | null> = {};
    for (const bid of bids) {
      const p = priceOf(bid, line.id);
      const unit = p ?? plug;
      if (unit === null || unit === undefined) {
        cells[bid.supplierId] = null;
        missing.get(bid.id)!.push(line.id);
        continue;
      }
      const extended = lineTotal(unit, line.quantity);
      const isOutlier = p !== undefined && med !== null && quoted.length >= 3 && Math.abs(deltaBps(p, med)) > OUTLIER_BPS;
      if (p === undefined) missing.get(bid.id)!.push(line.id);
      if (isOutlier) outliers.set(bid.id, outliers.get(bid.id)! + 1);
      normalised.get(bid.id)!.push(extended);
      cells[bid.supplierId] = {
        unitPriceMinor: unit,
        extendedMinor: extended,
        isLowest: p !== undefined && extended === lowest,
        deltaVsLowestBps: lowest === null ? 0 : deltaBps(extended, lowest),
        outlier: isOutlier,
        plugged: p === undefined,
      };
    }
    return {
      lineId: line.id,
      code: line.code,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      lowestExtendedMinor: lowest,
      medianUnitMinor: med,
      spreadBps: lowest !== null && highest !== null ? deltaBps(highest, lowest) : 0,
      cells,
    };
  });

  const ranked = bids
    .map((b) => ({ bid: b, normalisedTotalMinor: sum(normalised.get(b.id)!) }))
    .sort((a, b) => a.normalisedTotalMinor - b.normalisedTotalMinor || a.bid.leadTimeDays - b.bid.leadTimeDays);
  const best = ranked[0]?.normalisedTotalMinor ?? 0;

  const suppliers: LevellingSupplier[] = ranked.map((r, i) => ({
    supplierId: r.bid.supplierId,
    supplierName: r.bid.supplierName,
    bidId: r.bid.id,
    quotedTotalMinor: r.bid.totalMinor,
    normalisedTotalMinor: r.normalisedTotalMinor,
    missingLineIds: missing.get(r.bid.id)!,
    outlierCount: outliers.get(r.bid.id)!,
    leadTimeDays: r.bid.leadTimeDays,
    rank: i + 1,
    deltaVsLowestBps: deltaBps(r.normalisedTotalMinor, best),
  }));

  // Recommend the cheapest complete bid; fall back to the cheapest normalised bid.
  const complete = suppliers.find((s) => s.missingLineIds.length === 0);
  return {
    rfxId: rfx.id,
    currency: rfx.currency,
    suppliers,
    lines,
    recommendedSupplierId: (complete ?? suppliers[0])?.supplierId ?? null,
  };
}
