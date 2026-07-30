import type { MouseEvent } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";

interface DemoGuardedButtonProps extends ButtonProps {
  onAllowedClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function DemoGuardedButton({
  onAllowedClick,
  onClick,
  ...props
}: DemoGuardedButtonProps) {
  const { isDemo } = useDemoSession();

  return (
    <Button
      {...props}
      data-demo-guarded={isDemo ? "true" : undefined}
      onClick={(event) => {
        if (isDemo) {
          event.preventDefault();
          event.stopPropagation();
          blockDemoAction();
          return;
        }

        onClick?.(event);
        if (!event.defaultPrevented) onAllowedClick?.(event);
      }}
    />
  );
}
