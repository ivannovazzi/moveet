import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Cursor-anchored context menu surface, backed by the Radix DropdownMenu
 * primitive (collision-aware positioning, arrow-key navigation, typeahead,
 * Escape, outside-click and focus return all come from Radix).
 *
 * We can't use Radix's native `ContextMenu` because the right-click must first
 * pass through deck.gl so the map position (lat/lng) is captured. Instead this
 * is a *controlled* DropdownMenu whose `open` is driven by `position`, anchored
 * to a zero-size, pointer-transparent trigger placed at the cursor point.
 *
 * `modal={false}` keeps the rest of the UI (and the map) interactive while the
 * menu is open and lets an outside click / another right-click dismiss it.
 */
export default function ContextMenu({
  position,
  children,
  onClose,
}: {
  position: { x: number; y: number } | null;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const open = position !== null;

  return (
    <DropdownMenu
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          style={{
            position: "fixed",
            left: position?.x ?? 0,
            top: position?.y ?? 0,
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        aria-label="Context menu"
        // Anchor is an invisible point; don't yank focus back to it on close.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
