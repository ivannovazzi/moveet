import { cn } from "@/lib/utils";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import DockSurface from "./DockSurface";
import ModeLauncher from "./ModeLauncher";

export interface ActionDockProps {
  onStartMode: (kind: InteractionModeKind) => void;
  /** A mode is already running — the launcher stands down. */
  busy: boolean;
  /** The simulator is unreachable: nothing can be started. */
  offline: boolean;
}

/**
 * The one thing that *makes* something, on its own surface at the head of the
 * row: dispatch a vehicle, place a job, draw a zone, draw a heat zone.
 *
 * It sits outside the main dock on purpose. Everything in that dock adjusts a
 * run that already exists; this starts new work, and the pause between reading
 * the dock and reaching for it is the point. While a mode is running the
 * launcher goes quiet — the mode's own rail in the main dock is where the next
 * action lives.
 */
export default function ActionDock({ onStartMode, busy, offline }: ActionDockProps) {
  return (
    <DockSurface
      className={cn(
        "items-center transition-opacity duration-normal ease-standard",
        busy && "opacity-45"
      )}
    >
      <ModeLauncher onStart={onStartMode} disabled={offline || busy} />
    </DockSurface>
  );
}
