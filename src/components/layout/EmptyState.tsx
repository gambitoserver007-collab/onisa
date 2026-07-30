import type { ReactNode } from "react";

/**
 * Friendly empty state for tables, lists and search results.
 * Use inside a card/table cell or on its own.
 */
export function EmptyState({
  emoji = "📭",
  title,
  description,
  action,
}: {
  emoji?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-3xl">
        {emoji}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
