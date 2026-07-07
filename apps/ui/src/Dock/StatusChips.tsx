import { cn } from "@/lib/utils";

export interface StatusChip {
  key: string;
  label: string;
  active: boolean;
}

export interface StatusChipsProps {
  chips: StatusChip[];
  className?: string;
}

/**
 * WS/SIM (and, later, adapter-health) status chips — ported as-is from the
 * inline `statusChips` markup in `Controls/BottomDock.tsx`, pinned to the
 * dock's right edge instead of sitting between the playback controls and
 * the record button.
 */
export default function StatusChips({ chips, className }: StatusChipsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {chips.map(({ key, label, active }) => (
        <span
          key={key}
          className={cn(
            "inline-flex items-center gap-2 px-2 text-xs",
            active ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              active
                ? "bg-status-ok shadow-[0_0_4px_var(--color-status-ok)]"
                : "bg-muted-foreground"
            )}
          />
          <span className={cn("uppercase tracking-wider", active ? "opacity-85" : "opacity-55")}>
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}
