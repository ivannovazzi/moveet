import { useState } from "react";
import type { IncidentDTO, IncidentType } from "@/types";
import { resolveMapColor } from "@/lib/mapColor";
import HTMLMarker from "../components/Map/components/HTMLMarker";

function rgbaToCss([r, g, b, a]: [number, number, number, number]): string {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

// closure = danger (road impassable); accident/construction are both
// slowdowns rather than full blockages, so they share the warning hue.
const COLORS: Record<IncidentType, string> = {
  closure: rgbaToCss(resolveMapColor("var(--color-overlay-danger)")),
  accident: rgbaToCss(resolveMapColor("var(--color-overlay-warning)")),
  construction: rgbaToCss(resolveMapColor("var(--color-overlay-warning)")),
};

interface IncidentMarkersProps {
  incidents: IncidentDTO[];
}

function IncidentMarker({ incident }: { incident: IncidentDTO }) {
  const [hovered, setHovered] = useState(false);
  const label = `${incident.type} — severity ${Math.round(incident.severity * 100)}%`;

  return (
    <HTMLMarker position={[incident.position[1], incident.position[0]]}>
      <div
        className="pointer-events-auto flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-default items-center justify-center drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered && (
          <div className="animate-in fade-in absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-card/90 p-1.5 text-xs backdrop-blur-md">
            {label}
          </div>
        )}
        <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: COLORS[incident.type] }}>
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
      </div>
    </HTMLMarker>
  );
}

export default function IncidentMarkers({ incidents }: IncidentMarkersProps) {
  return (
    <>
      {incidents.map((incident) => (
        <IncidentMarker key={incident.id} incident={incident} />
      ))}
    </>
  );
}
