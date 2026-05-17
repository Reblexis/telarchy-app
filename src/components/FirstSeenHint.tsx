import { useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFirstSeenHint } from '../hooks/useFirstSeenHint';

interface Props {
  hintKey: string;
  target: string;
  title?: string;
  body: ReactNode;
}

interface Pos {
  top: number;
  left: number;
  arrow: 'left' | 'top' | 'right' | 'bottom';
}

function position(rect: DOMRect): Pos {
  const margin = 14;
  const width = 320;
  const height = 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (rect.right + margin + width + 16 < vw) {
    const top = Math.max(16, Math.min(rect.top + rect.height / 2 - 60, vh - height - 16));
    return { top, left: rect.right + margin, arrow: 'left' };
  }
  if (rect.bottom + margin + height + 16 < vh) {
    const left = Math.max(16, Math.min(rect.left, vw - width - 16));
    return { top: rect.bottom + margin, left, arrow: 'top' };
  }
  if (rect.top - margin - height - 16 > 0) {
    const left = Math.max(16, Math.min(rect.left, vw - width - 16));
    return { top: rect.top - margin - height, left, arrow: 'bottom' };
  }
  return { top: 16, left: Math.max(16, vw - width - 16), arrow: 'top' };
}

export function FirstSeenHint({ hintKey, target, title, body }: Props) {
  const { shouldShow, dismiss } = useFirstSeenHint(hintKey);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pollTimer = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!shouldShow) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(target) as HTMLElement | null;
      if (el) {
        setRect(el.getBoundingClientRect());
        el.classList.add('first-seen-target-glow');
        return;
      }
      attempts += 1;
      if (attempts < 40) {
        pollTimer.current = window.setTimeout(tick, 80);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      document.querySelectorAll('.first-seen-target-glow').forEach(el => el.classList.remove('first-seen-target-glow'));
    };
  }, [shouldShow, target]);

  useEffect(() => {
    if (!shouldShow || !rect) return;
    const onMove = () => {
      const el = document.querySelector(target) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [shouldShow, rect, target]);

  if (!shouldShow || !rect) return null;
  const pos = position(rect);

  // Portal to document.body so parent CSS transforms (e.g. on the proposal
  // drawer) do not capture `position: fixed`.
  return createPortal(
    <div
      className={`first-seen-hint first-seen-arrow-${pos.arrow}`}
      role="dialog"
      aria-label={title ?? 'Tip'}
      data-tour-id={`first-seen-${hintKey}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {title && <div className="first-seen-title">{title}</div>}
      <div className="first-seen-body">{body}</div>
      <div className="first-seen-actions">
        <button type="button" className="first-seen-dismiss" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}
