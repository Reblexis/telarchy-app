import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  countdownOf,
  firstSentenceOf,
  forecastDayOf,
  type HorizonView,
  settleInstant,
  syncedAgeLine,
  timeAgoOf,
  todayDeltaOf,
  unitWordsOf,
} from '../lib/floor-horizons';
import { edgeLabel } from '../lib/market-quote';
import { AnimatedNumber } from './AnimatedNumber';

/**
 * The numbers band and the settlement line (docs/ui-conventions.md, "The
 * numbers band and the settlement line"): two cells on hairlines under the
 * question, the market's call FIRST because it is the thing traded and the
 * reading is its evidence, then one tertiary line saying what the market
 * settles on with "Full definition" pinned outside the clamp.
 */

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];
const MARKDOWN_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

function formatValue(v: number): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The reading in force, as the reading cell prints it: a count of people
 *  or things (no currency, a whole reading) prints whole, "9" never "9.00";
 *  decimals are for forecasts and money. */
function formatReading(v: number, unit: string): string {
  if (unit === '' && Number.isInteger(v)) return v.toLocaleString('en-US');
  return `${unit}${formatValue(v)}`;
}

/** Today's move at the price's own precision: "+0.3", never "+0.30". */
function formatDelta(d: number, consensus: number): string {
  const abs = Math.abs(consensus);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(decimals)}`;
}

export function NumbersBand({
  hero,
  consensus,
  unit,
  workspaceName,
  now,
  priceSeries,
  nowReading,
  lastReadingAt,
  readingIsStale,
  canReport,
  onReport,
  canInject,
  onInject,
}: {
  hero: HorizonView;
  /** The call on the market ON SCREEN (a branch's, on a proposal). */
  consensus: number | null;
  unit: string;
  workspaceName: string | null;
  now: Date;
  /** The call's own history, for today's move. */
  priceSeries: Array<{ at: string; consensus: number | null }>;
  nowReading: number | null;
  lastReadingAt: string | null;
  readingIsStale: boolean;
  canReport: boolean;
  onReport: () => void;
  canInject: boolean;
  onInject: () => void;
}) {
  const forecastDay = forecastDayOf(hero.resolvesOn);
  const countdown = countdownOf(hero, now);
  const delta = todayDeltaOf(priceSeries, consensus, now);
  const unitWords = unitWordsOf(hero.metricLabel, unit, workspaceName);
  const age = lastReadingAt
    ? hero.platformSynced
      ? syncedAgeLine(lastReadingAt, now)
      : `read ${timeAgoOf(lastReadingAt, now) ?? ''}`
    : null;
  return (
    <div className="pubws-numbers" role="group" aria-label="The numbers">
      {/* The market's call, amber and first: the day it is for, the
        countdown by the minute with the exact instant as its hover, the
        value with the metric's own unit after it, and today's move. */}
      <div className="pubws-stat-block pubws-stat--call">
        <span className="pubws-stat-what">
          market's call
          {(forecastDay || countdown) && (
            <>
              <span className="pubws-stat-dot" aria-hidden="true">
                {' · '}
              </span>
              <span
                className="pubws-settle-in"
                title={hero.resolvesOn ? `settles ${settleInstant(hero.resolvesOn)}` : undefined}
              >
                {forecastDay ? `for ${forecastDay}` : ''}
                {forecastDay && countdown ? ' · ' : ''}
                {countdown ?? ''}
              </span>
            </>
          )}
        </span>
        {consensus === null ? (
          <span className="pubws-stat-value">
            <span className="pubws-price">no price yet</span>
            {canInject && (
              <button type="button" className="pubws-stat-report" onClick={onInject}>
                Inject liquidity
              </button>
            )}
          </span>
        ) : (
          <span className="pubws-stat-value">
            <span className="pubws-price">
              <AnimatedNumber value={consensus} render={v => `${unit}${formatValue(v)}`} />
            </span>
            {unitWords && <span className="pubws-stat-unit">{unitWords}</span>}
            {delta !== null && (
              <span className={`pubws-stat-delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
                {delta > 0 ? '▲' : '▼'} {formatDelta(delta, consensus)} today
              </span>
            )}
          </span>
        )}
      </div>
      {/* The reading, ink: the value in force with its age, because a
        reading is only trustworthy with its age on it. For the owner of an
        owner-reported book this cell is also the reporting cell. */}
      <div className="pubws-stat-block pubws-stat--now">
        <span className="pubws-stat-cap">
          <span className="pubws-stat-what">
            now
            {age && (
              <>
                <span className="pubws-stat-dot" aria-hidden="true">
                  {' · '}
                </span>
                <span
                  className={`pubws-updated${readingIsStale ? ' is-stale' : ''}`}
                  title={`${new Date(lastReadingAt as string).toUTCString()}${
                    readingIsStale ? ' (taken before the period this market settles for)' : ''
                  }`}
                >
                  {age}
                </span>
              </>
            )}
          </span>
          {hero.platformSynced
            ? !lastReadingAt && <span className="pubws-stat-sync">synced hourly</span>
            : canReport && (
                <button type="button" className="pubws-stat-report" onClick={onReport}>
                  Report
                </button>
              )}
        </span>
        <span className="pubws-price">{nowReading !== null ? formatReading(nowReading, unit) : 'no reading yet'}</span>
      </div>
    </div>
  );
}

/**
 * The settlement line: "Settles on:" then the metric's summary, clamped to
 * one line, with "Full definition" (and the owner's "Edit") pinned OUTSIDE
 * the clamp so the clamp can never swallow the control. Pressing it expands
 * the definition in place: the markdown the market settles on, the range,
 * the settle instant and "unchanged since" for a synced metric.
 */
export function SettlementLine({
  hero,
  unit,
  description,
  now,
  lastReadingAt,
  expanded,
  onToggle,
  canManage,
  onEdit,
}: {
  hero: HorizonView;
  unit: string;
  /** The metric's definition, verbatim: it IS the settlement text. */
  description: string | null;
  now: Date;
  lastReadingAt: string | null;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  onEdit: () => void;
}) {
  const summary = hero.settlementSummary?.trim() || firstSentenceOf(description);
  if (!summary) return null;
  return (
    <>
      <p className="pubws-instrument-sum">
        <span className="pubws-instrument-sum-text">Settles on: {summary}</span>
        <span className="pubws-instrument-sum-acts">
          {description && (
            <button type="button" className="pubws-instrument-more-go" onClick={onToggle}>
              {expanded ? 'Hide definition' : 'Full definition'}
            </button>
          )}
          {canManage && (
            <button type="button" className="pubws-instrument-edit" onClick={onEdit}>
              Edit
            </button>
          )}
        </span>
      </p>
      {expanded && description && (
        <div className="pubws-instrument-more" aria-label="What this market settles on">
          <div className="pubws-know-what">
            <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {description}
            </ReactMarkdown>
          </div>
          <p className="pubws-instrument-facts">
            Range {edgeLabel(unit, hero.rangeMin)} to {edgeLabel(unit, hero.rangeMax)}
            {hero.resolvesOn ? ` · Settles ${settleInstant(hero.resolvesOn)}` : ''}
            {hero.platformSynced && lastReadingAt ? ` · ${syncedAgeLine(lastReadingAt, now) ?? ''}` : ''}
          </p>
        </div>
      )}
    </>
  );
}
