import { createContext, useContext, useState, type ReactNode } from 'react';

export interface InspectTask {
  id: string;
  title: string;
}

interface InspectModeContextValue {
  inspectTask: InspectTask | null;
  setInspectTask: (task: InspectTask | null) => void;
}

const KEY = 'inspectTask';

const InspectModeContext = createContext<InspectModeContextValue>({
  inspectTask: null,
  setInspectTask: () => {},
});

export function InspectModeProvider({ children }: { children: ReactNode }) {
  const [inspectTask, setInspectTaskState] = useState<InspectTask | null>(() => {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    try { return JSON.parse(stored) as InspectTask; } catch { localStorage.removeItem(KEY); return null; }
  });

  const setInspectTask = (task: InspectTask | null) => {
    if (task) localStorage.setItem(KEY, JSON.stringify(task));
    else localStorage.removeItem(KEY);
    setInspectTaskState(task);
  };

  return (
    <InspectModeContext.Provider value={{ inspectTask, setInspectTask }}>
      {children}
    </InspectModeContext.Provider>
  );
}

export function useInspectMode() {
  return useContext(InspectModeContext);
}
