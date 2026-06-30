import { useCallback, useState } from "react";

interface XY {
  x: number;
  y: number;
}

/**
 * Tracks the open state + cursor anchor of the map context menu.
 *
 * Positioning, outside-click, Escape, focus management and collision handling
 * now live in the Radix-backed `ContextMenu` surface; this hook only captures
 * the right-click coordinate and exposes open/close. The right-click is wired
 * through deck.gl (`onMapContextClick`) so the projected lat/lng is captured
 * alongside the screen point.
 */
export default function useContextMenu(): [React.MouseEventHandler, XY | null, () => void] {
  const [position, setPosition] = useState<XY | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPosition(null), []);

  return [handleContextMenu, position, close];
}
