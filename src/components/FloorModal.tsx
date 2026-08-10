import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * The floor's one modal (owner direction 2026-08-10, after Manifold):
 * focused actions (composing a bet, suggesting a job) happen in a dialog
 * over the page instead of a form squeezed into a rail or under a chart.
 * Backdrop click and Escape both close; the card fades and lifts in, and
 * reduced motion snaps. Rendered in a portal so a rail's stacking context
 * cannot clip it.
 */
export function FloorModal({ onClose, label, children }: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // The page behind a dialog does not scroll.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="floor-modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="floor-modal" role="dialog" aria-modal="true" aria-label={label} ref={cardRef}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
