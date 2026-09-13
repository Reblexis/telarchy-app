import type { ReactNode } from 'react';
import type { FloorPriceBook, SnakeState } from '../../lib/api';
import type { FeedQuotes } from '../../lib/feed-overlay';
import { ChessLive } from './ChessLive';
import { SnakeLive } from './SnakeLive';

/**
 * The LIVE segment of the chart slot (docs/ui-conventions.md, "The live view
 * is a segment of the chart slot"): the owner's feed drawn natively, in the
 * one chart's slot, under the same control row (the segment toggle in the
 * left cell, the metric caption centred). Picks the component by the feed's
 * `kind`; a kind this build cannot draw renders the row and nothing under
 * it, so an older client on a newer feed degrades to a quiet slot rather
 * than a broken one.
 */
export function LiveView({
  kind,
  slug,
  onState,
  corner,
  center,
  onPickProposal,
  onStep,
  onQuotes,
  books,
}: {
  kind: string;
  /** The floor's open books by market id, polled once a second, for the live prices. */
  books?: ReadonlyMap<string, FloorPriceBook> | null;
  slug: string;
  /** Every polled state, reported up so the floor can name the attempt. */
  onState?: (state: SnakeState) => void;
  corner?: ReactNode;
  center?: ReactNode;
  /** A chevron was clicked: the page selects that proposal (docs/ui-conventions.md, "The feed drives the floor"). */
  onPickProposal?: (number: number, option?: string) => void;
  /** The feed's step changed or its decision landed: the page reloads at once. */
  onStep?: (s: { step: number; decided: boolean }) => void;
  /** Every feed read: the open step's quotes by proposal id, for the floor's prices. */
  onQuotes?: (quotes: FeedQuotes) => void;
}) {
  return (
    <div className="mchart mchart--live">
      <div className="mchart-ranges" role="group" aria-label="Live view">
        <span className="mchart-left">{corner && <span className="mchart-corner">{corner}</span>}</span>
        <span className="mchart-center">{center}</span>
        <span className="mchart-right" />
      </div>
      {kind === 'snake' ? (
        <SnakeLive
          slug={slug}
          onPickProposal={onPickProposal}
          onStep={onStep}
          onQuotes={onQuotes}
          onState={onState}
          books={books}
        />
      ) : kind === 'chess' ? (
        <ChessLive slug={slug} onPickProposal={onPickProposal} onStep={onStep} onQuotes={onQuotes} books={books} />
      ) : null}
    </div>
  );
}
