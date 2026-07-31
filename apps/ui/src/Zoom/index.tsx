import { ZoomIn, ZoomOut } from "@/components/Icons";
import { SquaredButton } from "@/components/Inputs";
import { useMapControls } from "@/components/Map/hooks";

export default function Zoom() {
  const { zoomIn, zoomOut } = useMapControls();

  return (
    // On the shelf above the dock row: the dock's right wing runs the full width
    // of the band below, so the zoom keys stand clear of it.
    <div className="absolute bottom-above-dock right-6 z-10 flex gap-2 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated">
      <SquaredButton
        onClick={zoomIn}
        icon={<ZoomIn />}
        size="lg"
        aria-label="Zoom in"
        title="Zoom in"
      />
      <SquaredButton
        onClick={zoomOut}
        icon={<ZoomOut />}
        size="lg"
        aria-label="Zoom out"
        title="Zoom out"
      />
    </div>
  );
}
