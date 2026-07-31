import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CloseIcon, Play } from "@/components/Icons";

export interface StartHintProps {
  /** The simulation's `running` flag (from the sim status feed). */
  running: boolean;
  /**
   * Whether the app is far enough along to act on the hint — map data loaded
   * and the simulator reachable. Keeps the hint off the loading overlay and
   * from offering a Start that would fail.
   */
  ready: boolean;
  /** Starts the simulation. Awaited so the button can show a pending state. */
  onStart: () => unknown;
  className?: string;
}

/**
 * First-run affordance: the simulator boots PAUSED, so without this the app
 * opens on a static map with no obvious next action — the play control is one
 * unlabeled icon among many in the bottom dock.
 *
 * Visibility is deliberately one-shot. It shows only while the run has never
 * started in this session; once `running` flips true it is retired for good,
 * so pausing later does NOT bring the tutorial back at someone who has clearly
 * found the transport controls. Dismissing does the same, permanently.
 *
 * Sits above the dock rather than over the map centre: it is a small glass pill
 * on the same visual system as the dock (surface-glass + border + elevation),
 * and only its own box takes pointer events, so the map stays fully draggable.
 */
export default function StartHint({ running, ready, onStart, className }: StartHintProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hasRun, setHasRun] = useState(running);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (running) setHasRun(true);
  }, [running]);

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      await onStart();
    } finally {
      setStarting(false);
    }
  }, [onStart]);

  const visible = ready && !running && !hasRun && !dismissed;
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Simulation paused"
      className={cn(
        "absolute bottom-[104px] left-1/2 z-40 -translate-x-1/2",
        "flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-border px-3 py-2",
        "surface-glass glass-frost shadow-elevated animate-fade-up",
        className
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-foreground">Simulation is paused</span>
        <span className="truncate text-[11px] text-muted-foreground">
          Start it to put vehicles on the road.
        </span>
      </div>
      <Button onClick={handleStart} disabled={starting} aria-label="Start simulation">
        <Play />
        {starting ? "Starting…" : "Start simulation"}
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
          "transition-[color,background-color] duration-fast ease-standard",
          "hover:bg-foreground/[0.035] hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&_svg]:size-3.5"
        )}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
