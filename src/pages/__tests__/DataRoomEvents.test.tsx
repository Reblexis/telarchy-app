import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

async function show(events: unknown[]) {
  vi.mocked(api.getDataRoom).mockResolvedValue({
    schema: 1,
    generatedAt: '2026-09-09',
    doc: {
      updatedAt: '2026-09-09',
      sections: [{ id: 'events', title: 'What moved it', markdown: 'Context for the readings.', blocks: ['events'] }],
    },
    evidence: { events },
  } as never);
  render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
}
test('WHAT MOVED IT IS VISIBLE IN THE DATA ROOM', async () => {
  await show([{ at: '2026-09-01T00:00:00Z', kind: 'announced', label: 'Opened the market' }]);
  expect(await screen.findByText('Opened the market')).toBeTruthy();
});
test('EMPTY EVENT HISTORY IS EXPLICIT', async () => {
  await show([]);
  expect(await screen.findByText('No events recorded yet.')).toBeTruthy();
});
