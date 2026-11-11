import { useState } from 'react';
import type { Rfx } from '@core/sourcing/rfx';
import type { BidInput } from '@core/sourcing/bid';
import { lineTotal, sum } from '@core/shared/money';
import { money, parseMajor } from '../format';

/** Supplier portal: price each line (leave blank for "no bid"), see the running total, submit sealed. */
export function SupplierBidForm({ rfx, onSubmit }: { rfx: Rfx; onSubmit: (input: BidInput) => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [lead, setLead] = useState('90');
  const [validity, setValidity] = useState('60');
  const [exclusions, setExclusions] = useState('');
  const quoted = rfx.lines.map((l) => ({ line: l, minor: parseMajor(prices[l.id] ?? '') }));
  const total = sum(quoted.filter((q) => q.minor !== null).map((q) => lineTotal(q.minor!, q.line.quantity)));
  const filled = quoted.filter((q) => q.minor !== null);

  return (
    <form
      className="card form"
      aria-label="Submit bid"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          lines: filled.map((q) => ({ lineId: q.line.id, unitPriceMinor: q.minor! })),
          leadTimeDays: Number(lead),
          validityDays: Number(validity),
          ...(exclusions.trim() ? { exclusions: exclusions.trim() } : {}),
        });
      }}
    >
      <h3>Your sealed bid</h3>
      <p className="sub">The buyer can't see prices until bidding closes. You can revise until the deadline; each revision gets a new seal.</p>
      <table className="grid dense">
        <thead>
          <tr>
            <th>Line</th>
            <th className="num">Qty</th>
            <th className="num">Unit price ({rfx.currency})</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quoted.map(({ line, minor }) => (
            <tr key={line.id}>
              <td><span className="code">{line.code}</span> {line.description}</td>
              <td className="num muted">{line.quantity} {line.unit}</td>
              <td className="num">
                <input aria-label={`Price ${line.code}`} className="num" placeholder="no bid" value={prices[line.id] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [line.id]: e.target.value }))} />
              </td>
              <td className="num">{minor !== null ? money(lineTotal(minor, line.quantity), rfx.currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="strong">
            <th colSpan={3}>Total ({filled.length}/{rfx.lines.length} lines)</th>
            <td className="num">{money(total, rfx.currency)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="form-row compact">
        <label>Lead time (days)<input className="num" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
        <label>Validity (days)<input className="num" value={validity} onChange={(e) => setValidity(e.target.value)} /></label>
        <label className="grow">Exclusions<input value={exclusions} onChange={(e) => setExclusions(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={filled.length === 0}>Submit sealed bid</button>
      </div>
    </form>
  );
}
