import { useEffect, useRef } from 'react';

/**
 * One axis of the floor's grid as a strip of tabs (docs/ui-conventions.md,
 * "The question line: the pickers, and the sentence", revised 2026-09-09).
 *
 * Only the DATE strip carries a call (owner ask 2026-09-09): a metric on
 * its own is not a market, so a number under a metric's name is really the
 * value for whichever date happens to be selected. With a proposal open the
 * metric tabs do carry one, because then each is a pair the proposal prices.
 *
 * A tab with no price prints a dash, never a borrowed number: an unfunded
 * book is one nobody has priced, and inventing a value for it is worse than
 * admitting there is none. A tab with nothing staked on it says so and is
 * dead: there is nothing to trade there on arrival.
 */
export interface StripTab {
  id: string;
  label: string;
  /** The call, already formatted with its own unit. `null` prints the dash
   *  (a book nobody has priced); `undefined` means this strip carries no
   *  call at all, which is the metric strip outside a proposal. */
  value?: string | null;
  selected: boolean;
  /** A cell with nothing staked on it: there is no forecast to show and
   *  nothing to trade on arrival, so the tab is dead (owner ask
   *  2026-09-09). */
  disabled?: boolean;
  title?: string;
}

export function FloorStrip({
  ariaLabel,
  kind,
  tabs,
  onPick,
  manage,
}: {
  ariaLabel: string;
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

  // A picker with one option is not rendered, for anyone (docs/
  // ui-conventions.md, "The question line", 2026-09-11). The owner's way
  // into the dialog is the owner row the floor draws under the strips.
  if (tabs.length < 2) return null;

  return (
    <div className={`pubws-strip pubws-strip--${kind}`} role="tablist" aria-label={ariaLabel} ref={ref}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={t.selected}
          aria-disabled={t.disabled || undefined}
          title={t.title}
          className={`pubws-strip-tab${t.selected ? ' is-selected' : ''}${t.disabled ? ' is-dead' : ''}`}
          onClick={() => {
            if (t.disabled) return;
            onPick(t.id);
          }}
        >
          <span className="pubws-strip-name">{t.label}</span>
          {t.value !== undefined && <span className="pubws-strip-val">{t.value ?? '-'}</span>}
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
