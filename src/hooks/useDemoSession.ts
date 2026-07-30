import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getSession,
  initializeSession,
  subscribeSession,
} from "@/lib/demoAuth";
import { isDemoSession } from "@/lib/demoMode";

let sessionHasInitialized = false;

function getServerSessionSnapshot() {
  return null;
}

export function useDemoSession() {
  const session = useSyncExternalStore(
    subscribeSession,
    getSession,
    getServerSessionSnapshot,
  );
  const [isReady, setIsReady] = useState(sessionHasInitialized);

  useEffect(() => {
    if (sessionHasInitialized) {
      setIsReady(true);
      return;
    }

    let mounted = true;
    void initializeSession().finally(() => {
      sessionHasInitialized = true;
      if (mounted) setIsReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return {
    session,
    isReady,
    isAuthenticated: Boolean(session),
    isDemo: isDemoSession(session),
    role: session?.role ?? null,
  };
}
