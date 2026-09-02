import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EarnTableEditor } from '../components/EarnTableEditor';
import { useAuth } from '../hooks/useAuth';
import { api, type FeedbackItem, type Journey, type JourneyFeed } from '../lib/api';
import { TopBar } from './TradePage';

/**
 * telarchy.com/admin: the owner's own page (owner ask 2026-08-19, after the
 * console that used to carry it was deleted). Who showed up, where they came
 * from, who signed up, who is waiting, and what people reported.
 *
 * Written in the floor's language (`.pubws` + `.adm-*`), not restored from
 * the 2026-08-11 cockpit: that page was inline styles over the console's
 * `.container` and shares no code with this one. See docs/ui-conventions.md,
 * "The cockpit".
 *
 * The endpoints it reads are platform-admin gated server-side
 * (`isPlatformAuthorized`), so this component is a renderer and never the
 * guard. Anyone who is not a platform admin lands on the floor exactly the
 * way an unrecognised URL does, so /admin does not announce that it exists.
 */

interface FloorStats {
  visits24h: number;
  uniques24h: number;
  botVisits: number;
  visitsByDay: Array<{ day: string; visits: number; uniques: number }>;
  topReferers: Array<{ source: string; visits: number }>;
  topPaths: Array<{ path: string; visits: number }>;
  topCountries: Array<{ country: string; visits: number; uniques: number }>;
  recentVisitors: Array<{
    ip: string;
    country: string;
    visits: number;
    lastSeen: string;
    kind: 'person' | 'server' | 'proxy' | 'unknown';
    org: string;
  }>;
  visitorSummary: { people: number; servers: number; proxies: number };
  signupsByDay: Array<{ day: string; signups: number }>;
  recentSignups: Array<{ email: string; name: string; createdAt: string }>;
  totalUsers: number;
  /** Every signup, newest first. `source` is the door they came through:
   *  'marketplace' for the listing tile, a workspace slug for that floor's
   *  own email box, null for rows written before it was recorded. */
  waitlist: Array<{ email: string; createdAt: string; source: string | null }>;
}

/** ISO alpha-2 -> "flag + English name"; '??' is the backend's unknown bucket. */
function countryLabel(code: string): string {
  if (!code || code === '??') return 'unknown';
  const flag = code.toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
  let name = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    /* older runtime */
  }
  return `${flag} ${name}`;
}

/** "Aug 19", so a fortnight of days reads as dates rather than as a column
 *  of near-identical ISO strings. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function n(v: number): string {
  return v.toLocaleString('en-US');
}

/** A number and what it counts. The page's only large type besides the
 *  headline, because the glance is the reason to open it. */
function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="adm-fig">
      <span className="adm-fig-n">{typeof value === 'number' ? n(value) : value}</span>
      <span className="adm-fig-l">{label}</span>
    </div>
  );
}

/**
 * One hairline list. `bar` scales an amber rule behind the count to the
 * largest row, which answers "was today busy" without a chart.
 */
