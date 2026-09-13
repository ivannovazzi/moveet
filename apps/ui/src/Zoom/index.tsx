import { ZoomIn, ZoomOut } from "@/components/Icons";
import { SquaredButton } from "@/components/Inputs";
import { useMapControls } from "@/components/Map/hooks";

export default function Zoom() {
  const { zoomIn, zoomOut } = useMapControls();

  return (
    // Bottom-left, standing on the dock shelf beside the visibility rail (the
    // section panel owns the bottom-right above the dock's right wing). Side by
    // side rather than stacked, so the left column is no taller than the rail
    // and the legend stack's clearance (`--visibility-rail-band`) still holds
    // on a short window. `--spacing-beside-rail` is the rail's inset + width +
    // gap (index.css).
    <div className="absolute bottom-above-dock left-beside-rail z-10 flex animate-fade-up gap-0.5 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated">
      <SquaredButton
        onClick={zoomIn}
        icon={<ZoomIn />}
        size="lg"
        className="size-[34px] rounded-md"
        aria-label="Zoom in"
        title="Zoom in"
      />
      <SquaredButton
        onClick={zoomOut}
        icon={<ZoomOut />}
        size="lg"
        className="size-[34px] rounded-md"
        aria-label="Zoom out"
        title="Zoom out"
      />
    </div>
  );
}
