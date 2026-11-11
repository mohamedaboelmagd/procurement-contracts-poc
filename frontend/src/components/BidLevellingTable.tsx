import { useState } from 'react';
import type { LevellingMatrix } from '@core/sourcing/levelling';
import { money, pct } from '../format';

interface Props {
  matrix: LevellingMatrix;
  awardable: boolean;
  awardedSupplierId?: string;
  onAward?: (supplierId: string, justification?: string) => void;
}

/** Line-by-line comparison of opened bids, normalised for missing lines, with award controls. */
export function BidLevellingTable({ matrix, awardable, awardedSupplierId, onAward }: Props) {
  const [selected, setSelected] = useState<string>(matrix.recommendedSupplierId ?? '');
  const [justification, setJustification] = useState('');
  const c = matrix.currency;
  const needsJustification = selected !== '' && selected !== matrix.recommendedSupplierId;
  const selectedName = matrix.suppliers.find((s) => s.supplierId === selected)?.supplierName;

  return (
    <div className="levelling">
      <div className="table-scroll">
        <table className="grid dense" aria-label="Bid levelling matrix">
          <thead>
            <tr>
              <th>Line</th>
              <th className="num">Qty</th>
              {matrix.suppliers.map((s) => (
                <th key={s.supplierId} className={`num supplier-col ${s.supplierId === matrix.recommendedSupplierId ? 'recommended' : ''}`}>
                  <div className="supplier-head">
                    <span className="rank">#{s.rank}</span> {s.supplierName}
                    {s.supplierId === matrix.recommendedSupplierId && <span className="badge ok">Recommended</span>}
                    {s.supplierId === awardedSupplierId && <span className="badge award">Awarded</span>}
                  </div>
                  {awardable && (
                    <label className="pick">
                      <input type="radio" name="award" value={s.supplierId} checked={selected === s.supplierId} onChange={() => setSelected(s.supplierId)} aria-label={`Select ${s.supplierName}`} /> select
                    </label>
                  )}
                </th>
              ))}
              <th className="num">Spread</th>
            </tr>
          </thead>
          <tbody>
            {matrix.lines.map((line) => (
              <tr key={line.lineId}>
                <td>
                  <span className="code">{line.code}</span> {line.description}
                </td>
                <td className="num muted">
                  {line.quantity.toLocaleString('en-US')} {line.unit}
                </td>
                {matrix.suppliers.map((s) => {
                  const cell = line.cells[s.supplierId];
                  if (!cell) return <td key={s.supplierId} className="num muted">—</td>;
                  const cls = ['num', 'cell', cell.isLowest ? 'lowest' : '', cell.outlier ? 'outlier' : '', cell.plugged ? 'plugged' : ''].join(' ');
                  return (
                    <td key={s.supplierId} className={cls} data-testid={`cell-${line.code}-${s.supplierId}`} title={cell.plugged ? 'No bid: plugged with the highest quote' : cell.outlier ? 'More than 35% from the line median' : ''}>
                      <div>{money(cell.extendedMinor, c)}</div>
                      <div className="sub">
                        {cell.plugged ? 'no bid · plug' : `@ ${money(cell.unitPriceMinor, c)}`}
                        {!cell.plugged && !cell.isLowest && <span className="delta"> {pct(cell.deltaVsLowestBps)}</span>}
                        {cell.outlier && <span className="warn"> ⚠ outlier</span>}
                      </div>
                    </td>
                  );
                })}
                <td className="num muted">{pct(line.spreadBps)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Quoted total</th>
              {matrix.suppliers.map((s) => (
                <td key={s.supplierId} className="num">{money(s.quotedTotalMinor, c)}</td>
              ))}
              <td />
            </tr>
            <tr className="strong">
              <th colSpan={2}>Normalised total</th>
              {matrix.suppliers.map((s) => (
                <td key={s.supplierId} className="num" data-testid={`normalised-${s.supplierId}`}>
                  {money(s.normalisedTotalMinor, c)}
                  <div className="sub">{s.rank === 1 ? 'lowest' : pct(s.deltaVsLowestBps)}</div>
                </td>
              ))}
              <td />
            </tr>
            <tr>
              <th colSpan={2}>Gaps / outliers / lead time</th>
              {matrix.suppliers.map((s) => (
                <td key={s.supplierId} className="num">
                  <span className={s.missingLineIds.length ? 'warn' : ''}>{s.missingLineIds.length} missing</span> · {s.outlierCount} outlier · {s.leadTimeDays} d
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {awardable && onAward && (
        <div className="award-bar">
          {needsJustification && (
            <textarea
              aria-label="Award justification"
              placeholder="Why not the recommended bid? (15+ characters, stored in the audit trail)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          )}
          <button className="primary" disabled={!selected} onClick={() => onAward(selected, needsJustification ? justification : undefined)}>
            Award to {selectedName ?? '…'}
          </button>
        </div>
      )}
    </div>
  );
}
