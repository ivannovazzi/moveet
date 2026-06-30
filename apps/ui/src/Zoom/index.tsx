import { ZoomIn, ZoomOut } from "@/components/Icons";
import { SquaredButton } from "@/components/Inputs";
import { useMapControls } from "@/components/Map/hooks";

export default function Zoom() {
  const { zoomIn, zoomOut } = useMapControls();

  return (
    <div className="absolute bottom-6 right-6 z-10 flex gap-2 rounded-lg border border-border surface-glass p-1 shadow-elevated backdrop-blur-md">
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
