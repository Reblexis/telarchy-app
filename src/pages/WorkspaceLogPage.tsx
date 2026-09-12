import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ActionsLog } from './DataRoomPage';
import { TopBar } from './TradePage';

/**
 * A workspace's own log, `/<slug>/log` (docs/data-room.md, "A workspace's
 * log"): the data room's log with the workspace fixed, in the floor's light
 * palette, under a back link to the floor and "<name> log". The name comes
 * from the log's own vocabulary, so the page needs no second read.
 */
export function WorkspaceLogPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user, loading: authLoading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const label = name ?? slug;
  return (
    <div className="pubws wslog">
      <TopBar user={!!user} ready={!authLoading} busy={busy} />
      <main className="dr">
        <Link className="wslog-back" to={`/${slug}`}>
          ← Back to {label}
        </Link>
        <header className="dr-head">
          <div className="dr-head-main">
            <h1 className="dr-title">{label} log</h1>
          </div>
        </header>
        <ActionsLog
          fixedWorkspace={slug}
          onBusy={setBusy}
          onVocab={v => setName(v.workspaces.find(w => w.slug === slug)?.name ?? null)}
        />
      </main>
    </div>
  );
}
