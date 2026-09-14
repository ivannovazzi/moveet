import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import DockSurface from "./DockSurface";
import { useAnchorOffset } from "./dockRowLayout";

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
  /** Tailwind width class. One width per surface — never per view. */
  width: string;
  /** Re-measure when this changes. */
  positionKey: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Nudge left of the anchor so the panel's padding lines up under it. */
const ANCHOR_INSET = 10;

/**
 * The dock's one floating surface: the Tempo popover. Same glass, same blur,
 * same edge as the bar it belongs to, anchored to the button that opened it
 * with a short accent pointer running back down to it — so the relationship
 * between a lit key and the surface it produced stays literal.
 *
 * The four section panels used to be this component too, and that is what made
 * it complicated: aligned to the bar's right edge instead of to a key, pushed
 * sideways by an open inspector, and reporting the band of map it covered back
 * to `mapInsets` so the camera could aim around it. They are the console now
 * (see `shell/Console`), which holds its own space — so all of that went with
 * them, and what is left is a popover.
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
  width,
  positionKey,
  onClose,
  children,
  ...rest
}: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { offset, pointer } = useAnchorOffset(originRef, anchorRef, panelRef, {
    active: open,
    key: `${positionKey}:${width}`,
    inset: ANCHOR_INSET,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (originRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose, originRef]);

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
