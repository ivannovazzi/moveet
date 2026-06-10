import { useEffect } from "react";
import { DispatchState } from "./useDispatchState";
import type { DispatchFlow } from "./useDispatchFlow";

/**
 * Keyboard shortcuts while in dispatch mode: Enter dispatches, Esc exits.
 *
 * Destructures the specific (stable) fields used so the effect depends on
 * them rather than the whole `dispatch` object — which is a fresh literal
 * every render and would otherwise re-subscribe the window listener constantly.
 *
 * Extracted from App.tsx — behavior preserved verbatim.
 */
export function useDispatchShortcuts(dispatch: DispatchFlow): void {
  const { dispatchMode, dispatchState, handleDone, handleDispatch } = dispatch;
  const assignmentCount = dispatch.assignments.length;

  useEffect(() => {
    if (!dispatchMode) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept while typing in inputs/textareas.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleDone();
      } else if (e.key === "Enter") {
        if (dispatchState === DispatchState.ROUTE && assignmentCount > 0) {
          e.preventDefault();
          void handleDispatch();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatchMode, dispatchState, assignmentCount, handleDone, handleDispatch]);
}
