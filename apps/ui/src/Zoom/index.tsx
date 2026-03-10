import styles from "./Zoom.module.css";
import { ZoomIn, ZoomOut } from "@/components/Icons";
import { SquaredButton } from "@/components/Inputs";
import { useMapControls } from "@/components/Map/hooks";

export default function Zoom() {
  const { zoomIn, zoomOut } = useMapControls();

  return (
    <div className={styles.zoom}>
      <SquaredButton onClick={zoomIn} icon={<ZoomIn />} aria-label="Zoom in" title="Zoom in" />
      <SquaredButton onClick={zoomOut} icon={<ZoomOut />} aria-label="Zoom out" title="Zoom out" />
    </div>
  );
}
