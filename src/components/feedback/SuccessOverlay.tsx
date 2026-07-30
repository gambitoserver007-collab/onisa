import { Check } from "lucide-react";

interface SuccessOverlayProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose?: () => void;
}

/**
 * Full-screen celebratory confirmation shown after a key action completes
 * (e.g. a sale is registered). Animated check + pulsing rings, auto-dismiss
 * is managed by the caller.
 */
export function SuccessOverlay({
  open,
  title,
  subtitle,
  onClose,
}: SuccessOverlayProps) {
  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onClose}
      className="fixed inset-0 z-[70] grid animate-fade-up place-items-center bg-background/70 p-6 backdrop-blur-md"
    >
      <div className="relative w-full max-w-xs animate-pop-in rounded-3xl border border-border/60 bg-card p-8 text-center shadow-soft">
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 rounded-full bg-primary/30 animate-ring-pulse" />
          <span
            className="absolute inset-0 rounded-full bg-primary/20 animate-ring-pulse"
            style={{ animationDelay: "0.25s" }}
          />
          <span className="relative grid h-20 w-20 place-items-center rounded-full bg-brand-gradient text-primary-foreground shadow-glow">
            <Check className="h-10 w-10 animate-check-pop" strokeWidth={3} />
          </span>
        </div>
        <h2 className="mt-5 text-xl font-black">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
