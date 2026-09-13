/**
 * The one place map legends live.
 *
 * Each overlay used to position its own legend absolutely, which meant every
 * new overlay had to know about every other one's coordinates — and got it
 * wrong: with Density and Traffic both lit, the traffic legend landed on top
 * of the vertically-centred visibility rail at a 1000px window.
 *
 * So legends no longer place themselves. They render into this column, which
 * owns the top-left slot under the search bar and grows *down*. The visibility
 * rail is anchored to the bottom-left and grows *up* (see `VisibilityRail`),
 * and the stack's `max-height` reserves that band, so the two can never meet
 * however many overlays are on.
 *
 * Overlay components must stay children of `DeckGLMap` (that is where they
 * register their deck.gl layers), so they can't be moved into this subtree.
 * They portal their legend here instead, via `renderInSlot`.
 *
 * The wrapper renders unconditionally, so on a quiet map it is an empty,
 * zero-height, click-through box: harmless visually, and it can't hide itself
 * from assistive tech (`aria-hidden` would have to be driven by children it
 * never sees, since they arrive by portal). An empty `role="group"` with no
 * owned elements is announced by nothing.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** The stack element an overlay portals its legend into, once mounted. */
export type LegendSlot = RefObject<HTMLElement | null>;

/**
 * Reading order of the column, top to bottom.
 *
 * Portal insertion order is *mount* order, not tree order: the overlays are
 * lazy chunks that resolve in whatever order the network hands them over, and
 * toggling one off and on again moves it to the bottom of the DOM. Flex
 * `order` fixes the column regardless, and it works across portalled children
 * because they are all real children of the flex container.
 */
export const LEGEND_ORDER = { density: 0, traffic: 1, heat: 2 } as const;

export type LegendKey = keyof typeof LEGEND_ORDER;

/**
 * Portal `legend` into the stack, or render it where it stands when there is
 * no stack (unit tests, and the first paint before the ref is attached).
 * A plain function, not a hook — it is called from JSX.
 *
 * The wrapper is `pointer-events-none` like everything else in the column: it
 * sits over the deck canvas, and a legend that swallowed the pointer would
 * break map drag under it. Legends are read, not operated.
 */
export function renderInSlot(
  slot: LegendSlot | undefined,
  slotKey: LegendKey,
  legend: ReactNode
): ReactNode {
  const positioned = (
    <div
      className="pointer-events-none"
      style={{ order: LEGEND_ORDER[slotKey] }}
      data-legend-slot={slotKey}
    >
      {legend}
    </div>
  );
  const host = slot?.current;
  return host ? createPortal(positioned, host) : positioned;
}

interface LegendStackProps {
  children?: ReactNode;
  /** React 19 ref-as-prop — Map hands this to the overlays as their slot. */
  ref?: Ref<HTMLDivElement>;
}

export default function LegendStack({ children, ref }: LegendStackProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  // The column is both the portal host (so flex `order` applies to portalled
  // children) and the element we measure, so the caller's ref and ours share
  // one callback.
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      columnRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  // Only a column that has actually run out of room may take the pointer, and
  // then only on the column itself (never the outer box, which spans the whole
  // height budget whether or not anything is in it). `useResizeObserver` is not
  // reusable here: it owns its own ref and reports the content box, and the
  // question is `scrollHeight > clientHeight`. Legends arriving while the
  // column is already clamped cannot change the verdict, and ones that leave
  // shrink the box, which is what the observer fires on.
  useEffect(() => {
    const el = columnRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      role="group"
      aria-label="Map legends"
      className={[
        // Height budget, measured rather than guessed:
        //   72px   search bar + its gap (the stack's own top offset)
        //   88px   --spacing-above-dock, the dock shelf
        //   448px  --legend-stack-clearance (the visibility rail's band):
        //          11 keys x 34px = 374, + 10 x 2px gaps = 20, + 8px padding
        //          = 402, + ~31px for the trail and density chips, + the
        //          rail's own 12px lift off the shelf.
        // Percentage, not vh: the stack is positioned against the map pane
        // (`map-backdrop`), which is shorter than the viewport by the header.
        // The `max()` floor matters on a short pane: at 608px the subtraction
        // goes negative and a bare calc would clamp the column to nothing,
        // hiding every legend rather than scrolling them.
        "max-h-[max(140px,calc(100%-72px-var(--spacing-above-dock)-var(--legend-stack-clearance)))]",
        // Click-through, always: this box covers a tall strip of the map even
        // when it holds one short legend, and the map underneath has to stay
        // draggable.
        "pointer-events-none absolute left-3 top-[72px] z-10 flex w-[164px] flex-col",
      ].join(" ")}
    >
      <div
        ref={attach}
        className={[
          "flex max-h-full min-h-0 flex-col gap-2",
          // That budget leaves room for roughly one legend on a 700px-tall map,
          // so the column scrolls rather than clipping the third one away — and
          // only then does it need the pointer, to catch the wheel and the
          // scrollbar. Below that it stays click-through like its parent.
          overflowing
            ? "pointer-events-auto overflow-y-auto overscroll-contain [scrollbar-width:thin]"
            : "overflow-hidden",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
