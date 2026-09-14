import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Keep a surface mounted long enough to animate itself away.
 *
 * Every surface in the shell used to enter with `animate-scale-in` and leave by
 * being unmounted on the same frame it was closed — so every open was
 * considered and every close was a hard pop. React will not wait for a
 * transition before removing an element, so something has to hold the element
 * on screen while it fades; that is all this does.
 *
 * Four states rather than two, because the entrance and the exit are not the
 * same gesture reversed:
 *
 *   entering  the starting frame — transparent and offset, no transition yet
 *   open      settled; this is the frame the entrance transitions *to*
 *   closing   transparent again, but *not* offset: a surface that slid back out
 *             the way it came would read as being put away, and most of these
 *             are dismissed rather than returned. Opacity alone, and faster.
 *   closed    gone; the caller renders nothing
 *
 * Reduced motion needs no special case here: the global guard in `index.css`
 * collapses every duration to 0.01ms, so the states still run, instantly.
 */
export type PresenceState = "entering" | "open" | "closing" | "closed";

/** Matches `--transition-duration-fast`, the exit half of the motion scale. */
export const PRESENCE_EXIT_MS = 150;

export function usePresence(open: boolean, exitMs: number = PRESENCE_EXIT_MS): PresenceState {
  const [state, setState] = useState<PresenceState>(open ? "entering" : "closed");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (open) {
      // Paint the starting frame first, then settle — one is the transition's
      // `from` and the other its `to`, and they cannot be the same frame.
      setState((current) => (current === "open" ? current : "entering"));
      const raf = requestAnimationFrame(() => setState("open"));
      return () => cancelAnimationFrame(raf);
    }

    // Nothing to animate away from a surface that was never up.
    let cancelled = false;
    setState((current) => {
      if (current === "closed" || current === "entering") {
        cancelled = true;
        return "closed";
      }
      return "closing";
    });
    if (cancelled) return;
    timerRef.current = setTimeout(() => setState("closed"), exitMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [open, exitMs]);

  return state;
}

/** The 8px a surface travels on the way in, from the edge it belongs to. */
const ENTER_FROM = {
  top: "-translate-y-2",
  bottom: "translate-y-2",
  left: "-translate-x-2",
  right: "translate-x-2",
  none: "",
} as const;

export type PresenceEdge = keyof typeof ENTER_FROM;

/**
 * The shell's one motion rule, as classes: in from an edge over 250ms on the
 * emphasized curve, out on opacity alone over 150ms on the exit curve.
 *
 * One place, so a new surface cannot arrive with a motion of its own — which is
 * how the app ended up with a 400ms `fade-up`, a 250ms `scale-in`, a 150ms
 * `fade-in-fast` and several surfaces with no exit at all.
 */
export function presenceClass(state: PresenceState, edge: PresenceEdge = "top"): string {
  return cn(
    state === "entering" && cn("opacity-0", ENTER_FROM[edge]),
    // `translate`, not `transform`: Tailwind v4's `translate-*` utilities set
    // the individual `translate` property, so a transition list naming only
    // `transform` would fade the surface in while snapping it into place.
    state === "open" &&
      "translate-none opacity-100 transition-[opacity,translate] duration-normal ease-emphasized",
    // Leaving: opacity only, and quicker. A surface that slid back out the way
    // it came would read as being put away rather than dismissed.
    state === "closing" &&
      "pointer-events-none opacity-0 transition-opacity duration-fast ease-exit"
  );
}
