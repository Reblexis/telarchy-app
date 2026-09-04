/**
 * Otto reads the help catalog, so a stale sentence there is a wrong answer
 * on the floor. On 2026-09-04 he told a visitor that linking Manifold pays
 * "credits equal to your Manifold net worth". The grant has been flat since
 * 2026-08-30 (docs/agent-economy.md, the earn table; the credits guide), and
 * the sentence he learned it from was the /api/earn entry's description of
 * kind "cap".
 */

import { HELP } from '../lib/help-catalog';

describe('the /api/earn entry describes the grant that exists', () => {
  const entry = HELP.endpoints.find(e => e.path === '/api/earn' && e.method === 'GET');

  test('the entry exists', () => {
    expect(entry).toBeTruthy();
  });

  test('does not say the Manifold link grants net worth', () => {
    expect(entry!.description).not.toMatch(/grants net worth/i);
    expect(entry!.description).not.toMatch(/1 mana = 1 credit/i);
  });

  test('says the record links are flat and not scaled by net worth', () => {
    expect(entry!.description).toMatch(/flat/i);
    expect(entry!.description).toMatch(/never scaled by net worth/i);
  });
});
