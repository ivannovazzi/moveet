import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { clearInset, setInset, type MapInsets } from "@/components/Map/mapInsets";
import DockSurface from "./DockSurface";
import { useAnchorOffset, type AnchorAlign } from "./dockRowLayout";

export interface AnchoredPanelProps {
  open: boolean;
  /** DOM id, so the button that opens it can own `aria-controls`. */
  id: string;
  "aria-label"?: string;
  /**
   * The panel's single header row (see `PanelHeaderRow`): what it is, its own
   * switch, and the way out. There is no second heading inside the body.
   */
  header?: React.ReactNode;
  /**
   * The button the panel belongs to. Its left edge lines the panel up, and its
   * centre is where the panel draws its pointer.
   */
  anchorRef: React.RefObject<HTMLElement | null>;
  /**
   * The bar the panel floats above. The positioning origin, and exempt from the
   * outside-click check since its buttons already own open/close.
   */
  originRef: React.RefObject<HTMLElement | null>;
  /**
   * Also exempt from the outside-click check — the bar whose buttons opened
   * this panel, when it isn't the origin.
   */
  ignoreRef?: React.RefObject<HTMLElement | null>;
  /** Tailwind width class. One width per surface — never per view. */
  width: string;
  /**
   * Which edge holds still: the anchor button's (default) or the origin bar's
   * right edge. See `AnchorAlign`.
   */
  align?: AnchorAlign;
  /** Re-measure when this changes (the open section and its lit view). */
  positionKey: string;
  /**
   * Report the band of map this panel covers under this key while it is open,
   * so camera moves aim around it (see `mapInsets`). Panels that cover a corner
   * worth steering clear of opt in; a small transient one (Tempo) does not.
   */
  insetKey?: string;
  /** A `mapInsets` contributor (the inspector) this panel is placed clear of. */
  avoidInsetKey?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Nudge left of the anchor so the panel's padding lines up under it. */
const ANCHOR_INSET = 10;

/**
 * Every panel in the dock is this component: same glass, same blur, same edge,
 * anchored to the button that opened it with a short accent pointer running
 * back down to it. That pointer is the dock's signature — it makes the
 * relationship between a lit key and the surface it produced literal, instead
 * of leaving a panel floating in the middle of the screen with no parent (which
 * is what the single centred 384px panel used to do).
 *
 * IMPORTANT: mount it *beside* the bar it belongs to, never inside it. An
 * ancestor with `backdrop-filter` (every dock bar has one) becomes a backdrop
 * root, and a nested panel then blurs that ancestor's empty content instead of
 * the map — the glass turns into a flat translucent slab with sharp road lines
 * showing through. `originRef` still points at the bar, so the anchoring maths
 * is unaffected by living one level out.
 */
export default function AnchoredPanel({
  open,
  id,
  header,
  anchorRef,
  originRef,
  ignoreRef,
  width,
  align = "anchor",
  positionKey,
  insetKey,
  avoidInsetKey,
  onClose,
  children,
  ...rest
}: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, pointer } = useAnchorOffset(originRef, anchorRef, panelRef, {
    active: open,
    key: `${positionKey}:${width}`,
    inset: ANCHOR_INSET,
    align,
    avoidInsetKey,
  });

  // What this panel covers, measured rather than assumed: it is positioned at
  // run time (`useAnchorOffset` clamps it inside the viewport) and its height is
  // its contents'. The right band is everything from the panel's left edge to
  // the viewport's right edge; the bottom band is everything below its top edge,
  // which already includes the gap down to the dock it stands on.
  // `offset` and `positionKey` are in the dependency list as re-measure
  // triggers rather than as values read in here: the panel is placed by
  // `useAnchorOffset`, so its box is only final once those have settled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure triggers, see above.
  useEffect(() => {
    if (!insetKey) return;
    if (!open) {
      clearInset(insetKey);
      return;
    }
    const measure = () => {
      const element = panelRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // The right band only. The panel also covers a slab above the dock, but
      // claiming that as a bottom band would leave no visible height at all
      // (the panel is most of the viewport tall), and the map to the left of
      // it is exactly where the camera should aim.
      const insets: Partial<MapInsets> = {
        right: Math.max(0, window.innerWidth - rect.left),
      };
      setInset(insetKey, insets);
    };
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      clearInset(insetKey);
    };
  }, [insetKey, open, offset, positionKey]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (originRef.current?.contains(target)) return;
      if (ignoreRef?.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose, originRef, ignoreRef]);

  return (
    <div
      ref={panelRef}
      style={{ transform: `translateX(${offset}px)` }}
      className={cn(
        "absolute bottom-[calc(100%+12px)] left-0 z-40",
        "transition-opacity duration-normal ease-emphasized",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      )}
    >
      <DockSurface
        variant="panel"
        id={id}
        role="region"
        aria-label={rest["aria-label"]}
        aria-hidden={!open}
        // Kept mounted so switching views morphs the contents rather than
        // remounting the surface; `inert` keeps a closed panel's controls out of
        // the tab order (they used to be focusable under aria-hidden).
        inert={!open}
        className={cn(
          "origin-bottom-left max-w-[calc(100vw-1.5rem)]",
          open && "motion-safe:animate-scale-in",
          width
        )}
      >
        {header}
        <div key={positionKey} className="animate-fade-in-fast">
          {children}
        </div>
      </DockSurface>

      {/* Pointer back to the key that produced this panel. */}
      {pointer !== null && (
        <span
          aria-hidden
          style={{ left: pointer }}
          className="absolute -bottom-[11px] h-[11px] w-[2px] -translate-x-1/2 rounded-full bg-gradient-to-b from-accent/70 to-accent/0"
        />
      )}
    </div>
  );
}
