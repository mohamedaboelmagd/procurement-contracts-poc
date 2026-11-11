import type { ChangeOrder } from '@core/contracts/change-order';
import { shortDateTime } from '../format';

const ICON: Record<string, string> = { APPROVED: '✓', REJECTED: '✕', PENDING: '●', WAITING: '○' };

/** Vertical timeline: request → each approval step → outcome. */
export function ApprovalTimeline({ co }: { co: Pick<ChangeOrder, 'steps' | 'requestedByName' | 'createdAt' | 'submittedAt' | 'status' | 'decidedAt'> }) {
  return (
    <ol className="timeline" aria-label="Approval timeline">
      <li className="done">
        <span className="dot">✓</span>
        <div>
          <strong>Requested</strong> by {co.requestedByName}
          <div className="sub">{shortDateTime(co.createdAt)}{co.submittedAt ? ` · submitted ${shortDateTime(co.submittedAt)}` : ' · draft'}</div>
        </div>
      </li>
      {co.steps.map((s, i) => (
        <li key={i} className={s.status.toLowerCase()} data-testid={`step-${s.role}`}>
          <span className="dot">{ICON[s.status]}</span>
          <div>
            <strong>{s.label}</strong> <span className={`chip ${s.status.toLowerCase()}`}>{s.status.toLowerCase()}</span>
            {s.decidedByName && (
              <div className="sub">
                {s.decidedByName} · {shortDateTime(s.decidedAt!)}
              </div>
            )}
            {s.comment && <div className="comment">“{s.comment}”</div>}
          </div>
        </li>
      ))}
      {(co.status === 'APPROVED' || co.status === 'REJECTED' || co.status === 'WITHDRAWN') && (
        <li className={co.status.toLowerCase()}>
          <span className="dot">{co.status === 'APPROVED' ? '★' : '✕'}</span>
          <div>
            <strong>{co.status === 'APPROVED' ? 'Contract revised' : co.status === 'REJECTED' ? 'Rejected' : 'Withdrawn'}</strong>
            {co.decidedAt && <div className="sub">{shortDateTime(co.decidedAt)}</div>}
          </div>
        </li>
      )}
    </ol>
  );
}
