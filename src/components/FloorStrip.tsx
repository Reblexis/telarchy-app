import { useEffect, useRef } from 'react';

/**
 * One axis of the floor's grid as a strip of tabs (docs/ui-conventions.md,
 * "The question line: the pickers, and the sentence", revised 2026-09-09).
 *
 * Each tab is its name over the market's current call, so the top of the
 * floor is the scoreboard of everything the floor prices, read without
 * pressing anything. The dropdown chips this replaced hid both how many
 * books a floor had and what any of them said.
 *
 * A tab with no price prints a dash, never a borrowed number: an unfunded
 * book is one nobody has priced, and inventing a value for it is worse than
 * admitting there is none.
 */
export interface StripTab {
  id: string;
  label: string;
  /** The call, already formatted with its own unit; null when there is none. */
  value: string | null;
  selected: boolean;
  /** A word under the value: "untraded" on a funded pair nobody has priced,
   *  so a zero anchor is never passed off as an opinion. */
  note?: string;
  title?: string;
}

export function FloorStrip({
  ariaLabel,
  kind,
  label,
  tabs,
  onPick,
  manage,
}: {
  ariaLabel: string;
  /** What the strip's values are, when they are not levels: "moves" and "by"
   *  with a proposal open. */
  label?: string;
  /** 'metric' | 'date', for the class the stylesheet keys on. */
  kind: 'metric' | 'date';
  tabs: StripTab[];
  onPick: (id: string) => void;
  /** The owner's way into the dialog this axis is managed from. */
  manage?: { label: string; open: () => void } | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const selectedId = tabs.find(t => t.selected)?.id ?? null;
  // The strips scroll sideways on a phone; whichever tab is selected is
  // scrolled into view, so a reader never has to hunt for where they are.
  useEffect(() => {
    if (!selectedId || !ref.current) return;
    const el = ref.current.querySelector(`[data-tab="${CSS?.escape ? CSS.escape(selectedId) : selectedId}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      try {
        (el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'center' });
      } catch {
        // jsdom, and any browser without the options form: not worth a branch.
      }
    }
  }, [selectedId]);

  // A strip of one is a label. The owner keeps it, because the last tab is
  // their way into the dialog.
  if (tabs.length < 2 && !manage) return null;

  return (
    <div className={`pubws-strip pubws-strip--${kind}`} role="tablist" aria-label={ariaLabel} ref={ref}>
      {label && (
        <span className="pubws-strip-label" aria-hidden="true">
          {label}
        </span>
      )}
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={t.selected}
          title={t.title}
          className={`pubws-strip-tab${t.selected ? ' is-selected' : ''}`}
          onClick={() => onPick(t.id)}
        >
          <span className="pubws-strip-name">{t.label}</span>
          <span className="pubws-strip-val">{t.value ?? '-'}</span>
          {t.note && <span className="pubws-strip-note">{t.note}</span>}
        </button>
      ))}
      {manage && (
        <button type="button" className="pubws-strip-tab pubws-strip-tab--manage" onClick={manage.open}>
          <span className="pubws-strip-name">{manage.label}</span>
        </button>
      )}
    </div>
  );
}
