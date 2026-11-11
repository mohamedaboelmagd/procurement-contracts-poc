import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { levelBids } from '@core/sourcing/levelling';
import type { Bid } from '@core/sourcing/bid';
import type { Rfx } from '@core/sourcing/rfx';
import { BidLevellingTable } from './BidLevellingTable';

const rfx = {
  id: 'rfx_1',
  currency: 'USD',
  lines: [
    { id: 'l1', code: 'A', description: 'Concrete', unit: 'm³', quantity: 10 },
    { id: 'l2', code: 'B', description: 'Rebar', unit: 't', quantity: 1 },
  ],
} as Rfx;
const bid = (supplierId: string, lines: [string, number][]) =>
  ({ id: `b_${supplierId}`, supplierId, supplierName: `Supplier ${supplierId}`, leadTimeDays: 30, lines: lines.map(([lineId, unitPriceMinor]) => ({ lineId, unitPriceMinor })), totalMinor: 0 }) as unknown as Bid;

const matrix = levelBids(rfx, [bid('x', [['l1', 1000], ['l2', 5000]]), bid('y', [['l1', 900]]), bid('z', [['l1', 1100], ['l2', 6000]])]);

describe('<BidLevellingTable>', () => {
  it('highlights the lowest cell, shows plugged gaps and the recommended bid', () => {
    render(<BidLevellingTable matrix={matrix} awardable={false} />);
    expect(screen.getByTestId('cell-A-y')).toHaveClass('lowest');
    expect(screen.getByTestId('cell-B-y')).toHaveClass('plugged');
    expect(screen.getByTestId('cell-B-y')).toHaveTextContent('no bid · plug');
    expect(screen.getByTestId('normalised-y')).toHaveTextContent('USD 150.00'); // 90.00 + plug 60.00
    expect(screen.getByText('Recommended').closest('th')).toHaveTextContent('Supplier x');
  });

  it('asks for a justification when awarding a non-recommended bid', async () => {
    const user = userEvent.setup();
    const onAward = vi.fn();
    render(<BidLevellingTable matrix={matrix} awardable onAward={onAward} />);
    expect(screen.queryByLabelText('Award justification')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Select Supplier z'));
    await user.type(screen.getByLabelText('Award justification'), 'Better programme certainty');
    await user.click(screen.getByRole('button', { name: /Award to Supplier z/ }));
    expect(onAward).toHaveBeenCalledWith('z', 'Better programme certainty');
  });
});
