import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./ContextMenu.module.css";

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

  // Focus first item on open
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const first = menu.querySelector<HTMLElement>(
      '[role="menuitem"]:not([disabled]), button:not([disabled])'
    );
    first?.focus();
  }, []);

  // Keyboard handling: Escape closes, Arrow keys navigate
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
        );
        if (items.length === 0) return;
        const current = document.activeElement as HTMLElement;
        const idx = items.indexOf(current);
        if (e.key === "ArrowDown") {
          items[(idx + 1) % items.length]?.focus();
        } else {
          items[(idx - 1 + items.length) % items.length]?.focus();
        }
        return;
      }

      // Tab cycles through items
      if (e.key === "Tab") {
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>(
            'button, [href], input, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
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
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className={styles.menu}
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
}
