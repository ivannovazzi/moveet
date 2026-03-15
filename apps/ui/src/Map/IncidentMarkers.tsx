import type { IncidentDTO, IncidentType } from "@/types";
import HTMLMarker from "../components/Map/components/HTMLMarker";
import styles from "./IncidentMarkers.module.css";

const COLORS: Record<IncidentType, string> = {
  closure: "#f44336",
  accident: "#ff9800",
  construction: "#ffeb3b",
};

interface IncidentMarkersProps {
  incidents: IncidentDTO[];
}

export default function IncidentMarkers({ incidents }: IncidentMarkersProps) {
  return (
    <>
      {incidents.map((incident) => (
        <HTMLMarker
          key={incident.id}
          position={[incident.position[1], incident.position[0]]}
        >
          <div
            className={styles.marker}
            title={`${incident.type} — severity ${Math.round(incident.severity * 100)}%`}
          >
            <svg viewBox="0 0 24 24" className={styles.icon} style={{ fill: COLORS[incident.type] }}>
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
          </div>
        </HTMLMarker>
      ))}
    </>
  );
}
