import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Modifiers } from "@/types";
import type { HeatzoneEditorMode } from "./useHeatzoneEditor";

/**
 * Reveals the manual-heatzone layer when the user starts working with zones,
 * without permanently pinning the `showHeatzones` toggle.
 *
 * Two one-shot edges force visibility on:
 *  - entering draw/select (mode transitions idle -> non-idle)
 *  - a successful seed (seedNonce increments)
 *
 * Both are EDGE-triggered: after the layer is revealed the user is free to
 * toggle it back off, even while a zone is still selected or draw mode is
 * active. A continuous (level-triggered) effect would immediately flip the
 * toggle back on and make the control look broken.
 */
export function useHeatzoneAutoReveal(
  mode: HeatzoneEditorMode,
  seedNonce: number,
  setModifiers: Dispatch<SetStateAction<Modifiers>>
): void {
  const reveal = () =>
    setModifiers((prev) => (prev.showHeatzones ? prev : { ...prev, showHeatzones: true }));
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  // Enter draw/select from idle: reveal once on the transition only.
  const prevMode = useRef(mode);
  useEffect(() => {
    const wasIdle = prevMode.current === "idle";
    prevMode.current = mode;
    if (wasIdle && mode !== "idle") revealRef.current();
  }, [mode]);

  // Successful seed: reveal once per nonce increment.
  const seededOnce = useRef(seedNonce);
  useEffect(() => {
    if (seedNonce > seededOnce.current) {
      seededOnce.current = seedNonce;
      revealRef.current();
    }
  }, [seedNonce]);
}
