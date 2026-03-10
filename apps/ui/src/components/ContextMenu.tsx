import { createPortal } from "react-dom";

export default function ContextMenu({
  position,
  children,
}: {
  position: { x: number; y: number };
  children: React.ReactNode;
}) {
  if (!position) return null;
  const portal = createPortal(
    <div
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
