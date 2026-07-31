import { WarningTriangle } from "@/components/Icons";
import type { PendingModeChange } from "@/hooks/useModeGuard";
import { RailButton, RailLabel } from "./DockBarKit";

export interface GuardPromptProps {
  pending: PendingModeChange;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * Asks before a mode switch throws away in-flight map work. Rendered in the
 * dock's centre slot, on top of the rail that was describing the work — so the
 * question appears exactly where the thing being discarded was reported.
 */
export default function GuardPrompt({ pending, onConfirm, onDismiss }: GuardPromptProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm discard"
      className="flex w-full items-center gap-2.5 pl-2.5 pr-1.5"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-status-warn [&_svg]:size-[15px]">
        <WarningTriangle />
        <RailLabel>Discard</RailLabel>
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
        Discard {pending.loses}?
      </span>
      <RailButton variant="quiet" onClick={onDismiss} autoFocus>
        Keep
      </RailButton>
      <RailButton variant="danger" onClick={onConfirm}>
        Discard
      </RailButton>
    </div>
  );
}
