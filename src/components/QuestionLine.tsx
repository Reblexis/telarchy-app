import { useEffect, useRef, useState } from 'react';
import {
  captionLabel,
  cellOf,
  dateQuestionOf,
  dateSegmentOf,
  datesOf,
  type HorizonView,
  metricsOf,
  possessiveOf,
  settleInstant,
} from '../lib/floor-horizons';

/**
 * The question line (docs/ui-conventions.md, "The question line: the
 * pickers, and the sentence"): one sentence in the display face, "What
 * will be {company}'s {metric} {date}?", whose metric and date words ARE
 * the pickers. Each word with more than one option is a button opening a
 * listbox; with one option it is plain text. With a proposal selected the
 * same sentence carries the condition in the question's own voice.
 *
 * The heading is a block child of `.pubws-center`; the controls live INSIDE
 * it, never in a wrapper around it.
 */

interface WordOption {
  key: string;
  /** The word as the sentence reads it: "this month". */
  label: string;
  /** The same option as the MENU names it, by clock and settle day
   *  ("this month · 30 Sep"); the sentence never carries the settle day,
   *  because a date printed beside a name that carries its own horizon
   *  reads a day late. Falls back to the word. */
  menuLabel?: string;
  title?: string;
}

/** A word of the sentence that picks: a button with a listbox, or plain text. */
export function AskWord({
  what,
  options,
  activeKey,
  onPick,
}: {
  what: 'Metric' | 'Date';
  options: WordOption[];
  activeKey: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const active = options.find(o => o.key === activeKey) ?? options[0];
  if (!active) return null;
  if (options.length < 2) {
    return (
      <span className="pubws-ask-word" title={active.title}>
        {active.label}
      </span>
    );
  }
  return (
    <span className="pubws-ask-wrap" ref={wrapRef}>
      <button
        type="button"
        className="pubws-ask-word pubws-ask-word--live"
        title={active.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${what}: ${active.label}`}
        onClick={() => setOpen(o => !o)}
      >
        {active.label}
      </button>
      {open && (
        <ul className="pubws-chip-menu" role="listbox" aria-label={what}>
          {options.map(o => (
            <li key={o.key} role="none">
              <button
                type="button"
                role="option"
                aria-selected={o.key === activeKey}
                className={`pubws-chip-opt${o.key === activeKey ? ' is-selected' : ''}`}
                title={o.title}
                onClick={() => {
                  onPick(o.key);
                  setOpen(false);
                }}
              >
                {o.menuLabel ?? o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function QuestionLine({
  horizons,
  hero,
  workspaceName,
  onSelect,
  condition,
  flashed = false,
}: {
  horizons: HorizonView[];
  hero: HorizonView;
  workspaceName: string | null;
  onSelect: (marketId: string) => void;
  /** With a proposal selected: who is paid, and how much. */
  condition?: { who: string; ask: number } | null;
  flashed?: boolean;
}) {
  const metricHeads = metricsOf(horizons);
  const dates = [...datesOf(horizons, hero.metricId)].reverse();
  const q = dateQuestionOf(hero);
  const company = workspaceName ? `${possessiveOf(workspaceName)} ` : '';
  const lead = condition
    ? condition.ask > 0
      ? `If ${condition.who} is paid $${condition.ask.toLocaleString('en-US')} to do this, what will `
      : `If ${condition.who} does this, what will `
    : 'What will be ';
  return (
    <h2
      className={`pubws-instrument-ask${condition ? ' pubws-instrument-ask--cond' : ''}${flashed ? ' is-flashed' : ''}`}
    >
      {lead}
      {company}
      <AskWord
        what="Metric"
        options={metricHeads.map(m => ({ key: m.metricId, label: captionLabel(m.metricLabel, workspaceName) }))}
        activeKey={hero.metricId}
        onPick={metricId => {
          const cell = cellOf(horizons, metricId, hero.targetDate);
          if (cell) onSelect(cell.marketId);
        }}
      />{' '}
      <span className="pubws-ask-tail">
        {q.on ? 'on ' : ''}
        <AskWord
          what="Date"
          options={dates.map(d => ({
            key: d.marketId,
            label: dateQuestionOf(d).word,
            menuLabel: dateSegmentOf(d),
            title: d.resolvesOn ? `settles ${settleInstant(d.resolvesOn)}` : undefined,
          }))}
          activeKey={hero.marketId}
          onPick={onSelect}
        />
        {condition ? ' be?' : '?'}
      </span>
    </h2>
  );
}
