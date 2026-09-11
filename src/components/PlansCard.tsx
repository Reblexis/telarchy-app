import { useCallback, useEffect, useState } from 'react';
import { api, type TimelineItem } from '../lib/api';
import { endMeta } from '../lib/timeline-model';

/**
 * The cockpit's Plans card (docs/data-room.md, "What is planned"): the only
 * place a plan entry is written. The data room's "What is planned" tab draws
 * the same entries and cannot change them.
 *
 * Shaped like vcihal.com/tasks (owner: "just like in vcihal.com/tasks"): a
 * composer whose first row is the title and Add, the details folded under
 * it; every open entry in one list, soonest due first, undated last, each
 * with its due meta, an edit in place and a done tick; the done entries
 * folded under "Done N", newest first, each with an undo. There is no delete
 * because the database refuses one.
 *
 * It targets the platform floor, the one the room prints: the workspace id
 * comes from GET /api/data-room/planned, the list from the managers' read
 * GET /api/workspaces/:id/plans. It reads once on mount and once after each
 * write, never on a timer (docs/ui-conventions.md, "The cockpit may never
 * take the site down").
 */

/** datetime-local is wall-clock in the browser's zone; the API wants an instant. */
function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The other way, for filling the edit fields: the instant on this browser's clock. */
function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

/** Soonest due first, undated last, ties in the order given. The server
 *  already sends this order; sorting again keeps the rule true whatever
 *  arrives. */
function openOrder(items: TimelineItem[]): TimelineItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const da = Number.isNaN(time(a.it.due)) ? Infinity : time(a.it.due);
      const db = Number.isNaN(time(b.it.due)) ? Infinity : time(b.it.due);
      return da - db || a.i - b.i;
    })
    .map(x => x.it);
}

function doneOrder(items: TimelineItem[]): TimelineItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const da = Number.isNaN(time(a.it.doneAt)) ? -Infinity : time(a.it.doneAt);
      const db = Number.isNaN(time(b.it.doneAt)) ? -Infinity : time(b.it.doneAt);
      return db - da || a.i - b.i;
    })
    .map(x => x.it);
}

interface Fields {
  title: string;
  description: string;
  start: string;
  due: string;
}

const EMPTY: Fields = { title: '', description: '', start: '', due: '' };

/** What it is, start and due: the details under the composer and the body of
 *  an edit, so the two can never offer different fields. */
function Details({ value, onChange }: { value: Fields; onChange: (next: Fields) => void }) {
  return (
    <div className="adm-plan-fields">
      <label className="adm-plan-field adm-plan-field--wide">
        <span className="adm-sub">What it is</span>
        <textarea
          className="ow-field adm-plan-words"
          rows={3}
          placeholder="Optional. Markdown."
          value={value.description}
          onChange={e => onChange({ ...value, description: e.target.value })}
        />
      </label>
      <label className="adm-plan-field">
        <span className="adm-sub">Start</span>
        <input
          type="datetime-local"
          className="ow-field adm-mono"
          value={value.start}
          onChange={e => onChange({ ...value, start: e.target.value })}
        />
      </label>
      <label className="adm-plan-field">
        <span className="adm-sub">Due</span>
        <input
          type="datetime-local"
          className="ow-field adm-mono"
          value={value.due}
          onChange={e => onChange({ ...value, due: e.target.value })}
        />
      </label>
    </div>
  );
}

