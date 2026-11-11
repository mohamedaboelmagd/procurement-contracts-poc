import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApprovalTimeline } from './ApprovalTimeline';

describe('<ApprovalTimeline>', () => {
  it('shows who decided each step and what is pending', () => {
    render(
      <ApprovalTimeline
        co={{
          requestedByName: 'Site engineer',
          createdAt: '2026-11-10T09:00:00Z',
          submittedAt: '2026-11-10T09:30:00Z',
          status: 'PENDING_APPROVAL',
          steps: [
            { role: 'project_manager', label: 'Project manager review', status: 'APPROVED', decidedByName: 'PM One', decidedAt: '2026-11-10T10:00:00Z', comment: 'Scope confirmed' },
            { role: 'commercial_manager', label: 'Commercial approval', status: 'PENDING' },
            { role: 'director', label: 'Director sign-off', status: 'WAITING' },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('step-project_manager')).toHaveTextContent('PM One');
    expect(screen.getByTestId('step-project_manager')).toHaveTextContent('Scope confirmed');
    expect(screen.getByTestId('step-commercial_manager')).toHaveClass('pending');
    expect(screen.getByTestId('step-director')).toHaveTextContent('waiting');
    expect(screen.queryByText('Contract revised')).not.toBeInTheDocument();
  });
});
