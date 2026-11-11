import { formatBps, formatMoney, type Currency } from '@core/shared/money';

export const money = (minor: number, currency: Currency | string) => formatMoney(minor, currency as Currency);
export const pct = formatBps;

/** "1,234.5" → 123450 minor units. Returns null for anything that isn't a plain amount. */
export function parseMajor(input: string): number | null {
  const clean = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export const majorString = (minor: number) => (minor / 100).toFixed(2);

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

export const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
