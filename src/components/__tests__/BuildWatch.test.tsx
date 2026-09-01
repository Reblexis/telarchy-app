import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BuildWatch } from '../BuildWatch';

const OLD = '/assets/index-OLD11111.js';
const getServedIndexHtml = vi.fn();
vi.mock('../../lib/api', () => ({ api: { getServedIndexHtml: () => getServedIndexHtml() } }));

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = `<script type="module" crossorigin src="${OLD}"></script>`;
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
  vi.resetAllMocks();
});

test('a new build the visitor is looking at shows up as the reload pill', async () => {
  getServedIndexHtml.mockResolvedValue('<script type="module" src="/assets/index-NEW22222.js"></script>');
  render(<BuildWatch />);
  expect(screen.queryByText(/new version/)).toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(screen.getByRole('button', { name: /new version · reload/ })).toBeInTheDocument();
});

test('the build it is already running draws nothing', async () => {
  getServedIndexHtml.mockResolvedValue(`<script type="module" src="${OLD}"></script>`);
  render(<BuildWatch />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(screen.queryByText(/new version/)).toBeNull();
});
