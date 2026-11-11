import { shortDateTime } from '../format';
import { useDemo } from '../state/store';
import { useQuery } from '../state/useQuery';
import { can } from '@core/shared/actor';

/** Integration events on the bus (what other services would consume) and the tenant audit log. */
export function ActivityView() {
  const events = useDemo((s) => s.events);
  const { data: audit } = useQuery((p, a) => (can(a, 'audit:read') ? p.contracts.recentActivity(a, 60) : Promise.resolve(null)));
  return (
    <div className="two-col">
      <div className="card">
        <h3>Event stream</h3>
        <p className="sub">Written to the outbox in the same transaction as the change, then published. The contracts module creates contracts only from <code>rfx.awarded</code>.</p>
        <ul className="events">
          {events.map((e) => (
            <li key={e.id}>
              <span className="mono">{shortDateTime(e.occurredAt)}</span> <span className="code">{e.type}</span>
              <span className="muted"> {e.aggregateId}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Audit log</h3>
        {audit === null ? (
          <p className="muted">This persona can't read the audit log.</p>
        ) : (
          <ul className="events">
            {audit?.map((e) => (
              <li key={e.id}>
                <span className="mono">{shortDateTime(e.at)}</span> <strong>{e.entityType}</strong> {e.action} · {e.actorName}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
