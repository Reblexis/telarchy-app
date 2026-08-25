import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The floor's one modal (owner direction 2026-08-10, after Manifold):
 * focused actions (composing a bet, suggesting a job, the account) happen in
 * a dialog over the page instead of a form squeezed into a rail or under a
 * chart. Backdrop click and Escape both close; the card fades and lifts in,
 * and reduced motion snaps. Rendered in a portal so a rail's stacking context
 * cannot clip it.
 *
 * The card says when it has more below it (owner report 2026-08-19: "I didn't
 * even notice it's scrollable"). A dialog that scrolls with no edge treatment
 * looks finished at the fold, so the content is masked into a fade and a
 * chevron sits under it; both vanish at the end of the scroll. The cue lives
 * on a wrapper rather than on the scroller, because a decoration inside a
 * scrolling box scrolls away with the content it is describing.
 */
export function FloorModal({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    // 8px of slack: a sub-pixel rounding difference is not "more content".
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = cardRef.current;
    if (!el) return;
    // Both observers are feature-detected: the cue is an affordance, not a
    // feature, so an environment without them (jsdom, an old browser) must
    // render the dialog rather than throw on the way in.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    // Switching a tab or opening a section changes the height without any
    // scroll or resize event, so watch the subtree too.
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
    mutations?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`floor-modal-shell${more ? ' has-more' : ''}`}>
        <div
          className="floor-modal"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          ref={cardRef}
          onScroll={measure}
        >
          {children}
        </div>
        <div className="floor-modal-cue" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        </div>
      </div>
    </div>,
    document.body,
  );
}
