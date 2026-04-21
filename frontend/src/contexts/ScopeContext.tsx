import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setFinpulseApiScope, type FinpulseScope } from "../lib/api";

const STORAGE_KEY = "finpulse-scope";

type Ctx = {
  scope: FinpulseScope;
  setScope: (s: FinpulseScope) => void;
};

const ScopeContext = createContext<Ctx | null>(null);

function readStored(): FinpulseScope {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "household") return "household";
  } catch {
    /* ignore */
  }
  return "me";
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<FinpulseScope>(() => readStored());

  const setScope = useCallback((s: FinpulseScope) => {
    setScopeState(s);
    setFinpulseApiScope(s);
    try {
      sessionStorage.setItem(STORAGE_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setFinpulseApiScope(scope);
  }, [scope]);

  const value = useMemo(() => ({ scope, setScope }), [scope, setScope]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope() {
  const c = useContext(ScopeContext);
  if (!c) throw new Error("useScope must be used within ScopeProvider");
  return c;
}
