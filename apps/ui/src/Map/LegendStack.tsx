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
 * `FleetLegend` is the one exception: App renders it as a sibling of `Map`,
 * not as a child overlay, and has no way to hand it this stack's slot ref
 * without a change to App.tsx. `fleets` still has a reserved `LEGEND_ORDER`
 * slot for when that wiring exists, but today `FleetLegend` positions itself
 * (see its own file) rather than portalling in.
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
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** The stack element an overlay portals its legend into, once mounted. */
export type LegendSlot = RefObject<HTMLElement | null>;

/**
 * Where the column currently is, as a module store.
 *
 * The column used to be mounted by `Map` and handed down to the overlays as a
 * ref prop, which is why `FleetLegend` — a sibling of `Map`, not a child of it
 * — could never reach it and had to position itself. Now the shell owns the
 * column (it is the top half of the left region, see `ShellGrid`) and the
 * overlays are several levels down inside `DeckGLMap`, so a prop would have to
 * be threaded through the whole map tree to reach them.
 *
 * A plain store instead, the same shape as `mapInsets`: whoever mounts the
 * column publishes it, and anything with a legend subscribes. No provider, no
 * threading, and nothing has to know who its parent is.
 */
let legendHost: HTMLElement | null = null;
const hostListeners = new Set<() => void>();

function subscribeHost(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/** Test seam: the column element as the store currently has it. */
export function getLegendHost(): HTMLElement | null {
  return legendHost;
}

/** Publish the column element (or `null` as it unmounts). */
export function setLegendHost(el: HTMLElement | null): void {
  if (legendHost === el) return;
  legendHost = el;
  for (const listener of hostListeners) listener();
}

/**
 * The live column, as the ref-shaped slot `renderInSlot` takes. `null` until
 * the column has mounted, and on the server, which is the cue to render the
 * legend where it stands instead.
 */
export function useLegendSlot(): LegendSlot {
  const host = useSyncExternalStore(
    subscribeHost,
    () => legendHost,
    () => null
  );
  return useMemo(() => ({ current: host }), [host]);
}

/**
 * Reading order of the column, top to bottom.
 *
 * Portal insertion order is *mount* order, not tree order: the overlays are
 * lazy chunks that resolve in whatever order the network hands them over, and
 * toggling one off and on again moves it to the bottom of the DOM. Flex
 * `order` fixes the column regardless, and it works across portalled children
 * because they are all real children of the flex container.
 */
export const LEGEND_ORDER = { density: 0, traffic: 1, heat: 2, fleets: 3 } as const;

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
      setLegendHost(el);
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
        // No height budget any more. The stack is the top half of the shell's
        // left column (see `ShellGrid`), so the search band above it and the
        // dock below it are grid tracks rather than three clearance tokens
        // this had to subtract by hand, and the visibility rail it shares the
        // column with takes its own half. `min-h-0` is what lets the inner
        // scroller shrink inside that half.
        "flex min-h-0 w-[164px] flex-col",
        // Click-through, always: this box covers a tall strip of the map even
        // when it holds one short legend, and the map underneath has to stay
        // draggable.
        "pointer-events-none",
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
