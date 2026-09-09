import type { FloorEvent } from '../lib/api';

/**
 * What moved it: the marks on the chart, in words.
 *
 * Spec: docs/ui-conventions.md, "The price and the chart". The chart drew a
 * metric's history with nothing to explain it, so a reader had to remember
 * what happened in August or take the jump on faith. The rows are numbered
 * oldest first, the same numbering the marks carry, so a mark and a line
 * name each other without a legend.
 *
 * It carries no figure of its own. What the number did after each event is
 * the line the marks stand on; printing "+3 in the week after" beside the
 * label would be the same fact stated twice, the second time rounded, and a
 * seven-day window nobody chose.
 */

const KIND_WORD: Record<string, string> = {
  announcement: 'announced',
  approved: 'approved',
  declined: 'declined',
  delivered: 'delivered',
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function WhatMovedIt({ events }: { events: FloorEvent[] }) {
  if (!events.length) return null;
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="pubws-moved" aria-label="What moved it">
      <h2 className="pubws-h2">What moved it</h2>
      <ul className="pubws-moved-list">
        {ordered.map((e, i) => (
          <li key={`${e.at}-${e.kind}`} className="pubws-moved-row">
            <span className="pubws-moved-num">{i + 1}</span>
            <span className="pubws-moved-day">{day(e.at)}</span>
            <span className="pubws-moved-what">{e.label}</span>
            <span className="pubws-moved-kind">{KIND_WORD[e.kind] ?? e.kind}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
