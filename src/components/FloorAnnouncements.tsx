import { Link } from 'react-router-dom';
import { announcementHeadline } from '../lib/announcement-headline';
import type { Announcement } from '../lib/api';

/**
 * The owner's announcements, as one line on the floor.
 *
 * A charter that promises "if something material happens that the market
 * cannot see, I announce it" needs somewhere for the announcement to land,
 * and comments (which hang off one market or one proposal) are not it. That
 * surface is `<floor>/announcements`; this is the pointer to it.
 *
 * It used to be the surface itself: the latest announcement printed in full
 * on the floor, with the rest behind an expander. Owner direction 2026-08-20,
 * "just show the headline on the main page, and only if clicked then go to
 * the announcements page": a 150-word disclosure sitting between the market's
 * definition and the company blurb pushes the market itself off the screen,
 * and the floor's job is the market.
 *
 * What survives the move is the promise. The line is the newest announcement
 * and says when it landed, so a trader arriving mid-market can see at a glance
 * whether anything has been said since they last looked, which is the whole
 * function this section had.
 */

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function FloorAnnouncements({
  idOrSlug,
  latest,
  entries,
  total,
  canManage,
}: {
  /** What the public read route is addressed by (slug or id), the same thing
   *  the floor was loaded with. */
  idOrSlug: string;
  /** The newest announcement, shipped inline on the workspace payload. */
  latest: Announcement | null | undefined;
  /** The entries to print, newest first, when the caller has more than the
   *  one the payload ships inline. The block draws at most two
   *  (docs/ui-conventions.md, "The rails"); `latest` is the fallback, and
   *  is what the marketplace payload carries today. */
  entries?: Announcement[];
  /** How many exist in total, so the corner control can say what is behind
   *  it. */
  total: number;
  canManage: boolean;
}) {
  const rows = (entries ?? (latest ? [latest] : [])).slice(0, 2);
  // Nothing published and nothing the visitor could do about it: render no
  // section at all rather than an empty heading on every floor.
  if (rows.length === 0 && !canManage) return null;

  const href = `/${encodeURIComponent(idOrSlug)}/announcements`;

  return (
    <section className="pubws-announcements pubws-enter pubws-enter--3" aria-label="Announcements">
      {/* The block anatomy every rail shares (docs/ui-conventions.md, "The
          blocks share one anatomy"): the tiny uppercase label on the left,
          the corner control on the right, a hairline underneath. */}
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">Announcements</h2>
        {/* The count is the offer, so it sits where a count belongs and not in
            a second link underneath the line. A count that always reads
            "All 1" is furniture. */}
        {total > 1 && (
          <Link className="pubws-lb-meta pubws-ann-all" to={href}>
            All {total}
          </Link>
        )}
      </div>

      {rows.length > 0 ? (
        rows.map(a => (
          <Link className="pubws-annline" key={a.id} to={href}>
            <span className="pubws-annline-head">{announcementHeadline(a.body)}</span>
            <time className="pubws-annline-when" dateTime={a.publishedAt}>
              {fmtDay(a.publishedAt)}
              {a.publishedBy ? ` \u00b7 ${a.publishedBy}` : ''}
            </time>
            <span className="pubws-annline-go" aria-hidden="true">
              →
            </span>
          </Link>
        ))
      ) : (
        <p className="pubws-ann-empty">
          Nothing announced yet.{' '}
          <Link className="pubws-ann-link" to={href}>
            Write one
          </Link>
        </p>
      )}
    </section>
  );
}
