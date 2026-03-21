import { useMemo } from "react";
import { PathLayer } from "@deck.gl/layers";
import { useTraffic } from "@/hooks/useTraffic";
import { useNetwork } from "@/hooks/useNetwork";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import type { TrafficEdge } from "@/types";

const HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 4,
  trunk: 3.5,
  primary: 3,
  secondary: 2,
  tertiary: 1.5,
};

// Google Maps-style: green -> yellow -> orange -> red  (RGBA)
function congestionColorRgba(factor: number): [number, number, number, number] {
  if (factor >= 0.85) return [34, 197, 94, 217]; // green  - free flow
  if (factor >= 0.7) return [132, 204, 22, 217]; // lime   - light traffic
  if (factor >= 0.55) return [234, 179, 8, 217]; // yellow - moderate
  if (factor >= 0.4) return [249, 115, 22, 217]; // orange - heavy
  return [239, 68, 68, 217]; // red    - jammed
}

// Aggregate congestion per streetId (worst = lowest factor wins)
function buildStreetCongestion(edges: TrafficEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const edge of edges) {
    const existing = map.get(edge.streetId);
    if (existing === undefined || edge.congestion < existing) {
      map.set(edge.streetId, edge.congestion);
    }
  }
  return map;
}

interface TrafficDatum {
  path: [number, number][];
  color: [number, number, number, number];
  width: number;
}

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { edges: trafficEdges } = useTraffic();
  const { network } = useNetwork();

  const streetCongestion = useMemo(() => buildStreetCongestion(trafficEdges), [trafficEdges]);

  const layers = useMemo(() => {
    if (!visible || network.features.length === 0 || streetCongestion.size === 0) return [];

    const trafficData: TrafficDatum[] = network.features
      .filter((f) => {
        const sid = f.properties.streetId ?? f.properties["@id"];
        return sid != null && streetCongestion.has(sid);
      })
      .map((f) => {
        const sid = (f.properties.streetId ?? f.properties["@id"])!;
        return {
          path: f.geometry.coordinates as [number, number][],
          color: congestionColorRgba(streetCongestion.get(sid)!),
          width: HIGHWAY_WIDTH[f.properties.highway ?? ""] ?? 1.5,
        };
      });

    return [
      new PathLayer<TrafficDatum>({
        id: "traffic-overlay",
        data: trafficData,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: (d) => d.width,
        widthUnits: "pixels",
        widthMinPixels: 2,
        jointRounded: true,
        capRounded: true,
        pickable: false,
      }),
    ];
  }, [visible, network, streetCongestion]);

  useRegisterLayers("traffic-overlay", layers);

  return null;
}
