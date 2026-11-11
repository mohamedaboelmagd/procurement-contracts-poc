import { useEffect, useState } from 'react';
import { can, isSupplier } from '@core/shared/actor';
import { BidLevellingTable } from '../components/BidLevellingTable';
import { StatusChip } from '../components/Chip';
import { RfxCreateForm } from '../components/RfxCreateForm';
import { SupplierBidForm } from '../components/SupplierBidForm';
import { money, shortDate, shortDateTime } from '../format';
import { useActor, useDemo } from '../state/store';
import { useQuery } from '../state/useQuery';

export function SourcingView({ onOpenContract }: { onOpenContract: (id: string) => void }) {
  const actor = useActor();
  const act = useDemo((s) => s.act);
  const clock = useDemo((s) => s.clock);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: list } = useQuery((p, a) => p.sourcing.list(a));

  // Re-validate the selection only when a fresh list arrives (not when the user just created/selected one).
  useEffect(() => {
    if (list) setSelected((cur) => (cur && list.some((r) => r.id === cur) ? cur : (list[0]?.id ?? null)));
  }, [list]);

  return (
    <div className="split">
      <aside className="list">
        <div className="list-head">
          <h2>Sourcing events</h2>
          {can(actor, 'rfx:write') && (
            <button className="primary small" onClick={() => setCreating(true)}>
              + New
            </button>
          )}
        </div>
        {list?.length === 0 && <p className="muted pad">Nothing visible to this persona.</p>}
        {list?.map((r) => {
          const responded = r.invitations.filter((i) => i.status !== 'INVITED').length;
          return (
            <button key={r.id} className={`list-item ${r.id === selected && !creating ? 'active' : ''}`} onClick={() => { setSelected(r.id); setCreating(false); }}>
              <div className="row">
                <span className="code">{r.number}</span>
                <StatusChip status={r.status} />
              </div>
              <div className="title">{r.title}</div>
              <div className="sub">
                {r.lines.length} lines · {isSupplier(actor) ? `due ${shortDate(r.bidDueAt)}` : `${responded}/${r.invitations.length} responded`}
              </div>
            </button>
          );
        })}
      </aside>
      <section className="detail">
        {creating && clock ? (
          <RfxCreateForm
            now={clock.now()}
            onCancel={() => setCreating(false)}
            onSubmit={async (input) => {
              const rfx = await act('Draft created', (p, a) => p.sourcing.create(a, input));
              if (rfx) {
                setCreating(false);
                setSelected(rfx.id);
              }
            }}
          />
        ) : selected ? (
          <RfxDetail id={selected} onOpenContract={onOpenContract} />
        ) : null}
      </section>
    </div>
  );
}

