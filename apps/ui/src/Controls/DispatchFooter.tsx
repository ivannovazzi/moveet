import type { DispatchAssignment, DirectionResult } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import styles from "./DispatchFooter.module.css";

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
}

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
}: DispatchFooterProps) {
  if (state === DispatchState.BROWSE) return null;

  if (state === DispatchState.SELECT) {
    return (
      <div className={styles.footer}>
        <span className={styles.text}>
          {selectedCount > 0
            ? `${selectedCount} selected \u2014 click map to add stops`
            : "Select vehicles to dispatch"}
        </span>
        <div className={styles.buttons}>
          <button type="button" className={styles.secondaryButton} onClick={onClear}>
            Exit
          </button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.ROUTE) {
    const vehicleCount = assignments.length;
    const stopCount = assignments.reduce((sum, a) => sum + a.waypoints.length, 0);

    return (
      <div className={styles.footer}>
        <span className={styles.text}>
          {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""}, {stopCount} stop
          {stopCount !== 1 ? "s" : ""}
        </span>
        <div className={styles.buttons}>
          <button type="button" className={styles.secondaryButton} onClick={onClear}>
            Clear
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={onDispatch}
            disabled={assignments.length === 0}
          >
            Dispatch
          </button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.DISPATCH) {
    return (
      <div className={styles.footer}>
        <span className={styles.text}>
          <span className={styles.spinner} />
          Dispatching...
        </span>
        <div className={styles.buttons}>
          <button type="button" className={styles.secondaryButton} disabled>
            Clear
          </button>
          <button type="button" className={styles.primaryButton} disabled>
            Dispatch
          </button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.RESULTS) {
    const successes = results.filter((r) => r.status === "ok").length;
    const failures = results.filter((r) => r.status === "error").length;
    const text =
      failures > 0
        ? `${successes} dispatched, ${failures} failed`
        : `${successes} dispatched`;

    return (
      <div className={styles.footer}>
        <span className={styles.text}>{text}</span>
        <div className={styles.buttons}>
          {failures > 0 && (
            <button type="button" className={styles.secondaryButton} onClick={onRetryFailed}>
              Retry Failed
            </button>
          )}
          <button type="button" className={styles.primaryButton} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return null;
}
