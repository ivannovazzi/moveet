import { useMemo } from "react";
import { PolygonLayer, TextLayer } from "@deck.gl/layers";
import type { GeoFence, GeoFenceType } from "@moveet/shared-types";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

type RGBA = [number, number, number, number];

const TYPE_FILL: Record<GeoFenceType, RGBA> = {
  restricted: [239, 68, 68, 64],
  delivery: [34, 197, 94, 64],
  monitoring: [59, 130, 246, 64],
};

const TYPE_STROKE: Record<GeoFenceType, RGBA> = {
  restricted: [239, 68, 68, 255],
  delivery: [34, 197, 94, 255],
  monitoring: [59, 130, 246, 255],
};

function hexToRgba(hex: string, alpha: number): RGBA {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b, Math.round(alpha * 255)];
}

function getFillRgba(fence: GeoFence): RGBA {
  if (fence.color) return hexToRgba(fence.color, 0.25);
  const base = TYPE_FILL[fence.type];
  return fence.active ? base : [base[0], base[1], base[2], Math.round(base[3] * 0.4)];
}

function getStrokeRgba(fence: GeoFence): RGBA {
  if (fence.color) {
    const rgba = hexToRgba(fence.color, 1);
    return fence.active ? rgba : [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * 0.4)];
  }
  const base = TYPE_STROKE[fence.type];
  return fence.active ? base : [base[0], base[1], base[2], Math.round(base[3] * 0.4)];
}

function centroid(points: [number, number][]): [number, number] {
  const x = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const y = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [x, y];
}

interface GeofenceLayerProps {
  fences: GeoFence[];
  selectedFenceId?: string;
}

export default function GeofenceLayer({ fences, selectedFenceId }: GeofenceLayerProps) {
  const layers = useMemo(() => {
    if (fences.length === 0) return [];

    return [
      new PolygonLayer<GeoFence>({
        id: "geofences",
        data: fences,
        getPolygon: (d: GeoFence) => d.polygon,
        getFillColor: (d: GeoFence) => getFillRgba(d),
        getLineColor: (d: GeoFence) => getStrokeRgba(d),
        getLineWidth: (d: GeoFence) => (d.id === selectedFenceId ? 2 : 1),
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
      }),
      new TextLayer<GeoFence>({
        id: "geofence-labels",
        data: fences,
        getPosition: (d: GeoFence) => centroid(d.polygon),
        getText: (d: GeoFence) => d.name,
        getSize: 11,
        getColor: (d: GeoFence) => getStrokeRgba(d),
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        pickable: false,
        fontFamily: "system-ui",
        outlineColor: [0, 0, 0, 153],
        outlineWidth: 3,
      }),
    ];
  }, [fences, selectedFenceId]);

  useRegisterLayers("geofences", layers);

  return null;
}
