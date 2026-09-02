import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getGuides: vi.fn(async () => [
      { id: 'get-paid', title: 'Get paid for work', description: '', category: 'forecast', order: 50 },
    ]),
    getGuideCategories: vi.fn(async () => []),
    getGuide: vi.fn(async (id: string) => `# guide ${id}`),
  },
}));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

const { api } = await import('../../lib/api');
const { GuidesPage } = await import('../GuidesPage');

/**
 * /guides/contracts was the address of "Get paid for work" until the floor
 * stopped calling a proposal a contract (docs/ui-conventions.md). It is
 * printed in places nobody can edit now, so it lands on the guide it became.
 */
test('the old /guides/contracts address lands on /guides/get-paid', async () => {
  render(
    <MemoryRouter initialEntries={['/guides/contracts']}>
      <Routes>
        <Route path="/guides/:section" element={<GuidesPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('guide get-paid')).toBeTruthy();
  expect(vi.mocked(api.getGuide)).toHaveBeenCalledWith('get-paid');
  expect(vi.mocked(api.getGuide)).not.toHaveBeenCalledWith('contracts');
});
