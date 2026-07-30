import { Info } from "lucide-react";
import { useDemoSession } from "@/hooks/useDemoSession";

export function DemoBanner() {
  const { isDemo } = useDemoSession();

  if (!isDemo) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-2xl border border-warm/30 bg-warm/10 px-4 py-2.5 text-sm text-foreground md:mx-6">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warm/20 text-warm-foreground">
        <Info className="h-4 w-4" />
      </span>
      <span>
        Estás en <strong className="font-semibold">Modo de Prueba</strong> (solo
        lectura). Algunas acciones están deshabilitadas.
      </span>
    </div>
  );
}
