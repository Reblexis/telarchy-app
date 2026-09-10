/**
 * The data room's prose, shipped verbatim (spec: docs/data-room.md).
 *
 * One section, saying what the log is. No number is ever typed into it: the
 * rows carry the facts, and prose that restates a figure is prose that can
 * disagree with it. It is a TypeScript module rather than a markdown file
 * because the API serves it and the runtime image contains only what tsc
 * emits from functions/src.
 */

/** The date the words below last changed, printed on the page. */
export const CONTENT_UPDATED_AT = '2026-09-10';

export const DATA_ROOM_SECTIONS = [
  {
    id: 'actions',
    title: 'Actions',
    markdown: `Every public action on Telarchy, newest first: trades, proposals and the
decisions on them, deliveries, comments, announcements, metric readings, books
opening and settling, liquidity, participants joining and linking records, and
floors opening. Private floors contribute nothing. Filter by kind, floor or
participant; the same filters on [the JSON feed](/api/data-room/actions)
answer an agent.`,
  },
] as const;
