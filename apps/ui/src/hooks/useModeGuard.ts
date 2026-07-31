import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PendingModeChange {
  /** What the change would throw away, phrased as an object ("4-point zone"). */
  loses: string;
  run: () => void;
}

export interface ModeGuard {
  /** Set while a confirmation is on screen. */
  pending: PendingModeChange | null;
  /**
   * Run `action` now, or hold it behind a confirmation when the active mode is
   * carrying work that switching would destroy.
   */
  request: (action: () => void) => void;
  /** Run the held action. */
  confirm: () => void;
  /** Drop the held action and stay where we are. */
  dismiss: () => void;
}

/**
 * Guards the transitions that used to silently destroy in-flight map work:
 * clicking Fleet › Dispatch mid-polygon dropped every vertex, and Reset wiped a
 * dispatch selection with no warning. Entry points route through `request`, and
 * the dock renders the confirmation in its centre slot — the same place the
 * mode itself is reported, so the question appears where the work is.
 *
 * @param dirty What the active mode would lose, or `null` when it holds nothing
 *   (see `ModeDescriptor.dirty`).
 */
export function useModeGuard(dirty: string | null): ModeGuard {
  const [pending, setPending] = useState<PendingModeChange | null>(null);

  // Read at call time so `request` stays stable while a mode's dirtiness
  // changes on every vertex/selection.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const request = useCallback((action: () => void) => {
    const loses = dirtyRef.current;
    if (!loses) {
      action();
      return;
    }
    setPending({ loses, run: action });
  }, []);

  // Run outside the state updater: an effect inside one fires twice under
  // StrictMode, which would dispatch (or discard) the same thing twice.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const confirm = useCallback(() => {
    const held = pendingRef.current;
    setPending(null);
    held?.run();
  }, []);

  const dismiss = useCallback(() => setPending(null), []);

  // The mode let go of its work while we were asking (it finished, or the user
  // exited it another way). The obstacle is gone, so honour what was asked for
  // rather than making them click twice.
  useEffect(() => {
    if (dirty === null && pending) {
      pending.run();
      setPending(null);
    }
  }, [dirty, pending]);

  return useMemo(
    () => ({ pending, request, confirm, dismiss }),
    [pending, request, confirm, dismiss]
  );
}
