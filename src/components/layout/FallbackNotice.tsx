import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Soft warm notice shown when the app falls back to demo data because Supabase
 * could not be reached. Replaces the ad-hoc bordered divs sprinkled across routes.
 */
export function FallbackNotice({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-warm/30 bg-warm/10 px-3.5 py-2.5 text-sm text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-warm-foreground" />
      <span>{children}</span>
    </div>
  );
}
