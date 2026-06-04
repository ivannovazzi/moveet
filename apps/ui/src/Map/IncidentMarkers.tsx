import type { IncidentDTO, IncidentType } from "@/types";
import HTMLMarker from "../components/Map/components/HTMLMarker";

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
        <HTMLMarker key={incident.id} position={[incident.position[1], incident.position[0]]}>
          <div
            className="pointer-events-auto flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-default items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
            title={`${incident.type} — severity ${Math.round(incident.severity * 100)}%`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: COLORS[incident.type] }}>
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
          </div>
        </HTMLMarker>
      ))}
    </>
  );
}
