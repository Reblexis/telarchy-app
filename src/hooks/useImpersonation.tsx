import { createContext, useContext, useState, type ReactNode } from 'react';

interface ImpersonationContextValue {
  agentId: string;
  setAgentId: (id: string) => void;
}

const KEY = 'impersonatedAgent';
const DEFAULT = 'user';

const ImpersonationContext = createContext<ImpersonationContextValue>({
  agentId: DEFAULT,
  setAgentId: () => {},
});

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentIdState] = useState(() => localStorage.getItem(KEY) || DEFAULT);

  const setAgentId = (id: string) => {
    localStorage.setItem(KEY, id);
    setAgentIdState(id);
  };

  return (
    <ImpersonationContext.Provider value={{ agentId, setAgentId }}>
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
