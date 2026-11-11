import { useMemo, useState } from 'react';
import { DelegationOfAuthorityPolicy } from '@core/contracts/approval-policy';
import { computeTotals, lineAmount, validateDraft, type ChangeOrderDraft, type ChangeReason, type CostType } from '@core/contracts/change-order';
import type { Contract } from '@core/contracts/contract';
import { addDays } from '@core/shared/clock';
import { majorString, money, parseMajor } from '../format';

interface LineRow {
  key: number;
  kind: 'ADD' | 'OMIT';
  sovLineId: string;
  description: string;
  costType: CostType;
  quantity: string;
  unit: string;
  unitPrice: string;
}

const REASONS: ChangeReason[] = ['OWNER_REQUEST', 'DESIGN_CHANGE', 'UNFORESEEN_CONDITION', 'VALUE_ENGINEERING', 'REGULATORY'];
const COSTS: CostType[] = ['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACT'];
const policy = new DelegationOfAuthorityPolicy();
let keySeq = 0;

const blankLine = (): LineRow => ({ key: ++keySeq, kind: 'ADD', sovLineId: '', description: '', costType: 'MATERIAL', quantity: '1', unit: 'nr', unitPrice: '' });

function fromDraft(d?: ChangeOrderDraft): { title: string; reason: ChangeReason; description: string; markup: string; days: string; lines: LineRow[] } {
  if (!d) return { title: '', reason: 'OWNER_REQUEST', description: '', markup: '10', days: '0', lines: [blankLine()] };
  return {
    title: d.title,
    reason: d.reason,
    description: d.description,
    markup: String(d.markupBps / 100),
    days: String(d.scheduleImpactDays),
    lines: d.lines.map((l) => ({ key: ++keySeq, kind: l.kind, sovLineId: l.sovLineId ?? '', description: l.description, costType: l.costType, quantity: String(l.quantity), unit: l.unit, unitPrice: majorString(l.unitPriceMinor) })),
  };
}

interface Props {
  contract: Contract;
  initial?: ChangeOrderDraft;
  submitLabel?: string;
  onSubmit: (draft: ChangeOrderDraft) => void;
  onCancel?: () => void;
}

/**
 * Change-order editor with live totals. Uses the same domain functions as the API (computeTotals,
 * validateDraft, approval policy), so what you see is exactly what the server will calculate.
 */
