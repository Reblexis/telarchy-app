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
  total,
  canManage,
}: {
  /** What the public read route is addressed by (slug or id), the same thing
   *  the floor was loaded with. */
  idOrSlug: string;
  /** The newest announcement, shipped inline on the workspace payload. */
  latest: Announcement | null | undefined;
  /** How many exist in total, so the line can say what is behind it. */
  total: number;
  canManage: boolean;
}) {
  // Nothing published and nothing the visitor could do about it: render no
  // section at all rather than an empty heading on every floor.
  if (!latest && !canManage) return null;

  const href = `/${encodeURIComponent(idOrSlug)}/announcements`;

  return (
    <section className="pubws-know pubws-enter pubws-enter--3" aria-label="Announcements">
      <div className="pubws-know-headrow">
        <h2 className="pubws-know-head">Announcements</h2>
        {/* The count is the offer, so it sits where a count belongs and not in
            a second link underneath the line. */}
        {total > 1 && (
          <Link className="pubws-know-edit" to={href}>
            All {total}
          </Link>
        )}
      </div>

      {latest ? (
        <Link className="pubws-annline" to={href}>
          <span className="pubws-annline-head">{announcementHeadline(latest.body)}</span>
          <time className="pubws-annline-when" dateTime={latest.publishedAt}>
            {fmtDay(latest.publishedAt)}
            {latest.publishedBy ? ` \u00b7 ${latest.publishedBy}` : ''}
          </time>
          <span className="pubws-annline-go" aria-hidden="true">
            →
          </span>
        </Link>
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
