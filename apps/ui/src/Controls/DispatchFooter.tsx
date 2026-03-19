import { Button } from "react-aria-components";
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
  error?: string | null;
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
  error,
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
          <Button className={styles.secondaryButton} onPress={onClear}>
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
      <div className={styles.footer}>
        <span className={styles.text}>
          {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""}, {stopCount} stop
          {stopCount !== 1 ? "s" : ""}
        </span>
        <div className={styles.buttons}>
          <Button className={styles.secondaryButton} onPress={onClear}>
            Clear
          </Button>
          <Button
            className={styles.primaryButton}
            onPress={onDispatch}
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
      <div className={styles.footer}>
        <div>
          <span className={styles.text}>
            <span className={styles.spinner} />
            Dispatching...
          </span>
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
        <div className={styles.buttons}>
          <Button className={styles.secondaryButton} isDisabled>
            Clear
          </Button>
          <Button className={styles.primaryButton} isDisabled>
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
      <div className={styles.footer}>
        <div>
          <span className={styles.text}>{text}</span>
          {error && <p className={styles.errorText}>{error}</p>}
        </div>
        <div className={styles.buttons}>
          {failures > 0 && (
            <Button className={styles.secondaryButton} onPress={onRetryFailed}>
              Retry Failed
            </Button>
          )}
          <Button className={styles.primaryButton} onPress={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