export function PlansCard() {
  /** undefined while the room is asked which floor; null when no public floor carries the slug. */
  const [ws, setWs] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Fields>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<{ id: string; fields: Fields } | null>(null);

  const list = useCallback((wsId: string) => {
    return api
      .listPlans(wsId)
      .then(r => {
        setItems(r.items ?? []);
        setFailed(false);
        const t = Date.parse(r.now);
        // The server's clock decides "overdue", the same clock the room uses.
        if (!Number.isNaN(t)) setNow(t);
      })
      .catch(() => setFailed(true));
  }, []);

  // Once, on mount. The call is made inside the promise chain so a missing
  // or throwing method fails this card and not the cockpit around it.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.getDataRoomPlanned())
      .then(r => {
        if (!live) return;
        if (!r.workspace) {
          setWs(null);
          return;
        }
        setWs({ id: r.workspace.id, name: r.workspace.name });
        return list(r.workspace.id);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [list]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws) return;
    const title = draft.title.trim();
    if (!title) return;
    setAdding(true);
    setErr('');
    api
      .createPlan(ws.id, {
        title,
        description: draft.description.trim() || undefined,
        start: localToIso(draft.start),
        due: localToIso(draft.due),
      })
      .then(() => {
        setDraft(EMPTY);
        return list(ws.id);
      })
      .catch(e2 => setErr((e2 as Error).message || 'Could not add it'))
      .finally(() => setAdding(false));
  };

  const write = (id: string, body: Parameters<typeof api.updatePlan>[2]) => {
    if (!ws) return Promise.resolve();
    setErr('');
    return api
      .updatePlan(ws.id, id, body)
      .then(() => list(ws.id))
      .catch(e => setErr((e as Error).message || 'Could not save it'));
  };

  const save = (it: TimelineItem, f: Fields) => {
    const title = f.title.trim();
    if (!title) {
      setErr('Give it a title.');
      return;
    }
    // Only what changed goes, so an edit of the words never rewrites a date
    // (and never stamps a change nobody made).
    const body: Parameters<typeof api.updatePlan>[2] = {};
    if (title !== it.title) body.title = title;
    const words = f.description.trim();
    if (words !== (it.description ?? '').trim()) body.description = words || null;
    const start = localToIso(f.start) ?? null;
    if (start !== (localToIso(isoToLocal(it.start)) ?? null)) body.start = start;
    const due = localToIso(f.due) ?? null;
    if (due !== (localToIso(isoToLocal(it.due)) ?? null)) body.due = due;
    setEditing(null);
    if (Object.keys(body).length === 0) return;
    void write(it.id, body);
  };

  const open = openOrder((items ?? []).filter(i => !i.done));
  const done = doneOrder((items ?? []).filter(i => i.done));

  const metaOf = (it: TimelineItem): { text: string; overdue: boolean } | null => {
    const due = time(it.due);
    if (Number.isNaN(due)) return null;
    if (due < now) return { text: 'overdue', overdue: true };
    const text = endMeta(it, now);
    return text ? { text, overdue: false } : null;
  };

  return (
    <section className="adm-block adm-plans" aria-label="Plans">
      <h2 className="pubws-h2">Plans</h2>
      <p className="adm-note">
        What the data room's "What is planned" tab shows{ws ? ` for ${ws.name}` : ''}, in your words. Written here and
        nowhere else; an entry is never deleted, only edited or done.
      </p>

      {ws === null ? (
        <p className="adm-empty">The platform floor is not public, so its plans cannot be shown here.</p>
      ) : failed ? (
        <p className="adm-err">The plans would not open.</p>
      ) : ws === undefined || items === null ? (
        <p className="adm-empty">Loading&hellip;</p>
      ) : (
        <>
          <form className="adm-plan-composer" onSubmit={add}>
            <div className="adm-plan-titlerow">
              <input
                className="adm-payq adm-plan-titlein"
                placeholder="What needs doing?"
                aria-label="What needs doing?"
                maxLength={200}
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
              />
              <button className="adm-paygo" type="submit" disabled={adding}>
                Add
              </button>
            </div>
            <details className="adm-plan-more">
              <summary className="adm-sub">Details</summary>
              <Details value={draft} onChange={setDraft} />
            </details>
          </form>

          {err && <p className="adm-err">{err}</p>}

          {open.length === 0 ? (
            <p className="adm-empty">Nothing planned yet.</p>
          ) : (
            <ul className="adm-list adm-plan-open">
              {open.map(it => {
                if (editing?.id === it.id) {
                  const f = editing.fields;
                  return (
                    <li key={it.id} className="adm-plan-row is-editing">
                      <form
                        className="adm-plan-edit"
                        onSubmit={e => {
                          e.preventDefault();
                          save(it, f);
                        }}
                      >
                        <label className="adm-plan-field adm-plan-field--wide">
                          <span className="adm-sub">Title</span>
                          <input
                            className="ow-field"
                            maxLength={200}
                            value={f.title}
                            onChange={e => setEditing({ id: it.id, fields: { ...f, title: e.target.value } })}
                          />
                        </label>
                        <Details value={f} onChange={next => setEditing({ id: it.id, fields: next })} />
                        <div className="xw-actions">
                          <button className="adm-paygo" type="submit">
                            Save
                          </button>
                          <button className="adm-linkbtn" type="button" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </li>
                  );
                }
                const meta = metaOf(it);
                return (
                  <li key={it.id} className="adm-plan-row">
                    <button
                      type="button"
                      className="adm-plan-tick"
                      aria-label={`Mark done: ${it.title}`}
                      title="Mark done"
                      onClick={() => void write(it.id, { done: true })}
                    />
                    <span className="adm-plan-main">
                      <span className="adm-plan-title">{it.title}</span>
                      {it.description && <span className="adm-plan-desc">{it.description}</span>}
                    </span>
                    {meta && <span className={`adm-plan-meta${meta.overdue ? ' is-overdue' : ''}`}>{meta.text}</span>}
                    <button
                      type="button"
                      className="adm-linkbtn"
                      onClick={() =>
                        setEditing({
                          id: it.id,
                          fields: {
                            title: it.title,
                            description: it.description ?? '',
                            start: isoToLocal(it.start),
                            due: isoToLocal(it.due),
                          },
                        })
                      }
                    >
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {done.length > 0 && (
            <details className="adm-plan-done">
              <summary className="adm-sub">{`Done ${done.length}`}</summary>
              <ul className="adm-list">
                {done.map(it => (
                  <li key={it.id} className="adm-plan-row is-done">
                    <span className="adm-plan-main">
                      <span className="adm-plan-title">{it.title}</span>
                    </span>
                    {it.doneAt && <span className="adm-plan-meta">{it.doneAt.slice(0, 10)}</span>}
                    <button type="button" className="adm-linkbtn" onClick={() => void write(it.id, { done: false })}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
