import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import DockSurface from "./DockSurface";
import { useAnchorOffset } from "./dockRowLayout";

export interface AnchoredPanelProps {
  open: boolean;
  /** DOM id, so the button that opens it can own `aria-controls`. */
  id: string;
  "aria-label"?: string;
  /** Micro-caps eyebrow, e.g. `Monitor › Faults`. Names the panel to itself. */
  eyebrow?: string;
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
  /** Tailwind width class from the section registry. */
  width: string;
  /** Re-measure when this changes (the open section and its lit view). */
  positionKey: string;
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
 */
export default function AnchoredPanel({
  open,
  id,
  eyebrow,
  anchorRef,
  originRef,
  ignoreRef,
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
        {eyebrow && (
          <div className="flex items-center justify-between gap-2 border-b border-border-soft px-[13px] py-2">
            <span className="truncate text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/75">
              {eyebrow}
            </span>
          </div>
        )}
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
