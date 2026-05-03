import { createContext, useContext, useState, type ReactNode } from 'react';

export interface InspectProposal {
  id: string;
  title: string;
}

interface InspectModeContextValue {
  inspectProposal: InspectProposal | null;
  setInspectProposal: (proposal: InspectProposal | null) => void;
}

const KEY = 'inspectProposal';

const InspectModeContext = createContext<InspectModeContextValue>({
  inspectProposal: null,
  setInspectProposal: () => {},
});

export function InspectModeProvider({ children }: { children: ReactNode }) {
  const [inspectProposal, setInspectProposalState] = useState<InspectProposal | null>(() => {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    try { return JSON.parse(stored) as InspectProposal; } catch { localStorage.removeItem(KEY); return null; }
  });

  const setInspectProposal = (proposal: InspectProposal | null) => {
    if (proposal) localStorage.setItem(KEY, JSON.stringify(proposal));
    else localStorage.removeItem(KEY);
    setInspectProposalState(proposal);
  };

  return (
    <InspectModeContext.Provider value={{ inspectProposal, setInspectProposal }}>
      {children}
    </InspectModeContext.Provider>
  );
}

export function useInspectMode() {
  return useContext(InspectModeContext);
}
