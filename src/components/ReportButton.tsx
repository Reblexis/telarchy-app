import { useState } from 'react';
import { FeedbackModal } from './FeedbackModal';

/**
 * Report-a-bug / feedback door in the floor top bar (owner ask 2026-08-12),
 * sitting beside the Manifold and Discord buttons. Opens the shared feedback
 * modal, which lets the visitor pick bug / help / general feedback. Anonymous
 * submissions are accepted (the backend allows them, rate-limited per IP), so
 * a visitor who hit a bug can report it without making an account first.
 */
export function ReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="pubws-report"
        onClick={() => setOpen(true)}
        aria-label="Report a bug or send feedback"
      >
        <svg className="pubws-report-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* A small bug glyph. */}
          <path d="M8 2l1.5 2.5M16 2l-1.5 2.5" />
          <rect x="7" y="6" width="10" height="12" rx="5" />
          <path d="M12 10v6M3 9h3M3 14h3M18 9h3M18 14h3M4 5l2.5 2M20 5l-2.5 2M4 19l2.5-2M20 19l-2.5-2" />
        </svg>
        <span className="pubws-report-label">Report a bug</span>
      </button>
      <FeedbackModal open={open} defaultKind="bug" onClose={() => setOpen(false)} />
    </>
  );
}
