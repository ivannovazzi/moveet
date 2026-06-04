import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useLayoutEffect(() => {
    if (!menuRef.current || !position) return;
    const rect = menuRef.current.getBoundingClientRect();
    const adjusted = { ...position };
    if (rect.right > window.innerWidth) {
      adjusted.x = position.x - rect.width;
    }
    if (rect.bottom > window.innerHeight) {
      adjusted.y = position.y - rect.height;
    }
    adjusted.x = Math.max(0, adjusted.x);
    adjusted.y = Math.max(0, adjusted.y);
    setAdjustedPosition(adjusted);
  }, [position]);

  const getFocusable = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );

  // Move focus to the first focusable element on open
  useEffect(() => {
    if (!position) return;
    const focusable = getFocusable();
    (focusable[0] ?? menuRef.current)?.focus();
  }, [position]);

  // Trap Tab focus within the menu (wrap at both ends)
  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      tabIndex={-1}
      onKeyDown={handleTabKey}
      className="flex min-w-[180px] flex-col gap-1 rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-md outline-none backdrop-blur-md"
      style={{
        position: "fixed",
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
