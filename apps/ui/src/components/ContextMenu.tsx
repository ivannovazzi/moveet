import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusScope } from "@react-aria/focus";
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
    <FocusScope autoFocus contain restoreFocus>
      <div
        ref={menuRef}
        role="menu"
        aria-label="Context menu"
        className={styles.menu}
        style={{ position: "fixed", top: adjustedPosition.y, left: adjustedPosition.x, zIndex: 1000 }}
      >
        {children}
      </div>
    </FocusScope>,
    document.body
  );
}
