import { useState } from 'react';
import { SUPPLIERS } from '@core/seed';
import type { CreateRfxInput } from '@core/sourcing/sourcing.service';
import type { RfxType } from '@core/sourcing/rfx';
import { addDays } from '@core/shared/clock';

interface Row {
  key: number;
  code: string;
  description: string;
  unit: string;
  quantity: string;
}
let seq = 0;
const row = (n: number): Row => ({ key: ++seq, code: `L-${String(n).padStart(2, '0')}`, description: '', unit: 'm²', quantity: '1' });

export function RfxCreateForm({ now, onSubmit, onCancel }: { now: Date; onSubmit: (input: CreateRfxInput) => void; onCancel: () => void }) {
  const [type, setType] = useState<RfxType>('RFQ');
  const [title, setTitle] = useState('Finishes package — Tower B lobby');
  const [project, setProject] = useState('Riverside Mixed-Use Development (sample)');
  const [dueDays, setDueDays] = useState('7');
  const [lines, setLines] = useState<Row[]>([
    { key: ++seq, code: 'F-01', description: 'Porcelain floor tiles 600×600, supply & lay', unit: 'm²', quantity: '850' },
    { key: ++seq, code: 'F-02', description: 'Gypsum board ceiling with access panels', unit: 'm²', quantity: '640' },
    { key: ++seq, code: 'F-03', description: 'Feature wall cladding, stone veneer', unit: 'm²', quantity: '120' },
  ]);
  const [invited, setInvited] = useState<string[]>(SUPPLIERS.map((s) => s.supplierId));
  const update = (key: number, patch: Partial<Row>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form
      className="card form"
      aria-label="New sourcing event"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          type,
          title,
          projectName: project,
          currency: 'USD',
          bidDueAt: addDays(now.toISOString(), Number(dueDays) || 7),
          lines: lines.map((l) => ({ code: l.code, description: l.description, unit: l.unit, quantity: Number(l.quantity) })),
          suppliers: SUPPLIERS.filter((s) => invited.includes(s.supplierId)).map((s) => ({ ...s })),
        });
      }}
    >
      <h3>New sourcing event</h3>
      <div className="form-row">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as RfxType)}>
            <option value="RFQ">RFQ: request for quotation</option>
            <option value="RFP">RFP: request for proposal</option>
            <option value="RFI">RFI: request for information</option>
          </select>
        </label>
        <label className="grow">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <div className="form-row">
        <label className="grow">
          Project
          <input value={project} onChange={(e) => setProject(e.target.value)} />
        </label>
        <label>
          Bids due in (days)
          <input className="num" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </label>
      </div>
      <table className="grid dense">
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th>Unit</th>
            <th className="num">Qty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key}>
              <td><input className="short" value={l.code} onChange={(e) => update(l.key, { code: e.target.value })} /></td>
              <td><input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} /></td>
              <td><input className="short" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} /></td>
              <td className="num"><input className="num" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /></td>
              <td><button type="button" className="ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={() => setLines((ls) => [...ls, row(ls.length + 1)])}>+ Add line</button>
      <fieldset>
        <legend>Invite suppliers</legend>
        {SUPPLIERS.map((s) => (
          <label key={s.supplierId} className="check">
            <input type="checkbox" checked={invited.includes(s.supplierId)} onChange={(e) => setInvited((v) => (e.target.checked ? [...v, s.supplierId] : v.filter((x) => x !== s.supplierId)))} />
            {s.supplierName}
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">Create draft</button>
      </div>
    </form>
  );
}
