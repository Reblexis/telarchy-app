import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

export interface InspectProposal {
  id: string;
  title: string;
}

interface InspectModeContextValue {
  inspectProposal: InspectProposal | null;
  setInspectProposal: (proposal: InspectProposal | null) => void;
}

const InspectModeContext = createContext<InspectModeContextValue>({
  inspectProposal: null,
  setInspectProposal: () => {},
});

export function InspectModeProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const urlId = searchParams.get('proposal');
  const [state, setState] = useState<InspectProposal | null>(
    urlId ? { id: urlId, title: `${urlId.slice(0, 8)}…` } : null,
  );
  const lastPathRef = useRef(location.pathname);

  // SPA navigation strips arbitrary search params. If the route changed and
  // the new URL doesn't have ?proposal= but state does, re-apply via replace
  // so /metrics?proposal=X stays sticky as the user moves around.
  useEffect(() => {
    if (location.pathname === lastPathRef.current) return;
    lastPathRef.current = location.pathname;
    if (state && !urlId) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('proposal', state.id);
        return next;
      }, { replace: true });
    }
  }, [location.pathname, state, urlId, setSearchParams]);

  // URL is authoritative within a path: if the user edits ?proposal= directly
  // (delete it, change to a different id), state follows the URL.
  useEffect(() => {
    if (urlId === (state?.id ?? null)) return;
    if (!urlId) setState(null);
    else setState({ id: urlId, title: `${urlId.slice(0, 8)}…` });
  }, [urlId, state]);

  // Lazy-fetch real title when only the id is known.
  useEffect(() => {
    if (!state || !state.title.endsWith('…')) return;
    let cancelled = false;
    api.getProposal(state.id)
      .then((p: { title?: string }) => {
        if (cancelled || !p?.title) return;
        setState(prev => prev && prev.id === state.id ? { id: prev.id, title: p.title as string } : prev);
      })
      .catch(() => { /* invalid id; banner keeps id-prefix */ });
    return () => { cancelled = true; };
  }, [state]);

  const setInspectProposal = (proposal: InspectProposal | null) => {
    setState(proposal);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (proposal) next.set('proposal', proposal.id);
      else next.delete('proposal');
      return next;
    });
  };

  return (
    <InspectModeContext.Provider value={{ inspectProposal: state, setInspectProposal }}>
      {children}
    </InspectModeContext.Provider>
  );
}

export function useInspectMode() {
  return useContext(InspectModeContext);
}
