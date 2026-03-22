import { useState, useCallback } from 'react';

const STORAGE_KEY = 'agentSession';

export interface AgentSession {
  agentId: string;
  apiKey: string;
}

function readSession(): AgentSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgentSession;
  } catch {
    return null;
  }
}

export function useAgentSession() {
  const [session, setSessionState] = useState<AgentSession | null>(readSession);

  const login = useCallback((agentId: string, apiKey: string) => {
    const s: AgentSession = { agentId, apiKey };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    setSessionState(s);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSessionState(null);
  }, []);

  return { session, login, logout };
}
