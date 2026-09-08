/**
 * The floor payload says which metrics the platform writes itself
 * (docs/ui-conventions.md, "The stat row": a metric the platform syncs says
 * "synced hourly" in the reading cell instead of offering Report). The flag
 * is the self-sync's own matching rule, so the floor and the sync cannot
 * disagree about which metrics those are.
 */
import { isSelfSyncedMetric } from '../services/self-sync';

describe('isSelfSyncedMetric', () => {
  const env = process.env.SELF_SYNC_WORKSPACE_ID;
  afterEach(() => {
    if (env === undefined) delete process.env.SELF_SYNC_WORKSPACE_ID;
    else process.env.SELF_SYNC_WORKSPACE_ID = env;
  });

  test('the self-sync workspace: its synced names, bare or with a unit tail', () => {
    process.env.SELF_SYNC_WORKSPACE_ID = 'ws-telarchy';
    expect(isSelfSyncedMetric('ws-telarchy', 'Weekly active verified traders')).toBe(true);
    expect(isSelfSyncedMetric('ws-telarchy', 'Weekly active verified traders (people)')).toBe(true);
    expect(isSelfSyncedMetric('ws-telarchy', 'Telarchy revenue (USD)')).toBe(true);
  });

  test('the self-sync workspace: its other metrics are the owner\'s to report', () => {
    process.env.SELF_SYNC_WORKSPACE_ID = 'ws-telarchy';
    expect(isSelfSyncedMetric('ws-telarchy', 'Valuation (USD)')).toBe(false);
    expect(isSelfSyncedMetric('ws-telarchy', 'Revenue (USD)')).toBe(false);
  });

  test('any other workspace: never, whatever the metric is called', () => {
    process.env.SELF_SYNC_WORKSPACE_ID = 'ws-telarchy';
    expect(isSelfSyncedMetric('ws-lookpilot', 'Telarchy revenue (USD)')).toBe(false);
  });

  test('a self-hosted instance with no self-sync: never', () => {
    delete process.env.SELF_SYNC_WORKSPACE_ID;
    expect(isSelfSyncedMetric('ws-telarchy', 'Telarchy revenue (USD)')).toBe(false);
  });
});
