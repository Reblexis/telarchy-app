import type { ReactNode } from 'react';
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
  corner,
  center,
  onPickProposal,
  onStep,
}: {
  kind: string;
  slug: string;
  corner?: ReactNode;
  center?: ReactNode;
  /** A chevron was clicked: the page selects that proposal (docs/ui-conventions.md, "The feed drives the floor"). */
  onPickProposal?: (number: number) => void;
  /** The feed's step changed or its decision landed: the page reloads at once. */
  onStep?: (s: { step: number; decided: boolean }) => void;
}) {
  return (
    <div className="mchart mchart--live">
      <div className="mchart-ranges" role="group" aria-label="Live view">
        <span className="mchart-left">{corner && <span className="mchart-corner">{corner}</span>}</span>
        <span className="mchart-center">{center}</span>
        <span className="mchart-right" />
      </div>
      {kind === 'snake' ? <SnakeLive slug={slug} onPickProposal={onPickProposal} onStep={onStep} /> : null}
    </div>
  );
}
