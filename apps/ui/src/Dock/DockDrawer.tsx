import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface DockDrawerProps {
  /** Whether the drawer is mounted/visible. */
  open: boolean;
  /** Called on Escape or an outside click while open. */
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Accessible label for the drawer's `role="dialog"` region. */
  "aria-label"?: string;
  /**
   * Horizontal alignment relative to the drawer's positioning ancestor
   * (expected to be the `relative`-positioned wrapper around the dock
   * cluster button that opens it). Defaults to centered above the anchor.
   */
  align?: "left" | "center" | "right";
  /**
   * Ref to the trigger element that opens/toggles this drawer. Clicks on it
   * are excluded from the outside-click check — the trigger's own `onClick`
   * already owns open/close/toggle, so treating it as "outside" would
   * immediately reopen a drawer it just closed (or vice versa).
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "left-0",
  center: "left-1/2 -translate-x-1/2",
  right: "right-0",
};

/**
 * Shared anchored-drawer shell: a compact floating panel positioned just
 * above its dock cluster (never full height), styled to match
 * `Controls/BottomDock.tsx`'s glass/blur/shadow treatment but with
 * `shadow-floating` (the "above the map" token used by dialogs/menus)
 * instead of the dock's own `shadow-elevated`, since drawers float above
 * the dock rather than sitting docked themselves.
 *
 * Closes on outside-click and Escape. Uses the `animate-scale-in`
 * popover/menu entrance (see `Typeahead.tsx`'s `CommandList`) rather than
 * the old side-panels' slide-in, since drawers are popover-like now.
 *
 * Positioning is intentionally left to the caller: render this inside a
 * `relative`-positioned wrapper around the triggering `DockCluster` so
 * `absolute bottom-full` anchors correctly above that specific cluster.
 */
export default function DockDrawer({
  open,
  onClose,
  children,
  className,
  align = "center",
  anchorRef,
  ...rest
}: DockDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (drawerRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label={rest["aria-label"]}
      className={cn(
        "absolute bottom-full z-40 mb-3 max-h-[70vh] origin-bottom animate-scale-in overflow-y-auto",
        "rounded-lg border border-border surface-glass shadow-floating backdrop-blur-md",
        ALIGN_CLASS[align],
        className
      )}
    >
      {children}
    </div>
  );
}
