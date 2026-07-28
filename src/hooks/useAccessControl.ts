import { useEffect, useState } from "react";
import { fetchAllowedSections } from "@/services/appData";
import { useDemoSession } from "@/hooks/useDemoSession";

// Caché a nivel de módulo: el AppShell se re-monta en cada navegación, así que
// guardamos los accesos del usuario para NO reconsultarlos ni quedar en `null`
// en cada cambio de sección (eso causaba parpadeo/rebote al navegar).
let cacheUserId: string | undefined;
let cacheSections: string[] | null = null;
let cacheLoaded = false;

// Accesos personalizados (rutas del panel) del usuario actual. null = usar los
// accesos por defecto de su rol. `ready` indica que ya se conocen (para no
// redirigir antes de tiempo). Best-effort: no rompe si la columna aún no existe.
export function useAccessControl() {
  const { session, isReady } = useDemoSession();
  const sameUser = !!session?.userId && session.userId === cacheUserId;
  const [allowedSections, setAllowedSections] = useState<string[] | null>(
    sameUser ? cacheSections : null,
  );
  const [ready, setReady] = useState<boolean>(sameUser && cacheLoaded);

  useEffect(() => {
    if (!isReady || !session?.userId) return;
    // Ya cacheado para este usuario → usar al instante, sin reconsultar.
    if (session.userId === cacheUserId && cacheLoaded) {
      setAllowedSections(cacheSections);
      setReady(true);
      return;
    }
    let active = true;
    void fetchAllowedSections(session.userId)
      .then((sections) => {
        cacheUserId = session.userId;
        cacheSections = sections;
        cacheLoaded = true;
        if (active) {
          setAllowedSections(sections);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [isReady, session?.userId]);

  return { allowedSections, ready };
}
