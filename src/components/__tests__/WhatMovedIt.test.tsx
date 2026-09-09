import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { WhatMovedIt } from '../WhatMovedIt';

/**
 * The list under the chart (docs/ui-conventions.md, "The price and the
 * chart"): what the marks on the line are, numbered to match them.
 *
 * It carries no number of its own. What the metric did after each event is on
 * the chart the marks sit on, and printing "+3 in the week after" beside the
 * label would be the same fact stated twice, the second time rounded.
 */
const EVENTS = [
  { at: '2026-09-04T00:00:00.000Z', kind: 'approved', label: 'Trader rewards' },
  { at: '2026-08-22T00:00:00.000Z', kind: 'announcement', label: 'Season 0 opened' },
];

describe('what moved it', () => {
  test('one row per event, oldest first, numbered as the marks are', () => {
    const { container } = render(<WhatMovedIt events={EVENTS} />);
    const rows = [...container.querySelectorAll('.pubws-moved-row')].map(r => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('1');
    expect(rows[0]).toContain('Season 0 opened');
    expect(rows[1]).toContain('Trader rewards');
  });

  test('the day is named, and what kind of thing it was', () => {
    const { container } = render(<WhatMovedIt events={EVENTS} />);
    const first = container.querySelector('.pubws-moved-row')?.textContent ?? '';
    expect(first).toContain('22 Aug');
    expect(first).toContain('announced');
  });

  test('an approval and a delivery are different events and say which', () => {
    const { container } = render(
      <WhatMovedIt
        events={[
          { at: '2026-08-20T00:00:00.000Z', kind: 'approved', label: 'Reach out to 30 founders' },
          { at: '2026-09-02T00:00:00.000Z', kind: 'delivered', label: 'Reach out to 30 founders' },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll('.pubws-moved-row')].map(r => r.textContent ?? '');
    expect(rows[0]).toContain('approved');
    expect(rows[1]).toContain('delivered');
  });

  test('no events, no section: an empty heading explains nothing', () => {
    const { container } = render(<WhatMovedIt events={[]} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByText(/what moved it/i)).toBeNull();
  });
});
