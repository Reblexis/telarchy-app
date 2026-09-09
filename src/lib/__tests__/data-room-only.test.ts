import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('DATA ROOM WORK DOES NOT ADD CONTROLS OR EVENT MARKS TO FLOORS', () => {
  const page = readFileSync('src/pages/TradePage.tsx', 'utf8');
  for (const name of ['WhatMovedIt', 'setOwnerCall', 'setProposalDelivery', 'heroEvents'])
    expect(page).not.toContain(name);
  expect(readFileSync('src/components/NumberChart.tsx', 'utf8')).not.toContain('numchart-event');
});
