import { toast } from "sonner";
import { isDemoEmail } from "@/data/demoCredentials";
import type { DemoSession } from "@/types";
import { getSession } from "./demoAuth";

export const DEMO_BLOCKED_MESSAGE = "Esta acción está deshabilitada en el Modo de Prueba.";

export function isDemoSession(session?: DemoSession | null) {
  return Boolean(session?.isDemo || session?.demoMode === "read_only");
}

export function isDemoUser(sessionOrEmail?: DemoSession | string | null) {
  if (!sessionOrEmail) return false;
  if (typeof sessionOrEmail === "string") return isDemoEmail(sessionOrEmail);
  return isDemoSession(sessionOrEmail);
}

export function getDemoMode() {
  const session = getSession();
  return {
    session,
    isDemo: isDemoSession(session),
    role: session?.role ?? null,
  };
}

export function canRunSensitiveAction(session: DemoSession | null = getSession()) {
  return !isDemoSession(session);
}

export function blockDemoAction() {
  toast.error(DEMO_BLOCKED_MESSAGE);
  return false;
}

export function guardSensitiveAction(
  onAllowed?: () => void,
  session: DemoSession | null = getSession(),
) {
  if (!canRunSensitiveAction(session)) return blockDemoAction();
  onAllowed?.();
  return true;
}

export function simulateDemoAction(_message?: string) {
  if (!canRunSensitiveAction()) return blockDemoAction();

  toast.info(_message ?? "Acción pendiente de conexión.", {
    description: "No se guardaron cambios reales todavía.",
  });
  return true;
}
