import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

/**
 * The floor's announcements section, since it became one line (owner
 * direction 2026-08-20). What matters here is that a trader arriving
 * mid-market can still tell at a glance that something was said and when,
 * and can get to the record in one click. The record itself, including what
 * an edited announcement has to admit, is AnnouncementsPage's spec.
 */

import { FloorAnnouncements } from '../FloorAnnouncements';

const LATEST = {
  id: 'a2',
  // The one actually published on 2026-08-19, first paragraph.
  body: 'Season 0 starts Friday 00:00 UTC. It runs to 16 October, the pool is $1,000 of real money paid $500 / $250 / $125 / $75 / $50 to the top five.',
  publishedAt: '2026-08-15T09:00:00Z',
  editedAt: null,
  originalBody: null,
};

const renderFloor = (props: Partial<Parameters<typeof FloorAnnouncements>[0]> = {}) =>
  render(
    <MemoryRouter>
      <FloorAnnouncements idOrSlug="telarchy" latest={LATEST} total={1} canManage={false} {...props} />
    </MemoryRouter>,
  );

describe('announcements on the floor', () => {
  test('shows the headline and the day, and nothing else of the body', () => {
    renderFloor();
    expect(screen.getByText('Season 0 starts Friday 00:00 UTC.')).toBeTruthy();
    expect(screen.getByText('15 Aug')).toBeTruthy();
    // The rest of the announcement belongs to the page, not to the floor.
    expect(screen.queryByText(/16 October/)).toBeNull();
  });

  test('the line is the way to the record', () => {
    renderFloor();
    const link = screen.getByText('Season 0 starts Friday 00:00 UTC.').closest('a');
    expect(link?.getAttribute('href')).toBe('/telarchy/announcements');
  });

  test('more than one says how many, and one does not', () => {
    const { unmount } = renderFloor({ total: 4 });
    expect(screen.getByText('All 4').getAttribute('href')).toBe('/telarchy/announcements');
    unmount();
    renderFloor({ total: 1 });
    expect(screen.queryByText(/^All /)).toBeNull();
  });

  test('a visitor sees no section at all on a floor with nothing announced', () => {
    const { container } = renderFloor({ latest: null, total: 0 });
    expect(container.querySelector('section')).toBeNull();
  });

  test('the owner sees the empty floor, and a way to write the first one', () => {
    renderFloor({ latest: null, total: 0, canManage: true });
    expect(screen.getByText(/Nothing announced yet/)).toBeTruthy();
    expect(screen.getByText('Write one').getAttribute('href')).toBe('/telarchy/announcements');
  });
});
