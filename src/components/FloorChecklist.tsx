import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * What is still open on this floor, for its owner
 * (docs/owner-on-the-floor.md, "What is still open, on the floor itself").
 *
 * `GET /api/setup/checklist` has answered this question from the database
 * since 2026-08-23, in better words than a UI would invent: it says what the
 * floor lacks and what the rows actually show. Until now the only surface
 * that rendered it was Otto's setup conversation, so an owner who closed that
 * tab never saw it again (notes/self-serve-owner-review-2026-09-01.md).
 *
 * Three rules keep it worth reading: only a caller with `manage`, only the
 * OPEN decisions, and nothing at all once none are open. A panel that is
 * always on screen is furniture, and furniture is not read.
 */
export function FloorChecklist({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [items, setItems] = useState<Array<{ id: string; label: string; status: 'done' | 'open'; note: string }>>([]);

  useEffect(() => {
    if (!canManage || !workspaceId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api
      .setupChecklist(workspaceId)
      .then(r => {
        if (!cancelled) setItems(r.items ?? []);
      })
      // Silent on purpose: the floor is the product, and an owner who cannot
      // read the checklist is not helped by an error where the markets are.
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canManage]);

  const open = items.filter(i => i.status === 'open');
  if (!canManage || open.length === 0) return null;
  const done = items.length - open.length;

  return (
    <section className="adm-block flchk">
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">Still open on this floor</h2>
        <span className="pubws-lb-meta">
          {done} of {items.length} decided
        </span>
      </div>
      <ul className="adm-list">
        {open.map(i => (
          <li className="flchk-row" key={i.id}>
            <span className="flchk-label">{i.label}</span>
            <span className="flchk-note">{i.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
