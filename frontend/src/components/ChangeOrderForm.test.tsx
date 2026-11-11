import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Contract } from '@core/contracts/contract';
import { ChangeOrderForm } from './ChangeOrderForm';

const contract = {
  id: 'ct_1',
  currency: 'USD',
  originalValueMinor: 1_000_000_00, // 1,000,000.00
  approvedChangesMinor: 0,
  revisedValueMinor: 1_000_000_00,
  revisedCompletionDate: '2027-03-01',
  sov: [{ id: 'sov_1', code: 'S-01', description: 'Concrete', originalValueMinor: 400_000_00, changeOrderValueMinor: 0, source: 'BID' }],
} as unknown as Contract;

describe('<ChangeOrderForm>', () => {
  it('recalculates totals, contract value and approval route as you type', async () => {
    const user = userEvent.setup();
    render(<ChangeOrderForm contract={contract} onSubmit={() => {}} />);
    await user.type(screen.getByLabelText('Line 1 description'), 'Floor drains');
    await user.clear(screen.getByLabelText('Line 1 quantity'));
    await user.type(screen.getByLabelText('Line 1 quantity'), '24');
    await user.type(screen.getByLabelText('Line 1 unit price'), '450');
    expect(screen.getByTestId('line-amount-0')).toHaveTextContent('USD 10,800.00');
    expect(screen.getByTestId('co-total')).toHaveTextContent('USD 11,880.00'); // +10% O&P
    expect(screen.getByTestId('contract-after')).toHaveTextContent('USD 1,011,880.00');
    expect(screen.queryByTestId('route-director')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Line 1 unit price'));
    await user.type(screen.getByLabelText('Line 1 unit price'), '2500'); // 60,000 ≥ 5% of original
    expect(screen.getByTestId('route-director')).toBeInTheDocument();
  });

  it('treats omissions as credits without markup', async () => {
    const user = userEvent.setup();
    render(<ChangeOrderForm contract={contract} onSubmit={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Line 1 type'), 'OMIT');
    await user.selectOptions(screen.getByLabelText('Line 1 SOV line'), 'sov_1');
    await user.clear(screen.getByLabelText('Line 1 quantity'));
    await user.type(screen.getByLabelText('Line 1 quantity'), '10');
    await user.type(screen.getByLabelText('Line 1 unit price'), '100.50');
    expect(screen.getByTestId('co-total')).toHaveTextContent('−USD 1,005.00');
  });

  it('blocks invalid drafts and submits integer minor units', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChangeOrderForm contract={contract} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/title/);
    await user.type(screen.getByPlaceholderText(/Additional drainage/), 'Extra sleeves');
    await user.type(screen.getByLabelText('Line 1 description'), 'Sleeves');
    await user.type(screen.getByLabelText('Line 1 unit price'), '12.34');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ title: 'Extra sleeves', markupBps: 1000, lines: [{ kind: 'ADD', unitPriceMinor: 1234, quantity: 1, sovLineId: null }] });
  });
});
