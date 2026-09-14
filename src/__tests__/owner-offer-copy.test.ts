/**
 * /owners and the paid pilot (docs/audience-pages.md, /owners; docs/vision.md,
 * "The first owners buy a pilot"): the catch line does not lead with free, and
 * the cost answer says creating a workspace is free while a floor set up for
 * you is a paid pilot.
 */

import { describe, expect, test } from 'vitest';
import { AUDIENCE_PAGES } from '../content/audiencePages.generated';

const owners = AUDIENCE_PAGES.find(p => p.route === '/owners');

describe('/owners sells the pilot, not a free service', () => {
  test('the catch line never leads with free', () => {
    const catches = (owners?.blocks ?? []).filter(b => b.kind === 'catch');
    expect(catches.length).toBe(1);
    for (const c of catches) expect((c as { text: string }).text).not.toMatch(/\bfree\b/i);
  });

  test('the cost answer names the paid pilot and keeps self-serve creation free', () => {
    const faq = (owners?.blocks ?? []).find(b => b.kind === 'faq') as { items: { q: string; a: string }[] } | undefined;
    const cost = faq?.items.find(i => /cost/i.test(i.q));
    expect(cost?.a).toMatch(/paid four-week pilot/i);
    expect(cost?.a).toMatch(/creating a workspace is free/i);
    expect(cost?.a).not.toMatch(/free today/i);
  });
});
