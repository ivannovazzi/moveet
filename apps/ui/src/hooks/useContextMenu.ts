import { useCallback, useEffect, useRef, useState } from "react";

interface XY {
  x: number;
  y: number;
}

export default function useContextMenu(): [
  React.MouseEventHandler,
  React.RefObject<HTMLDivElement | null>,
  XY | null,
  () => void,
] {
  const [position, setPosition] = useState<XY | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPosition(null);
      }
    };

    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return [handleContextMenu, ref, position, () => setPosition(null)];
}
