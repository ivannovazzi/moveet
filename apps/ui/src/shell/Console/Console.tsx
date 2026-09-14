import { cn } from "@/lib/utils";
import { PanelHeaderRow } from "@/Dock/DockPanelKit";
import { presenceClass, usePresence } from "../usePresence";
import { useConsoleSize } from "./useConsoleSize";

/**
 * The console: everything that is read or configured rather than pointed at.
 *
 * The four section panels used to float above the dock's right wing, anchored
 * to the key that opened them, and the inspector floated at the map's right
 * edge. Two independently-placed surfaces over the same corner, each clamped
 * away from the other by hand — and below roughly 1400px the clamp collapsed
 * and the panel landed underneath the inspector.
 *
 * A console cannot have that bug. It takes real layout space in the shell's
 * flex row instead of overlaying the map: the map is narrower while it is open,
 * and there is no longer a second surface over the same pixels to clamp against.
 * That is also what retires most of `mapInsets` — a camera aiming at the centre
 * of the deck.gl canvas is already aiming at the centre of the visible map,
 * because the canvas *is* the visible map.
 *
 * It is one occupant at a time, like the dev tools it is modelled on: the tab
 * bar switches what is in it, and the dock's section keys are a second way to
 * reach the same tabs. Closed, it renders nothing at all — a zero-width
 * container would still be a flex child with a border on it.
 */
export interface ConsoleProps {
  open: boolean;
  /** The open section's name, shown as the console's title. */
  title: string;
  icon?: React.ReactNode;
  /** The tab strip for the open section. */
  tabs?: React.ReactNode;
  /** Header slot before the close button — a health chip, a count. */
  headerRight?: React.ReactNode;
  /**
   * Re-mounts the body's entrance when it changes. The console stays put while
   * the operator steps between sections, so the contents are what should read
   * as having changed.
   */
  bodyKey?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function Console({
  open,
  title,
  icon,
  tabs,
  headerRight,
  bodyKey,
  onClose,
  children,
}: ConsoleProps) {
  const { width, dragging, startDrag, resetWidth } = useConsoleSize();
  // Held on screen while it fades, like every other shell surface (see
  // `usePresence`). It keeps its width for those 150ms rather than animating it
  // away: a width transition would resize the deck.gl drawing buffer on every
  // frame of the close, which is the one thing an 8000-vehicle map cannot
  // afford to do for free.
  const state = usePresence(open);

  if (state === "closed") return null;

  return (
    <aside
      data-console=""
      // The section keys own `aria-controls` against this id.
      id="console-panel"
      // Named for what it is showing, not for the furniture: "Monitor" is what
      // the operator asked for and what a screen reader should announce on
      // entering it. `region` rather than `aside`'s implicit `complementary` —
      // this is the working surface, not an aside to one.
      role="region"
      aria-label={title}
      data-state={state}
      style={{ width }}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l border-border bg-card",
        presenceClass(state, "right")
      )}
    >
      <button
        type="button"
        aria-label="Resize console"
        aria-orientation="vertical"
        onPointerDown={startDrag}
        onDoubleClick={resetWidth}
        // The handle is 8px of grab area hanging over the map, with a 1px line
        // drawn inside it: a border you can actually hit without a border that
        // looks 8px thick.
        className={cn(
          "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none",
          "before:absolute before:inset-y-0 before:left-1 before:w-px before:bg-transparent",
          "before:transition-colors before:duration-fast before:ease-standard",
          "hover:before:bg-accent focus-visible:outline-none focus-visible:before:bg-accent",
          dragging && "before:bg-accent"
        )}
      />

      <PanelHeaderRow
        icon={icon}
        title={title}
        right={headerRight}
        onClose={onClose}
        // Named for what closing it takes away, so the control reads the same
        // whether you reach it by eye or by screen reader.
        closeLabel={`Close ${title}`}
      >
        {tabs}
      </PanelHeaderRow>

      <div
        key={bodyKey}
        data-console-body=""
        // `overflow-hidden`, like the panel surface these views used to live
        // on: each one owns its own scrolling (the vehicle list virtualizes,
        // the inspector pins an identity block above a scroller), and an outer
        // scroller would give several of them a second scrollbar.
        className="flex min-h-0 flex-1 animate-fade-in-fast flex-col overflow-hidden"
      >
        {children}
      </div>
    </aside>
  );
}