function Rows({
  title,
  note,
  rows,
  empty,
  bar = false,
}: {
  title: string;
  note?: string;
  rows: Array<{ key: string; left: React.ReactNode; right?: React.ReactNode; value: number | string }>;
  empty: string;
  bar?: boolean;
}) {
  const max = bar ? Math.max(1, ...rows.map(r => (typeof r.value === 'number' ? r.value : 0))) : 1;
  return (
    <section className="adm-block">
      <h2 className="pubws-h2">{title}</h2>
      {note && <p className="adm-note">{note}</p>}
      {rows.length === 0 ? (
        <p className="adm-empty">{empty}</p>
      ) : (
        <ul className="adm-list">
          {rows.map(r => (
            <li key={r.key} className="adm-row">
              {bar && typeof r.value === 'number' && (
                <span className="adm-bar" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden="true" />
              )}
              <span className="adm-left">{r.left}</span>
              {r.right && <span className="adm-right">{r.right}</span>}
              <span className="adm-value">{typeof r.value === 'number' ? n(r.value) : r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "3m 20s", "45s", "0s": short enough to sit at the end of a row. */
function shortDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Just the domain, so one channel reads as one word. */
function refererLabel(referer: string | null): string {
  if (!referer) return 'direct';
  const host = referer.match(/:\/\/([^/]+)/)?.[1] ?? referer;
  return host.replace(/^www\./, '');
}

/**
 * What one visitor did, in order (docs/ui-conventions.md, "Journeys").
 *
 * The one block on this page that is a sequence rather than a count, because
 * the counts cannot say where somebody stopped. Each row reads left to right
 * the way the visit happened, with the time spent on each page between the
 * arrows, so a page somebody left after four seconds is visible at a glance.
 */
function Journeys({ feed }: { feed: JourneyFeed | null }) {
  if (!feed) return null;
  const { summary } = feed;
  return (
    <section className="adm-block">
      <h2 className="pubws-h2">Journeys</h2>
      <p className="adm-note">
        {summary.journeys === 0
          ? 'One visitor, one sitting, in the order it happened.'
          : `${n(summary.journeys)} sittings by ${n(summary.visitors)} visitors · ${n(summary.bounced)} bounced ` +
            `(${Math.round((summary.bounced / summary.journeys) * 100)}%) · ${summary.medianSteps} ${summary.medianSteps === 1 ? 'page' : 'pages'} median. ` +
            'A new sitting starts after 30 idle minutes.'}
      </p>
      {feed.journeys.length === 0 ? (
        <p className="adm-empty">No human visits yet.</p>
      ) : (
        <ul className="adm-list">
          {feed.journeys.map((j: Journey) => (
            <li key={j.id} className="adm-row adm-journey">
              <span className="adm-left">
                <span className="adm-journey-path">
                  {j.steps.map((step, i) => (
                    <span key={`${step.ts}-${i}`} className="adm-step">
                      {i > 0 && (
                        <span className="adm-arrow" aria-hidden="true">
                          {'→'}
                        </span>
                      )}
                      <span className="adm-step-path adm-mono">{step.path}</span>
                      {step.secondsOnPage !== null && (
                        <span className="adm-secs">{shortDuration(step.secondsOnPage)}</span>
                      )}
                    </span>
                  ))}
                </span>
                <span className="adm-sub">
                  {refererLabel(j.referer)} · {countryLabel(j.country ?? '??')} ·{' '}
                  {new Date(j.startedAt).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              {/* A bounce is the expected outcome, so only it is worth a
                  word; anything else is read off the chain itself. */}
              {j.bounced && <span className="adm-tag">bounced</span>}
              <span className="adm-value">{shortDuration(j.durationSeconds)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  /** False until the platform-admin check comes back clean. Nothing is
   *  fetched before it does, so a non-admin never even asks for the data on
   *  their way to the floor. */
  const [allowed, setAllowed] = useState(false);
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [reports, setReports] = useState<FeedbackItem[] | null>(null);
  /** What visitors asked the floors, newest first (owner ask 2026-08-20).
   *  The highest-signal list on this page: every row is something the page
   *  failed to say, in the visitor's own words. */
  const [questions, setQuestions] = useState<Awaited<ReturnType<typeof api.getFloorQuestions>> | null>(null);
  /** What visitors did, in order (owner ask 2026-09-01). The counts above
   *  say somebody showed up; this says where they stopped. */
  const [journeys, setJourneys] = useState<JourneyFeed | null>(null);
  const [error, setError] = useState('');
  const [payQ, setPayQ] = useState('');
  const [payRows, setPayRows] = useState<Awaited<ReturnType<typeof api.findParticipants>>['participants'] | null>(null);
  const [payErr, setPayErr] = useState('');

  // The gate, and the whole of it on this side: ask the server who the
  // caller is, and send anyone else to the floor. Not an error screen -
  // a stranger must not be able to tell /admin from a URL that does not
  // exist (docs/ui-conventions.md, "The cockpit").
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    api
      .getProfile()
      .then((p: { platformAdmin?: boolean }) => {
        if (cancelled) return;
        if (p.platformAdmin !== true) navigate('/', { replace: true });
        else setAllowed(true);
      })
      .catch(() => {
        if (!cancelled) navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const load = () => {
      api
        .getFloorStats()
        .then(s => {
          if (!cancelled) {
            setStats(s as FloorStats);
            setError('');
          }
        })
        .catch(e => {
          if (!cancelled) setError((e as Error).message || 'Could not load stats');
        });
      // Reports come from the documented admin endpoint rather than being
      // bolted onto floor-stats: one capability, one route.
      api
        .getFeedback({ limit: 100 })
        .then(r => {
          if (!cancelled) setReports(r.items);
        })
        .catch(e => {
          console.error('feedback fetch failed:', e);
          if (!cancelled) setReports([]);
        });
      // What the floors were asked, on the same poll as the rest.
      api
        .getFloorQuestions(100)
        .then(q => {
          if (!cancelled) setQuestions(q);
        })
        .catch(e => {
          console.error('questions fetch failed:', e);
          if (!cancelled) setQuestions({ totalCostUsd: 0, questions: [] });
        });
      // Journeys last, and the CALL itself is guarded, not only its promise.
      // A rejected promise leaves the page standing; a call that throws where
      // it is made kills the whole poll, taking every other block with it,
      // which is how one missing admin method blanked the cockpit before.
      Promise.resolve()
        .then(() => api.getJourneys())
        .then(j => {
          if (!cancelled) setJourneys(j);
        })
        .catch(e => {
          console.error('journeys fetch failed:', e);
          if (!cancelled)
            setJourneys({
              summary: { journeys: 0, bounced: 0, visitors: 0, medianSteps: 0 },
              topExits: [],
              journeys: [],
            });
        });
    };
    load();
    // Left open during a launch, so it keeps itself current.
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [allowed]);

  const open = reports?.filter(r => r.status === 'open').length ?? 0;

  // Nothing at all until the check comes back: the session check takes a
  // second or two on a cold load, and a headline reading "Admin" in that
  // window tells a stranger the page is real before the bounce takes them
  // away from it (seen in production 2026-08-19).
  if (!allowed) return null;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="adm">
        <h1 className="adm-head">Admin</h1>
        <p className="adm-lead">
          Human traffic and signups over the last fortnight, the people waiting for a reply, and everything anyone has
          reported.
        </p>

        <EarnTableEditor />

        {/* Who to pay, and where (owner ask 2026-08-20). Approving a proposal
            means sending real money to a stranger, and their payout details are
            stripped from every other route by design, so this is the one place
            they surface. Search is explicit rather than a list on load: a page
            that prints everybody's payout handle the moment it opens is a page
            you cannot screen-share. */}
        <section className="adm-block">
          <h2 className="pubws-h2">Who to pay</h2>
          <p className="adm-note">
            Search by name, account id or email. Blank shows everyone who has payout details on file. Platform admin
            only, and nowhere else in the API.
          </p>
          <form
            className="adm-payform"
            onSubmit={e => {
              e.preventDefault();
              setPayErr('');
              api
                .findParticipants(payQ)
                .then(r => setPayRows(r.participants))
                .catch(err => {
                  setPayErr((err as Error).message || 'Could not search');
                  setPayRows(null);
                });
            }}
          >
            <input
              className="adm-payq"
              value={payQ}
              onChange={e => setPayQ(e.target.value)}
              placeholder="name, id or email"
              aria-label="Find a participant"
            />
            <button className="adm-paygo" type="submit">
              Find
            </button>
          </form>
          {payErr && <p className="adm-err">{payErr}</p>}
          {payRows && payRows.length === 0 && <p className="adm-empty">Nobody matches that.</p>}
          {payRows && payRows.length > 0 && (
            <ul className="adm-paylist">
              {payRows.map(p => (
                <li key={p.id} className="adm-payrow">
                  <div className="adm-payhead">
                    <span className="adm-payname">{p.nickname || p.id}</span>
                    {p.platformOperated && <span className="adm-paytag">house</span>}
                    {p.approvedUsd > 0 && (
                      <span className="adm-payowed">${p.approvedUsd.toLocaleString('en-US')} approved</span>
                    )}
                  </div>
                  {p.email && <div className="adm-paymeta">{p.email}</div>}
                  <div className="adm-payhandle">
                    {p.payoutHandle || <span className="adm-paynone">no payout details on file</span>}
                  </div>
                  {p.approvedContracts.length > 0 && (
                    <ul className="adm-paycon">
                      {p.approvedContracts.map((c, i) => (
                        <li key={i}>
                          ${c.askUsd} &middot; {c.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="adm-err">{error}</p>}
        {!stats && !error && <p className="adm-empty">Loading&hellip;</p>}

        {stats && (
          <>
            <div className="adm-figures">
              <Figure value={stats.visits24h} label="visits · 24h" />
              <Figure value={stats.uniques24h} label="people · 24h" />
              <Figure value={stats.totalUsers} label="accounts" />
              <Figure value={stats.waitlist.length} label="waitlist" />
              <Figure value={stats.botVisits} label="bot hits · filtered" />
            </div>

            <Rows
              title="By day"
              note="Human visits, bots and scanners filtered out."
              bar
              empty="Nobody yet."
              rows={stats.visitsByDay
                .slice()
                .reverse()
                .map(d => ({
                  key: d.day,
                  left: dayLabel(d.day),
                  right: `${n(d.uniques)} unique`,
                  value: d.visits,
                }))}
            />

            <Rows
              title="Where they came from"
              note="Grouped by domain, so one channel is one row."
              empty="No human visits yet."
              rows={stats.topReferers.map(r => ({ key: r.source, left: r.source, value: r.visits }))}
            />

            <Rows
              title="Pages"
              empty="No human visits yet."
              rows={stats.topPaths.map(p => ({
                key: p.path,
                left: <span className="adm-mono">{p.path}</span>,
                value: p.visits,
              }))}
            />

            <Rows
              title="Countries"
              empty="No human visits yet."
              rows={stats.topCountries.map(c => ({
                key: c.country,
                left: countryLabel(c.country),
                right: `${n(c.uniques)} unique`,
                value: c.visits,
              }))}
            />

            <Rows
              title="Visitors"
              note={`${stats.visitorSummary.people} likely people · ${stats.visitorSummary.servers} server/bot · ${stats.visitorSummary.proxies} proxy or VPN, by IP type.`}
              empty="No human visits yet."
              rows={stats.recentVisitors.map(v => ({
                key: v.ip,
                left: (
                  <>
                    <span className="adm-mono">{v.ip}</span>
                    {/* Neutral chip, not a colour code: person is the
                        expected case, so only the others are worth a word. */}
                    {v.kind !== 'person' && (
                      <span className="adm-tag">
                        {v.kind === 'server' ? 'server' : v.kind === 'proxy' ? 'proxy' : '?'}
                      </span>
                    )}
                    <span className="adm-sub">
                      {countryLabel(v.country)}
                      {v.org ? ` · ${v.org}` : ''}
                    </span>
                  </>
                ),
                right: new Date(v.lastSeen).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                value: v.visits,
              }))}
            />

            <Journeys feed={journeys} />

            <Rows
              title="Where they stopped"
              note="The last page of a sitting. The page most often last-seen is the page losing people."
              bar
              empty="No human visits yet."
              rows={(journeys?.topExits ?? []).map(e => ({
                key: e.path,
                left: <span className="adm-mono">{e.path}</span>,
                value: e.journeys,
              }))}
            />

            <Rows
              title="Signups by day"
              bar
              empty="None yet."
              rows={stats.signupsByDay
                .slice()
                .reverse()
                .map(d => ({
                  key: d.day,
                  left: dayLabel(d.day),
                  value: d.signups,
                }))}
            />

            <Rows
              title="Recent signups"
              empty="Nobody has signed up yet."
              rows={stats.recentSignups.map(s => ({
                key: s.email,
                left: (
                  <>
                    <span className="adm-mono">{s.email}</span>
                    {s.name && <span className="adm-sub">{s.name}</span>}
                  </>
                ),
                value: s.createdAt?.slice(0, 10) ?? '',
              }))}
            />

            <Rows
              title={`Waitlist (${stats.waitlist.length})`}
              note="Everyone, newest first. These are people waiting on a reply from you."
              empty="Empty."
              rows={stats.waitlist.map(w => ({
                key: w.email,
                left: (
                  <>
                    <span className="adm-mono">{w.email}</span>
                    {/* Which door: the marketplace tile, or a floor's own box.
                        Both post to the same endpoint, so without it every
                        signup reads the same and no surface can be credited. */}
                    <span className="adm-sub">{w.source ?? 'unknown door'}</span>
                  </>
                ),
                value: w.createdAt?.slice(0, 10) ?? '',
              }))}
            />

            {/* What the floors were asked, and what they answered (owner ask
                2026-08-20). This is the page's most useful list before
                launch: a question is a gap in the floor said in a visitor's
                own words, and a row with an error is one nobody could answer
                at all. Newest first, whole text inline, because a question
                is one line and clicking through to read it is friction on
                the person who has to act on it. */}
            <section className="adm-block">
              <h2 className="pubws-h2">Questions{questions ? ` (${questions.questions.length})` : ''}</h2>
              {questions && questions.questions.length > 0 && (
                <p className="adm-note">
                  Asked of the floors&rsquo; Ask field. Total spend ${questions.totalCostUsd.toFixed(2)}.
                </p>
              )}
              {questions === null ? null : questions.questions.length === 0 ? (
                <p className="adm-empty">
                  Nothing asked yet. The Ask field under each floor&rsquo;s conversation lands here.
                </p>
              ) : (
                <ul className="adm-list">
                  {questions.questions.map(q => (
                    <li key={q.id} className={`adm-report${q.error ? '' : ' is-done'}`}>
                      <div className="adm-report-head">
                        <span className="adm-tag">{q.slug ?? q.workspaceName ?? 'floor'}</span>
                        <strong>{q.question}</strong>
                        <span className="adm-sub">{q.createdAt.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p className="adm-report-body">{q.error ? `No answer: ${q.error}` : q.answer}</p>
                      <p className="adm-report-who">
                        {[
                          q.askedByName ?? 'anonymous',
                          q.country,
                          q.costUsd != null ? `$${q.costUsd.toFixed(4)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* A queue the owner works, not an archive: open first, whole
                body inline, since a report is usually three sentences and
                clicking through to read them is friction on the person who
                has to answer. */}
            <section className="adm-block">
              <h2 className="pubws-h2">Reports{reports ? ` (${open} open of ${reports.length})` : ''}</h2>
              {reports === null ? null : reports.length === 0 ? (
                <p className="adm-empty">
                  Nothing reported yet. The floor&rsquo;s Report button and POST /api/feedback both land here.
                </p>
              ) : (
                <ul className="adm-list">
                  {[...reports]
                    .sort(
                      (a, b) =>
                        (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
                        b.createdAt.localeCompare(a.createdAt),
                    )
                    .map(r => (
                      <li key={r.id} className={`adm-report${r.status === 'open' ? '' : ' is-done'}`}>
                        <div className="adm-report-head">
                          <span className="adm-tag">{r.kind}</span>
                          <strong>{r.subject}</strong>
                          <span className="adm-sub">
                            {r.createdAt.slice(0, 16).replace('T', ' ')}
                            {r.status !== 'open' ? ` · ${r.status}` : ''}
                          </span>
                        </div>
                        {/* pre-wrap keeps the reporter's line breaks; a body
                            can also be one unbroken 500-character string (a
                            pasted token, a URL, a fuzz test), and the clamp
                            stops one huge report burying every other. */}
                        <p className="adm-report-body">{r.body}</p>
                        <p className="adm-report-who">
                          {[r.email, r.agentId, r.url].filter(Boolean).join(' · ') || 'anonymous, no page recorded'}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
