import { useEffect, useState } from 'react';
import { currentStep, lineAmount, type ChangeOrder } from '@core/contracts/change-order';
import { retentionMinor, type Contract } from '@core/contracts/contract';
import { can } from '@core/shared/actor';
import { ApprovalTimeline } from '../components/ApprovalTimeline';
import { ChangeOrderForm } from '../components/ChangeOrderForm';
import { StatusChip } from '../components/Chip';
import { humanize, money, shortDate, shortDateTime } from '../format';
import { useActor, useDemo } from '../state/store';
import { useQuery } from '../state/useQuery';

export function ContractsView({ contractId, onSelect }: { contractId: string | null; onSelect: (id: string) => void }) {
  const { data: list } = useQuery((p, a) => p.contracts.list(a));
  useEffect(() => {
    if (list && (!contractId || !list.some((c) => c.id === contractId)) && list[0]) onSelect(list[0].id);
  }, [list, contractId, onSelect]);

  return (
    <div className="split">
      <aside className="list">
        <div className="list-head">
          <h2>Contracts</h2>
        </div>
        {list?.length === 0 && <p className="muted pad">No contracts visible to this persona.</p>}
        {list?.map((c) => (
          <button key={c.id} className={`list-item ${c.id === contractId ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
            <div className="row">
              <span className="code">{c.number}</span>
              <span className="muted">rev {c.revision}</span>
            </div>
            <div className="title">{c.title}</div>
            <div className="sub">
              {c.supplierName} · {money(c.revisedValueMinor, c.currency)}
            </div>
          </button>
        ))}
      </aside>
      <section className="detail">{contractId && list?.some((c) => c.id === contractId) && <ContractDetail id={contractId} />}</section>
    </div>
  );
}

function ContractDetail({ id }: { id: string }) {
  const actor = useActor();
  const act = useDemo((s) => s.act);
  const { data: contract } = useQuery((p, a) => p.contracts.get(a, id), [id]);
  const { data: cos } = useQuery((p, a) => p.contracts.listChangeOrders(a, id), [id]);
  const [coId, setCoId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (cos) setCoId((cur) => (cur && cos.some((c) => c.id === cur) ? cur : (cos.at(-1)?.id ?? null)));
  }, [cos]);

  if (!contract) return null;
  const c = contract.currency;
  const co = cos?.find((x) => x.id === coId);

  return (
    <div className="stack">
      <header className="detail-head">
        <div>
          <div className="eyebrow">
            {contract.number} · from {contract.rfxNumber} · {contract.projectName}
          </div>
          <h2>{contract.title}</h2>
          <div className="sub">
            {contract.supplierName} · revision {contract.revision}
          </div>
        </div>
      </header>

      <div className="kpis">
        <Kpi label="Original value" value={money(contract.originalValueMinor, c)} />
        <Kpi label="Approved changes" value={money(contract.approvedChangesMinor, c)} tone={contract.approvedChangesMinor ? 'warn' : undefined} />
        <Kpi label="Revised value" value={money(contract.revisedValueMinor, c)} strong />
        <Kpi label={`Retention (${contract.retentionBps / 100}%)`} value={money(retentionMinor(contract), c)} />
        <Kpi label="Completion" value={contract.revisedCompletionDate} sub={contract.scheduleDaysAdded ? `+${contract.scheduleDaysAdded} d vs ${contract.originalCompletionDate}` : 'on original date'} />
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Schedule of values</h3>
          <SovTable contract={contract} />
        </div>
        <div className="card">
          <h3>Contract versions</h3>
          <ol className="versions">
            {[...contract.revisions].reverse().map((r) => (
              <li key={r.revision}>
                <span className="code">v{r.revision}</span> {money(r.valueMinor, c)} · completes {r.completionDate}
                <div className="sub">
                  {r.reason} · {r.by} · {shortDate(r.at)}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="list-head">
          <h3>Change orders</h3>
          {can(actor, 'change_orders:write') && !creating && (
            <button className="primary small" onClick={() => setCreating(true)}>
              + New change order
            </button>
          )}
        </div>
        <table className="grid dense clickable">
          <thead>
            <tr>
              <th>No.</th>
              <th>Title</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Waiting for</th>
              <th className="num">Days</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {cos?.map((x) => (
              <tr key={x.id} className={x.id === coId && !creating ? 'active' : ''} onClick={() => { setCoId(x.id); setCreating(false); }}>
                <td className="code">
                  {x.number}
                  {x.revision > 1 && <span className="muted"> r{x.revision}</span>}
                </td>
                <td>{x.title}</td>
                <td className="muted">{humanize(x.reason)}</td>
                <td><StatusChip status={x.status} /></td>
                <td className="muted">{currentStep(x)?.label ?? '—'}</td>
                <td className="num">{x.scheduleImpactDays > 0 ? `+${x.scheduleImpactDays}` : x.scheduleImpactDays}</td>
                <td className="num">{money(x.totals.totalMinor, c)}</td>
              </tr>
            ))}
            {cos?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">No change orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating ? (
        <div className="card">
          <h3>New change order on {contract.number}</h3>
          <ChangeOrderForm
            contract={contract}
            onCancel={() => setCreating(false)}
            onSubmit={async (draft) => {
              const created = await act('Change order drafted', (p, a) => p.contracts.createChangeOrder(a, id, draft));
              if (created) {
                setCreating(false);
                setCoId(created.id);
              }
            }}
          />
        </div>
      ) : (
        co && <ChangeOrderDetail co={co} contract={contract} />
      )}
    </div>
  );
}

function ChangeOrderDetail({ co, contract }: { co: ChangeOrder; contract: Contract }) {
  const actor = useActor();
  const act = useDemo((s) => s.act);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const { data: audit } = useQuery((p, a) => (can(a, 'audit:read') ? p.contracts.auditTrail(a, co.id) : Promise.resolve([])), [co.id]);
  const step = currentStep(co);
  const mine = co.requestedBy === actor.userId;
  const canDecide = step && actor.roles.includes(step.role) && can(actor, 'change_orders:decide');
  const c = contract.currency;
  const sovCode = (sovId: string | null) => (sovId ? contract.sov.find((s) => s.id === sovId)?.code ?? '?' : 'new');

  useEffect(() => setEditing(false), [co.id]);

  if (editing) {
    return (
      <div className="card">
        <h3>
          {co.status === 'REJECTED' ? 'Rework' : 'Edit'} {co.number} {co.status === 'REJECTED' && <span className="muted">(becomes revision {co.revision + 1})</span>}
        </h3>
        <ChangeOrderForm
          contract={contract}
          initial={co}
          submitLabel={co.status === 'REJECTED' ? 'Save as new revision' : 'Save'}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            const ok = await act(`${co.number} saved`, (p, a) => p.contracts.updateChangeOrder(a, co.id, draft, co.version));
            if (ok) setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="two-col wide-left">
      <div className="card">
        <div className="list-head">
          <h3>
            {co.number}: {co.title} <StatusChip status={co.status} />
          </h3>
          <div className="actions">
            {mine && (co.status === 'DRAFT' || co.status === 'REJECTED') && (
              <button className="ghost small" onClick={() => setEditing(true)}>
                {co.status === 'REJECTED' ? 'Rework' : 'Edit'}
              </button>
            )}
            {mine && co.status === 'DRAFT' && (
              <button className="primary small" onClick={() => act(`${co.number} submitted for approval`, (p, a) => p.contracts.submit(a, co.id))}>
                Submit for approval
              </button>
            )}
            {mine && co.status !== 'APPROVED' && co.status !== 'WITHDRAWN' && (
              <button className="ghost small" onClick={() => act(`${co.number} withdrawn`, (p, a) => p.contracts.withdraw(a, co.id))}>
                Withdraw
              </button>
            )}
          </div>
        </div>
        {co.description && <p className="sub">{co.description}</p>}
        <table className="grid dense">
          <thead>
            <tr>
              <th>Type</th>
              <th>SOV</th>
              <th>Description</th>
              <th>Cost</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {co.lines.map((l) => (
              <tr key={l.id} className={l.kind === 'OMIT' ? 'omit' : ''}>
                <td>{l.kind === 'OMIT' ? 'Omit' : 'Add'}</td>
                <td className="code">{sovCode(l.sovLineId)}</td>
                <td>{l.description}</td>
                <td className="muted">{l.costType.toLowerCase()}</td>
                <td className="num">
                  {l.quantity} {l.unit}
                </td>
                <td className="num">{money(l.unitPriceMinor, c)}</td>
                <td className="num">{money(lineAmount(l), c)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={6}>Overhead &amp; profit ({co.markupBps / 100}% on adds)</th>
              <td className="num">{money(co.totals.markupMinor, c)}</td>
            </tr>
            <tr className="strong">
              <th colSpan={6}>Total · schedule impact {co.scheduleImpactDays} days</th>
              <td className="num">{money(co.totals.totalMinor, c)}</td>
            </tr>
          </tfoot>
        </table>
        {co.history.length > 0 && (
          <div className="history">
            <h4>Earlier revisions</h4>
            {co.history.map((h) => (
              <div key={h.revision} className="sub">
                r{h.revision} · {h.status.toLowerCase()} · {money(h.totals.totalMinor, c)} · {h.note} ({h.by}, {shortDate(h.at)})
              </div>
            ))}
          </div>
        )}
        {audit && audit.length > 0 && (
          <div className="history">
            <h4>Audit trail</h4>
            {audit.map((e) => (
              <div key={e.id} className="audit-row">
                <span className="mono">{shortDateTime(e.at)}</span> <strong>{e.action}</strong> · {e.actorName}
                {typeof e.details?.comment === 'string' && <span className="muted"> · “{e.details.comment}”</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Approval</h3>
        <ApprovalTimeline co={co} />
        {co.status === 'PENDING_APPROVAL' && (
          <div className="decide">
            {canDecide ? (
              <>
                <textarea aria-label="Decision comment" placeholder="Comment (required to reject)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="actions">
                  <button className="danger small" onClick={async () => (await act(`${co.number} rejected`, (p, a) => p.contracts.decide(a, co.id, { decision: 'REJECT', comment }))) && setComment('')}>
                    Reject
                  </button>
                  <button className="primary small" onClick={async () => (await act(`${step!.label}: approved`, (p, a) => p.contracts.decide(a, co.id, { decision: 'APPROVE', ...(comment ? { comment } : {}) }))) && setComment('')}>
                    Approve as {step!.label.toLowerCase()}
                  </button>
                </div>
              </>
            ) : (
              <p className="sub">
                Waiting for <strong>{step?.label}</strong>. Switch persona (top right) to act.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SovTable({ contract }: { contract: Contract }) {
  const c = contract.currency;
  return (
    <table className="grid dense">
      <thead>
        <tr>
          <th>Code</th>
          <th>Description</th>
          <th className="num">Original</th>
          <th className="num">Changes</th>
          <th className="num">Current</th>
        </tr>
      </thead>
      <tbody>
        {contract.sov.map((s) => (
          <tr key={s.id} className={s.source === 'CHANGE_ORDER' ? 'co-row' : ''}>
            <td className="code">{s.code}</td>
            <td>{s.description}</td>
            <td className="num">{s.originalValueMinor ? money(s.originalValueMinor, c) : '—'}</td>
            <td className={`num ${s.changeOrderValueMinor < 0 ? 'neg' : s.changeOrderValueMinor > 0 ? 'pos' : 'muted'}`}>{s.changeOrderValueMinor ? money(s.changeOrderValueMinor, c) : '—'}</td>
            <td className="num">{money(s.originalValueMinor + s.changeOrderValueMinor, c)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="strong">
          <th colSpan={2}>Total</th>
          <td className="num">{money(contract.originalValueMinor, c)}</td>
          <td className="num">{money(contract.approvedChangesMinor, c)}</td>
          <td className="num">{money(contract.revisedValueMinor, c)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Kpi({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: 'warn' | undefined }) {
  return (
    <div className={`kpi ${strong ? 'strong' : ''} ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
