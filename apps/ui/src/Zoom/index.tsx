import { useCallback, useEffect, useMemo } from "react";
import { FitIcon, ZoomIn, ZoomOut } from "@/components/Icons";
import { useMapControls } from "@/components/Map/hooks";
import { useNetworkContext } from "@/data/useData";
import { cn } from "@/lib/utils";
import { networkBounds } from "@/utils/coordinates";
import { setFitNetwork } from "./fitNetwork";

/** Rail-key styling, shared by the three cluster keys. */
const KEY_CLASS = cn(
  "flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md",
  "text-muted-foreground/70 transition-[background-color,color] duration-fast ease-standard",
  "hover:bg-foreground/[0.05] hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
  "disabled:hover:text-muted-foreground/70",
  "[&_svg]:size-4"
);

/**
 * The map-controls cluster: fit, zoom in, zoom out.
 *
 * Two zoom keys alone read as an orphan on a wheel/trackpad map — they are the
 * one thing the operator never needs a button for. What *isn't* reachable by
 * gesture is getting back: pan far enough and the network is off screen with
 * nothing on the map saying which way home is. "Fit network" is that key, and
 * it is why the cluster exists; the zoom pair rides along for touch and for
 * anyone who prefers a discrete step.
 *
 * Styled as rail keys (34px, `rounded-md`, muted icon) in the same glass box,
 * so bottom-left reads as one instrument rather than two components that happen
 * to be adjacent: the rail says what the map draws, the cluster says where the
 * camera is looking.
 *
 * Bottom-left, standing on the dock shelf beside the visibility rail (the
 * section panel owns the bottom-right above the dock's right wing). Side by
 * side rather than stacked, so the left column is no taller than the rail and
 * the legend stack's clearance (`--visibility-rail-band`) still holds on a
 * short window. `--spacing-beside-rail` is the rail's inset + width + gap
 * (index.css).
 */
export default function Zoom() {
  const { zoomIn, zoomOut, setBounds } = useMapControls();
  // `useNetwork` (App) owns the fetch; this reads the same context so mounting
  // the cluster does not start a second `/network` request.
  const { network } = useNetworkContext();

  const bounds = useMemo(() => networkBounds(network), [network]);

  const fit = useCallback(() => {
    if (bounds) setBounds(bounds);
  }, [bounds, setBounds]);

  // Publish the composed action for the `0` shortcut and the command palette,
  // neither of which can read the network context for itself.
  useEffect(() => {
    if (!bounds) return;
    setFitNetwork(fit);
    return () => setFitNetwork(null);
  }, [bounds, fit]);

  return (
    <div
      role="group"
      aria-label="Map controls"
      className="absolute bottom-above-dock left-beside-rail z-10 flex animate-fade-up gap-0.5 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated"
    >
      <button
        type="button"
        onClick={fit}
        disabled={!bounds}
        aria-label="Fit network"
        title="Fit network (0)"
        className={KEY_CLASS}
      >
        <FitIcon />
      </button>
      <button
        type="button"
        onClick={zoomIn}
        aria-label="Zoom in"
        title="Zoom in (+)"
        className={KEY_CLASS}
      >
        <ZoomIn />
      </button>
      <button
        type="button"
        onClick={zoomOut}
        aria-label="Zoom out"
        title="Zoom out (−)"
        className={KEY_CLASS}
      >
        <ZoomOut />
      </button>
    </div>
  );
}
