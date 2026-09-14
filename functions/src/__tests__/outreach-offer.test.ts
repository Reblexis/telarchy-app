/**
 * The owner offer in a first message (docs/outreach-workbench.md, "Drafting";
 * docs/vision.md, "The first owners buy a pilot"): the offer is a paid pilot,
 * so a first message never calls it free and never names the price, which
 * belongs to the answer to a yes; it says the number stays private and that
 * he sets it up himself.
 */

import { DRAFT_RULES } from '../services/outreach';

describe('a first message sells a paid pilot without naming its price', () => {
  test('a first message never calls the offer free', () => {
    expect(DRAFT_RULES).not.toMatch(/say it is free/i);
    expect(DRAFT_RULES).toMatch(/never call it free/i);
  });

  test('a first message never names a price: the price belongs to the answer to a yes', () => {
    expect(DRAFT_RULES).toMatch(/never name a price/i);
    expect(DRAFT_RULES).toMatch(/answer to a yes/i);
  });

  test('a first message says the number stays private, with no Stripe keys', () => {
    expect(DRAFT_RULES).toMatch(/number stays private/i);
    expect(DRAFT_RULES).toMatch(/no Stripe keys/i);
  });

  test('a first message says he sets it up himself', () => {
    expect(DRAFT_RULES).toMatch(/sets it up himself/i);
  });
});
