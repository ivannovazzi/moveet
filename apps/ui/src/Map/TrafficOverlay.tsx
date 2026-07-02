import { useMemo } from "react";
import { PathLayer } from "@deck.gl/layers";
import { useTraffic } from "@/hooks/useTraffic";
import { useNetwork } from "@/hooks/useNetwork";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";
import type { TrafficEdge } from "@/types";

const HIGHWAY_WIDTH: Record<string, number> = {
  motorway: 4,
  trunk: 3.5,
  primary: 3,
  secondary: 2,
  tertiary: 1.5,
};

const CONGESTION_ALPHA = 217;

// Google Maps-style: ok -> warning -> danger, resolved from the shared
// overlay-severity tokens (tokens.css) instead of hardcoded hex.
function congestionColorRgba(factor: number): [number, number, number, number] {
  if (factor >= 0.85) return resolveMapColor("var(--color-overlay-ok)", CONGESTION_ALPHA); // free flow
  if (factor >= 0.7) return resolveMapColor("var(--color-overlay-ok)", CONGESTION_ALPHA); // light traffic
  if (factor >= 0.55) return resolveMapColor("var(--color-overlay-warning)", CONGESTION_ALPHA); // moderate
  if (factor >= 0.4) return resolveMapColor("var(--color-overlay-warning)", CONGESTION_ALPHA); // heavy
  return resolveMapColor("var(--color-overlay-danger)", CONGESTION_ALPHA); // jammed
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

/** A street's static geometry — built once when the network loads. */
interface TrafficDatum {
  streetId: string;
  path: [number, number][];
  width: number;
}

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { edges: trafficEdges } = useTraffic();
  const { network } = useNetwork();

  // Worst congestion per streetId. Recomputed only when traffic edges change.
  const streetCongestion = useMemo(() => buildStreetCongestion(trafficEdges), [trafficEdges]);

  // Per-street geometry index — built ONCE per network load (keyed on `network`
  // only). Every traffic tick reuses this same array reference; only the color
  // accessor re-evaluates (via updateTriggers), so the path attributes are not
  // re-uploaded to the GPU each tick.
  const trafficData = useMemo<TrafficDatum[]>(() => {
    if (network.features.length === 0) return [];
    const data: TrafficDatum[] = [];
    for (const f of network.features) {
      const sid = f.properties.streetId ?? f.properties["@id"];
      if (sid == null) continue;
      data.push({
        streetId: sid,
        path: f.geometry.coordinates as [number, number][],
        width: HIGHWAY_WIDTH[f.properties.highway ?? ""] ?? 1.5,
      });
    }
    return data;
  }, [network]);

  // A stable congestion-version key for updateTriggers: changes iff the
  // aggregated congestion map changes (i.e. on a traffic tick).
  const congestionVersion = useMemo(() => {
    let key = "";
    for (const [sid, c] of streetCongestion) key += `${sid}:${c.toFixed(3)};`;
    return key;
  }, [streetCongestion]);

  const layers = useMemo(() => {
    if (!visible || trafficData.length === 0 || streetCongestion.size === 0) return [];

    return [
      new PathLayer<TrafficDatum>({
        id: "traffic-overlay",
        data: trafficData,
        getPath: (d) => d.path,
        getColor: (d) => {
          const c = streetCongestion.get(d.streetId);
          // Fully transparent for streets with no congestion data this tick.
          return c === undefined ? [0, 0, 0, 0] : congestionColorRgba(c);
        },
        getWidth: (d) => d.width,
        widthUnits: "pixels",
        widthMinPixels: 2,
        jointRounded: true,
        capRounded: true,
        pickable: false,
        updateTriggers: {
          getColor: congestionVersion,
        },
      }),
    ];
    // `streetCongestion` is read inside getColor; `congestionVersion` is the
    // stable trigger so we don't list the Map itself (new identity each tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, trafficData, congestionVersion]);

  useRegisterLayers("traffic-overlay", layers);

  return null;
}
