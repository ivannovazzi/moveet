import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface DockPanelProps {
  /** Whether the panel is open. Kept mounted while closed so morphing between
   * clusters animates the content, not the whole surface. */
  open: boolean;
  /**
   * Called on an outside click (clicks inside `dockRef` excluded). Escape is
   * NOT handled here — it routes through the app's single keyboard dispatcher
   * (useInteractionKeyboard), which closes the panel only when no mode or
   * selection is claiming the key first.
   */
  onClose: () => void;
  /**
   * Ref to the dock bar. Clicks on it are excluded from the outside-click
   * check — the dock's cluster buttons already own open/close/toggle, so
   * treating a cluster click as "outside" would close-then-reopen with a race.
   */
  dockRef: React.RefObject<HTMLElement | null>;
  /** Content key (the active cluster id) — drives the per-morph fade. */
  contentKey: string;
  children: React.ReactNode;
  "aria-label"?: string;
}

/**
 * The single morphing surface that opens in one fixed spot centered above the
 * dock (see the approved mockup). Every cluster renders into this same panel;
 * only the contents change, so the surface never jumps position or width. A
 * small down-notch visually ties it to the dock. Closes on an outside click
 * (Escape is the app dispatcher's call); entrance is the app's
 * `animate-scale-in` from a bottom origin.
 */
export default function DockPanel({
  open,
  onClose,
  dockRef,
  contentKey,
  children,
  ...rest
}: DockPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (dockRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose, dockRef]);

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={rest["aria-label"]}
      aria-hidden={!open}
      className={cn(
        "absolute bottom-[86px] left-1/2 z-40 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 origin-bottom",
        "overflow-hidden rounded-[10px] border border-border surface-glass-strong shadow-floating backdrop-blur-2xl backdrop-saturate-150",
        "transition-[opacity,transform] duration-normal ease-emphasized",
        open
          ? "pointer-events-auto animate-scale-in opacity-100"
          : "pointer-events-none translate-y-1.5 scale-[0.97] opacity-0"
      )}
    >
      {/* content wrapper keyed by cluster so switching clusters re-triggers a
          fast crossfade without re-animating the surface itself */}
      <div key={contentKey} className="animate-fade-in-fast">
        {children}
      </div>
      {/* down-notch tying the panel to the dock below it (glass-bot token so it
          matches the surface's bottom stop exactly) */}
      <div
        aria-hidden
        className="absolute -bottom-[5px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-glass-strong-bot backdrop-blur-2xl"
      />
    </div>
  );
}
