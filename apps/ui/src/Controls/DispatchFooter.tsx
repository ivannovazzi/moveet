import type { DispatchAssignment, DirectionResult } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import { Button } from "@/components/Inputs";

interface DispatchFooterProps {
  state: DispatchState;
  selectedCount: number;
  assignments: DispatchAssignment[];
  results: DirectionResult[];
  onDispatch: () => void;
  onClear: () => void;
  onDone: () => void;
  onRetryFailed: () => void;
  dispatching: boolean;
  error?: string | null;
}

const footerClass =
  "sticky bottom-0 flex items-center justify-between p-3 bg-card/90 backdrop-blur-md border-t border-border";
const textClass = "flex items-center gap-3 text-sm text-muted-foreground";
const buttonsClass = "flex items-center gap-2";
const errorClass = "mt-1 text-xs leading-tight text-status-error";

export default function DispatchFooter({
  state,
  selectedCount,
  assignments,
  results,
  onDispatch,
  onClear,
  onDone,
  onRetryFailed,
  dispatching: _dispatching,
  error,
}: DispatchFooterProps) {
  if (state === DispatchState.BROWSE) return null;

  if (state === DispatchState.SELECT) {
    return (
      <div className={footerClass}>
        <span className={textClass}>
          {selectedCount > 0
            ? `${selectedCount} selected — click map to add stops`
            : "Select vehicles to dispatch"}
        </span>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" onClick={onClear}>
            Exit
          </Button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.ROUTE) {
    const vehicleCount = assignments.length;
    const stopCount = assignments.reduce((sum, a) => sum + a.waypoints.length, 0);

    return (
      <div className={footerClass}>
        <div>
          <span className={textClass}>
            {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""}, {stopCount} stop
            {stopCount !== 1 ? "s" : ""}
          </span>
          {error && <p className={errorClass}>{error}</p>}
        </div>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onDispatch}
            isDisabled={assignments.length === 0}
          >
            Dispatch
          </Button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.DISPATCH) {
    return (
      <div className={footerClass}>
        <div>
          <span className={textClass}>
            <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-transparent border-l-accent border-t-accent" />
            Dispatching...
          </span>
          {error && <p className={errorClass}>{error}</p>}
        </div>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" isDisabled>
            Clear
          </Button>
          <Button variant="default" size="sm" isDisabled>
            Dispatch
          </Button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.RESULTS) {
    const successes = results.filter((r) => r.status === "ok").length;
    const failures = results.filter((r) => r.status === "error").length;
    const text =
      failures > 0 ? `${successes} dispatched, ${failures} failed` : `${successes} dispatched`;

    return (
      <div className={footerClass}>
        <div>
          <span className={textClass}>{text}</span>
          {error && <p className={errorClass}>{error}</p>}
        </div>
        <div className={buttonsClass}>
          {failures > 0 && (
            <Button variant="outline" size="sm" onClick={onRetryFailed}>
              Retry Failed
            </Button>
          )}
          <Button variant="default" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
