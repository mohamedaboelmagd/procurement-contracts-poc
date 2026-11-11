/**
 * Money is always an integer number of minor units (cents, piasters, halalas).
 * Quantities may have up to 3 decimals (e.g. 12.5 m³) and are handled as integer thousandths,
 * so `unit price × quantity` never touches floating-point cents.
 */
import { ValidationError } from './errors.js';

export type Minor = number;
export type Currency = 'USD' | 'EGP' | 'SAR' | 'AED';
export const CURRENCIES: readonly Currency[] = ['USD', 'EGP', 'SAR', 'AED'];

export function assertMinor(value: number, field = 'amount'): Minor {
  if (!Number.isSafeInteger(value)) throw new ValidationError(`${field} must be an integer number of minor units`);
  return value;
}

/** Major units → minor units (2 decimals for every supported currency). Only for fixtures and UI input. */
export function toMinor(major: number): Minor {
  return Math.round(major * 100);
}

export function toQtyMilli(quantity: number, field = 'quantity'): number {
  const milli = Math.round(quantity * 1000);
  if (!Number.isFinite(quantity) || Math.abs(quantity * 1000 - milli) > 1e-6) {
    throw new ValidationError(`${field} supports at most 3 decimals`);
  }
  return milli;
}

/** Integer division rounding half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  const q = Math.trunc(numerator / denominator);
  const r = numerator - q * denominator;
  if (Math.abs(r) * 2 >= Math.abs(denominator)) return q + (Math.sign(numerator) * Math.sign(denominator));
  return q;
}

/** Extended amount for a line: unit price × quantity, rounded once to the minor unit. */
export function lineTotal(unitPriceMinor: Minor, quantity: number): Minor {
  assertMinor(unitPriceMinor, 'unitPriceMinor');
  // BigInt keeps price × thousandths exact even for large contracts.
  const product = BigInt(unitPriceMinor) * BigInt(toQtyMilli(quantity));
  let q = product / 1000n;
  const r = product % 1000n;
  if ((r < 0n ? -r : r) * 2n >= 1000n) q += product < 0n ? -1n : 1n;
  return assertMinor(Number(q), 'line total');
}

/** amount × basis points (1 bp = 0.01%), rounded half away from zero. */
export function applyBps(amount: Minor, bps: number): Minor {
  assertMinor(amount);
  if (!Number.isInteger(bps)) throw new ValidationError('basis points must be an integer');
  return divRound(amount * bps, 10_000);
}

/** (a - b) / b in basis points. Returns 0 when b is 0. */
export function deltaBps(a: Minor, b: Minor): number {
  if (b === 0) return 0;
  return divRound((a - b) * 10_000, b);
}

export function sum(values: Iterable<Minor>): Minor {
  let total = 0;
  for (const v of values) total += v;
  return assertMinor(total, 'sum');
}

/**
 * Split `total` across `weights` so the parts always add up to exactly `total`
 * (largest-remainder method). Used when a lump sum must be spread over lines.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  assertMinor(total);
  if (weights.length === 0) return [];
  const w = weights.map((x) => Math.abs(x));
  const wSum = w.reduce((a, b) => a + b, 0);
  if (wSum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const sign = Math.sign(total) || 1;
  const abs = Math.abs(total);
  const raw = w.map((x) => (abs * x) / wSum);
  const parts = raw.map(Math.floor);
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    parts[i]! += 1;
    rest -= 1;
  }
  return parts.map((p) => p * sign);
}

export function formatMoney(minor: Minor, currency: Currency): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${neg ? '−' : ''}${currency} ${major}.${cents}`;
}

export function formatBps(bps: number): string {
  const sign = bps > 0 ? '+' : bps < 0 ? '−' : '';
  return `${sign}${(Math.abs(bps) / 100).toFixed(1)}%`;
}