export function ChangeOrderForm({ contract, initial, submitLabel = 'Save draft', onSubmit, onCancel }: Props) {
  const init = useMemo(() => fromDraft(initial), [initial]);
  const [title, setTitle] = useState(init.title);
  const [reason, setReason] = useState<ChangeReason>(init.reason);
  const [description, setDescription] = useState(init.description);
  const [markup, setMarkup] = useState(init.markup);
  const [days, setDays] = useState(init.days);
  const [lines, setLines] = useState<LineRow[]>(init.lines);
  const [touched, setTouched] = useState(false);
  const c = contract.currency;

  const update = (key: number, patch: Partial<LineRow>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const parsed = lines.map((l) => {
    const unitPriceMinor = parseMajor(l.unitPrice);
    const quantity = Number(l.quantity);
    return { row: l, unitPriceMinor, quantity, ok: unitPriceMinor !== null && Number.isFinite(quantity) && quantity > 0 };
  });
  const markupBps = Math.round(Number(markup) * 100);
  const scheduleImpactDays = Number.parseInt(days || '0', 10);
  const valid = parsed.filter((p) => p.ok);
  const totals = computeTotals(
    valid.map((p) => ({ kind: p.row.kind, quantity: p.quantity, unitPriceMinor: p.unitPriceMinor! })),
    Number.isFinite(markupBps) ? markupBps : 0,
  );
  const draft: ChangeOrderDraft = {
    title: title.trim(),
    reason,
    description: description.trim(),
    markupBps,
    scheduleImpactDays: Number.isFinite(scheduleImpactDays) ? scheduleImpactDays : 0,
    lines: valid.map((p) => ({
      kind: p.row.kind,
      sovLineId: p.row.sovLineId || null,
      description: p.row.description.trim() || '(no description)',
      costType: p.row.costType,
      quantity: p.quantity,
      unit: p.row.unit.trim() || 'nr',
      unitPriceMinor: p.unitPriceMinor!,
    })),
  };

  let problem: string | null = null;
  if (!draft.title) problem = 'Give the change order a title';
  else if (valid.length !== lines.length) problem = 'Every line needs a positive quantity and a price like 1250.00';
  else {
    try {
      validateDraft(draft, contract);
    } catch (e) {
      problem = (e as Error).message;
    }
  }

  const route = policy.steps({
    totalMinor: totals.totalMinor,
    scheduleImpactDays: draft.scheduleImpactDays,
    contractOriginalMinor: contract.originalValueMinor,
    approvedChangesMinor: contract.approvedChangesMinor,
  });
  const newCompletion = addDays(`${contract.revisedCompletionDate}T00:00:00.000Z`, draft.scheduleImpactDays).slice(0, 10);

  return (
    <form
      className="co-form"
      aria-label="Change order form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!problem) onSubmit(draft);
      }}
    >
      <div className="form-row">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Additional drainage to podium" />
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as ChangeReason)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </label>

      <table className="grid dense co-lines">
        <thead>
          <tr>
            <th>Type</th>
            <th>Schedule-of-values line</th>
            <th>Description</th>
            <th>Cost type</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Unit price</th>
            <th className="num">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {parsed.map(({ row, ok, quantity, unitPriceMinor }, i) => (
            <tr key={row.key} className={row.kind === 'OMIT' ? 'omit' : ''}>
              <td>
                <select aria-label={`Line ${i + 1} type`} value={row.kind} onChange={(e) => update(row.key, { kind: e.target.value as 'ADD' | 'OMIT' })}>
                  <option value="ADD">Add</option>
                  <option value="OMIT">Omit (credit)</option>
                </select>
              </td>
              <td>
                <select aria-label={`Line ${i + 1} SOV line`} value={row.sovLineId} onChange={(e) => update(row.key, { sovLineId: e.target.value })}>
                  <option value="">New line</option>
                  {contract.sov.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.description.slice(0, 40)}</option>
                  ))}
                </select>
              </td>
              <td>
                <input aria-label={`Line ${i + 1} description`} value={row.description} onChange={(e) => update(row.key, { description: e.target.value })} />
              </td>
              <td>
                <select aria-label={`Line ${i + 1} cost type`} value={row.costType} onChange={(e) => update(row.key, { costType: e.target.value as CostType })}>
                  {COSTS.map((ct) => (
                    <option key={ct} value={ct}>{ct.toLowerCase()}</option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input aria-label={`Line ${i + 1} quantity`} className="num" inputMode="decimal" value={row.quantity} onChange={(e) => update(row.key, { quantity: e.target.value })} />
              </td>
              <td>
                <input aria-label={`Line ${i + 1} unit`} className="short" value={row.unit} onChange={(e) => update(row.key, { unit: e.target.value })} />
              </td>
              <td className="num">
                <input aria-label={`Line ${i + 1} unit price`} className="num" inputMode="decimal" placeholder="0.00" value={row.unitPrice} onChange={(e) => update(row.key, { unitPrice: e.target.value })} />
              </td>
              <td className="num" data-testid={`line-amount-${i}`}>
                {ok ? money(lineAmount({ kind: row.kind, quantity, unitPriceMinor: unitPriceMinor! }), c) : '—'}
              </td>
              <td>
                <button type="button" className="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((l) => l.key !== row.key))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={() => setLines((ls) => [...ls, blankLine()])}>
        + Add line
      </button>

      <div className="co-bottom">
        <div className="form-row compact">
          <label>
            Overhead &amp; profit on adds (%)
            <input aria-label="Markup percent" className="num" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
          </label>
          <label>
            Schedule impact (days)
            <input aria-label="Schedule impact days" className="num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        <dl className="totals" aria-label="Live totals">
          <dt>Added work</dt>
          <dd>{money(totals.addsMinor, c)}</dd>
          <dt>Omissions (credit)</dt>
          <dd>{money(totals.omitsMinor, c)}</dd>
          <dt>Overhead &amp; profit</dt>
          <dd>{money(totals.markupMinor, c)}</dd>
          <dt className="strong">Change order total</dt>
          <dd className="strong" data-testid="co-total">{money(totals.totalMinor, c)}</dd>
          <dt>Contract value</dt>
          <dd data-testid="contract-after">
            {money(contract.revisedValueMinor, c)} → <strong>{money(contract.revisedValueMinor + totals.totalMinor, c)}</strong>
          </dd>
          <dt>Completion</dt>
          <dd>
            {contract.revisedCompletionDate} → <strong>{newCompletion}</strong>
          </dd>
        </dl>
        <div className="route" aria-label="Approval route">
          <div className="sub">Approval route</div>
          {route.map((s) => (
            <span key={s.role} className="chip waiting" data-testid={`route-${s.role}`}>
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {touched && problem && <p className="error" role="alert">{problem}</p>}
      <div className="actions">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
