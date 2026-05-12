import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { MarketMessage } from '../types';

/**
 * Per-market comment thread. Mirrors the proposal-level ChatPanel but is
 * scoped to a single market. Used by AI agents to post trade rationales
 * and by humans to discuss specific markets.
 */
export function MarketComments({ marketId }: { marketId: string }) {
  const [messages, setMessages] = useState<MarketMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);

  const load = useCallback(async () => {
    setLoadError('');
    const data = await api
      .getMarketMessages(marketId)
      .catch((e: Error) => { setLoadError(e.message); return null; });
    if (data) setMessages(data);
  }, [marketId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (initialScroll.current) { el.scrollTop = el.scrollHeight; initialScroll.current = false; return; }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    setSendError('');
    const ok = await api
      .sendMarketMessage(marketId, input.trim())
      .catch((e: Error) => { setSendError(e.message); return null; });
    if (ok) setInput('');
    setSending(false);
    load();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="proposal-chat market-comments">
      <div className="proposal-chat-messages" ref={containerRef}>
        {messages.length === 0 && <span className="proposal-chat-empty">No comments yet.</span>}
        {messages.map(msg => {
          const isAdmin = msg.from === 'admin';
          const author = isAdmin ? 'admin' : (msg.fromName ?? `${msg.from.slice(0, 12)}…`);
          return (
            <div key={msg.id} className="proposal-chat-msg">
              <span
                title={msg.from}
                className={`proposal-chat-author ${isAdmin ? 'proposal-chat-author--admin' : 'proposal-chat-author--participant'}`}
              >
                {author}
              </span>
              <span className="proposal-chat-content">{msg.content}</span>
            </div>
          );
        })}
      </div>
      {(loadError || sendError) && <div className="proposal-chat-error">{loadError || sendError}</div>}
      <div className="proposal-chat-input">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Comment on this market… (Enter to send)"
          rows={2}
        />
        <button className="btn-small" onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
