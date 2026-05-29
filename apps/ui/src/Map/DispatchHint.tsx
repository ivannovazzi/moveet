import { createPortal } from "react-dom";
import { useOverlay } from "@/components/Map/hooks";
import { DispatchState } from "@/hooks/useDispatchState";

interface DispatchHintProps {
  state: DispatchState;
  selectedCount: number;
  stopCount: number;
}

/**
 * Map-level hint banner for the dispatch flow — mirrors the geofence draw
 * hint so actions stay discoverable without having to look at the side panel.
 */
export default function DispatchHint({ state, selectedCount, stopCount }: DispatchHintProps) {
  const { mapHTMLElement } = useOverlay();
  if (!mapHTMLElement) return null;
  if (state === DispatchState.BROWSE) return null;

  let text = "";
  let tone: "info" | "busy" = "info";
  switch (state) {
    case DispatchState.SELECT:
      text =
        selectedCount > 0
          ? "Click the map to place a stop for selected vehicles — Esc to exit"
          : "Click vehicles in the list (or on the map) to select — Esc to exit";
      break;
    case DispatchState.ROUTE:
      text =
        stopCount > 0
          ? "Click map to add another stop • drag to move • right-click to delete • Enter to dispatch"
          : "Click the map to place a stop for the selected vehicles • Enter to dispatch • Esc to cancel";
      break;
    case DispatchState.DISPATCH:
      text = "Dispatching…";
      tone = "busy";
      break;
    case DispatchState.RESULTS:
      return null; // footer already summarises the result
  }

  return createPortal(
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: tone === "busy" ? "rgba(30, 64, 175, 0.92)" : "rgba(17, 24, 39, 0.92)",
        color: "#f3f4f6",
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0.2,
        pointerEvents: "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        zIndex: 10,
        maxWidth: "90%",
        textAlign: "center",
      }}
    >
      {text}
    </div>,
    mapHTMLElement
  );
}
