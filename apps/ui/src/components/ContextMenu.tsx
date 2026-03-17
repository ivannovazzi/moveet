import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

export default function ContextMenu({
  position,
  children,
  onClose,
}: {
  position: { x: number; y: number };
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key === "Tab") {
        const menu = menuRef.current;
        if (!menu) return;

        const focusable = menu.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  // Focus the first focusable element when the menu opens
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const focusable = menu.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  if (!position) return null;
  const portal = createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      style={{
        position: "fixed",
        top: position.y,
        left: position.x,
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body
  );

  return portal;
}
