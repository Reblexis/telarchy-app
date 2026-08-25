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
        {/* A simplified bug: body, two antennae, three legs a side. The
            earlier glyph packed a centre seam plus eight legs into 20px and
            turned into a blob at real size (reviewed 2026-08-12). */}
        <svg
          className="pubws-report-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 4.5 10.5 7M15 4.5 13.5 7" />
          <rect x="7.5" y="7" width="9" height="12" rx="4.5" />
          <path d="M7.5 10.5H4M7.5 14.5H3.5M7.5 18H4.5M16.5 10.5H20M16.5 14.5H20.5M16.5 18H19.5" />
        </svg>
        <span className="pubws-report-label">Report a bug</span>
      </button>
      <FeedbackModal open={open} defaultKind="bug" onClose={() => setOpen(false)} />
    </>
  );
}