function RfxDetail({ id, onOpenContract }: { id: string; onOpenContract: (id: string) => void }) {
  const actor = useActor();
  const act = useDemo((s) => s.act);
  const { data: rfx, error } = useQuery((p, a) => p.sourcing.get(a, id), [id]);
  const canReadBids = can(actor, 'bids:read');
  const { data: bids } = useQuery((p, a) => (canReadBids ? p.sourcing.bidSummaries(a, id) : Promise.resolve([])), [id, canReadBids]);
  const opened = rfx?.status === 'CLOSED' || rfx?.status === 'AWARDED';
  const { data: matrix } = useQuery((p, a) => (opened && canReadBids ? p.sourcing.levelling(a, id) : Promise.resolve(null)), [id, opened, canReadBids]);
  const { data: contract } = useQuery((p, a) => (rfx?.status === 'AWARDED' ? p.contracts.byRfx(a, id) : Promise.resolve(null)), [id, rfx?.status]);
  const [receipt, setReceipt] = useState<{ sealHash: string; revision: number } | null>(null);

  if (error) return <p className="error">{error}</p>;
  if (!rfx) return null;
  const supplier = isSupplier(actor);
  const myInvite = rfx.invitations.find((i) => i.supplierId === actor.supplierId);

  return (
    <div className="stack">
      <header className="detail-head">
        <div>
          <div className="eyebrow">
            {rfx.number} · {rfx.projectName}
          </div>
          <h2>{rfx.title}</h2>
          <div className="sub">
            <StatusChip status={rfx.status} /> Bids due {shortDateTime(rfx.bidDueAt)} · {rfx.currency}
          </div>
        </div>
        <div className="actions">
          {rfx.status === 'DRAFT' && can(actor, 'rfx:write') && (
            <button className="primary" onClick={() => act(`${rfx.number} published to ${rfx.invitations.length} suppliers`, (p, a) => p.sourcing.publish(a, id))}>
              Publish
            </button>
          )}
          {rfx.status === 'PUBLISHED' && can(actor, 'rfx:write') && (
            <button className="primary" onClick={() => act('Bidding closed, seals verified and bids opened', (p, a) => p.sourcing.close(a, id))}>
              Close bidding &amp; open bids
            </button>
          )}
          {contract && (
            <button className="ghost" onClick={() => onOpenContract(contract.id)}>
              Open {contract.number} →
            </button>
          )}
        </div>
      </header>

      {rfx.award && (
        <div className={`callout ${rfx.award.lowestBid ? 'ok' : 'warn'}`}>
          Awarded to <strong>{rfx.award.supplierName}</strong> for {money(rfx.award.totalMinor, rfx.currency)} on {shortDate(rfx.award.awardedAt)}
          {rfx.award.justification && <> · justification: “{rfx.award.justification}”</>}
        </div>
      )}

      {!opened && (
        <div className="card">
          <h3>Line items</h3>
          <table className="grid dense">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th className="num">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {rfx.lines.map((l) => (
                <tr key={l.id}>
                  <td className="code">{l.code}</td>
                  <td>{l.description}</td>
                  <td className="num">
                    {l.quantity.toLocaleString('en-US')} {l.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canReadBids && bids && (
        <div className="card">
          <h3>{opened ? 'Opened bids' : 'Sealed bids'}</h3>
          {!opened && <p className="sub">Prices stay sealed until bidding closes. You can see who responded and their seal receipt (SHA-256), never the amounts.</p>}
          <table className="grid dense">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Seal</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((b) => (
                <tr key={b.supplierId}>
                  <td>{b.supplierName}</td>
                  <td><StatusChip status={b.status} /></td>
                  <td className="muted">{b.submittedAt ? `${shortDateTime(b.submittedAt)} · rev ${b.revision}` : '—'}</td>
                  <td className="mono">
                    {b.sealHash ? `${b.sealHash.slice(0, 12)}…` : '—'}
                    {b.sealVerified === true && <span className="ok-text"> ✓ verified</span>}
                    {b.sealVerified === false && <span className="warn"> ✕ tampered</span>}
                  </td>
                  <td className="num">{b.totalMinor !== undefined ? money(b.totalMinor, rfx.currency) : <span className="muted">sealed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {matrix && (
        <div className="card">
          <h3>Bid levelling</h3>
          <p className="sub">Missing lines are plugged with the highest quote, so an incomplete bid never looks cheaper. Ranking uses the normalised total.</p>
          <BidLevellingTable
            matrix={matrix}
            awardable={rfx.status === 'CLOSED' && can(actor, 'rfx:award') && rfx.type !== 'RFI'}
            {...(rfx.award ? { awardedSupplierId: rfx.award.supplierId } : {})}
            onAward={(supplierId, justification) =>
              act('Awarded: contract created from the winning bid', (p, a) => p.sourcing.award(a, id, { supplierId, ...(justification ? { justification } : {}) }))
            }
          />
        </div>
      )}

      {supplier && myInvite && rfx.status === 'PUBLISHED' && (
        <>
          <div className="callout">
            Your invitation: <StatusChip status={myInvite.status} />
            {receipt && (
              <span className="mono">
                {' '}· receipt rev {receipt.revision}: {receipt.sealHash.slice(0, 16)}…
              </span>
            )}
            {myInvite.status === 'INVITED' && (
              <button className="ghost small" onClick={() => act('Invitation declined', (p, a) => p.sourcing.declineInvitation(a, id))}>
                Decline
              </button>
            )}
          </div>
          {myInvite.status !== 'DECLINED' && (
            <SupplierBidForm
              rfx={rfx}
              onSubmit={async (input) => {
                const r = await act('Sealed bid submitted', (p, a) => p.sourcing.submitBid(a, id, input));
                if (r) setReceipt({ sealHash: r.sealHash, revision: r.revision });
              }}
            />
          )}
        </>
      )}
      {supplier && rfx.status !== 'PUBLISHED' && rfx.status !== 'DRAFT' && (
        <div className="callout">Bidding is closed for this event{rfx.award ? ' and you won the award.' : '.'}</div>
      )}
    </div>
  );
}
