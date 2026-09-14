import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How wide the console is, and the drag that changes it.
 *
 * The console takes real layout space rather than floating over the map, so its
 * width is the operator's to set the way a browser's dev tools are: drag the
 * edge, and it is still that wide tomorrow. That is the whole reason the width
 * is state here instead of a constant — a floating panel's width is a design
 * decision, a docked one's is a preference.
 */

/** Narrower than this and the vehicle list's rows start wrapping. */
export const CONSOLE_MIN_WIDTH = 320;

/** Wide enough for the analytics charts, which were the worst served before. */
export const CONSOLE_DEFAULT_WIDTH = 420;

/**
 * The console may take a little over half the window and no more. Past that the
 * map stops being the thing you are working on, and deck.gl is left rendering a
 * sliver — the same reasoning as `MIN_VISIBLE` in `mapInsets`.
 */
export const CONSOLE_MAX_FRACTION = 0.55;

const WIDTH_KEY = "moveet.console.width";

/** Every storage read is a `try` — Safari's private mode throws on access. */
function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    if (!raw) return CONSOLE_DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : CONSOLE_DEFAULT_WIDTH;
  } catch {
    return CONSOLE_DEFAULT_WIDTH;
  }
}

function writeStoredWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // A preference that cannot be saved is not worth failing a drag over.
  }
}

/** The widest the console may be right now, given the window it is in. */
export function maxConsoleWidth(viewportWidth: number): number {
  return Math.max(CONSOLE_MIN_WIDTH, Math.round(viewportWidth * CONSOLE_MAX_FRACTION));
}

export function clampConsoleWidth(width: number, viewportWidth: number): number {
  return Math.min(Math.max(Math.round(width), CONSOLE_MIN_WIDTH), maxConsoleWidth(viewportWidth));
}

export interface ConsoleSize {
  width: number;
  /** True while the edge is being dragged — the map suppresses its own cursor. */
  dragging: boolean;
  /** `onPointerDown` for the drag handle. */
  startDrag: (event: React.PointerEvent<HTMLElement>) => void;
  /** Double-click the handle: back to the default width. */
  resetWidth: () => void;
}

export function useConsoleSize(): ConsoleSize {
  const [width, setWidth] = useState<number>(() =>
    clampConsoleWidth(readStoredWidth(), typeof window === "undefined" ? 1440 : window.innerWidth)
  );
  const [dragging, setDragging] = useState(false);

  // The pending width of the frame in flight. A pointermove can fire several
  // times per frame, and every commit resizes the deck.gl canvas and its GL
  // viewport — so moves coalesce into one `setWidth` per frame instead.
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const commit = useCallback(() => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next !== null) setWidth(next);
  }, []);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture?.(event.pointerId);
      setDragging(true);

      // The console is flush with the window's right edge, so its width is
      // simply how far the pointer is from that edge. No offset to carry, and
      // no drift if the pointer leaves the handle mid-drag.
      const onMove = (move: PointerEvent) => {
        pendingRef.current = clampConsoleWidth(window.innerWidth - move.clientX, window.innerWidth);
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(commit);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          commit();
        }
        setDragging(false);
        handle.releasePointerCapture?.(event.pointerId);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [commit]
  );

  // Persist on settle, not per frame: a drag across the window would otherwise
  // be a few hundred synchronous storage writes.
  useEffect(() => {
    if (dragging) return;
    writeStoredWidth(width);
  }, [dragging, width]);

  // A window narrowed past the console's share takes the width down with it.
  // Without this the console keeps a width the window no longer has and the map
  // is squeezed to nothing.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampConsoleWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resetWidth = useCallback(
    () => setWidth(clampConsoleWidth(CONSOLE_DEFAULT_WIDTH, window.innerWidth)),
    []
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  return { width, dragging, startDrag, resetWidth };
}
