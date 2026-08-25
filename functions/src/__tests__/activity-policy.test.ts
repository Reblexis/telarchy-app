import { applyMemberPolicy, MEMBER_HIDDEN_TYPES, MEMBER_VISIBLE_TYPES } from '../routes/activity';
import type { ActivityItem } from '../services/activity';

function item(type: ActivityItem['type'], extras: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: `${type}-1`,
    type,
    timestamp: new Date().toISOString(),
    actor: { id: 'a1', label: 'Alice' },
    data: {},
    ...extras,
  };
}

describe('activity member policy', () => {
  it('hides deposit and withdrawal entries from non-admin members', () => {
    const feed: ActivityItem[] = [
      item('trade'),
      item('deposit'),
      item('withdrawal'),
      item('proposal_created'),
      item('market_resolved'),
    ];
    const filtered = applyMemberPolicy(feed);
    const types = filtered.map(f => f.type);
    expect(types).not.toContain('deposit');
    expect(types).not.toContain('withdrawal');
    expect(types).toEqual(expect.arrayContaining(['trade', 'proposal_created', 'market_resolved']));
  });

  it('anonymizes the actor on trade entries but keeps actors on other entries', () => {
    const feed: ActivityItem[] = [item('trade'), item('proposal_created'), item('metric_update')];
    const filtered = applyMemberPolicy(feed);
    const trade = filtered.find(f => f.type === 'trade')!;
    const proposal = filtered.find(f => f.type === 'proposal_created')!;
    const metric = filtered.find(f => f.type === 'metric_update')!;
    expect(trade.actor).toBeNull();
    expect(proposal.actor).toEqual({ id: 'a1', label: 'Alice' });
    expect(metric.actor).toEqual({ id: 'a1', label: 'Alice' });
  });

  it('agrees with MEMBER_VISIBLE_TYPES (no hidden type accidentally appears)', () => {
    expect(MEMBER_HIDDEN_TYPES.has('deposit')).toBe(true);
    expect(MEMBER_HIDDEN_TYPES.has('withdrawal')).toBe(true);
    for (const t of MEMBER_VISIBLE_TYPES) {
      expect(MEMBER_HIDDEN_TYPES.has(t)).toBe(false);
    }
  });
});
