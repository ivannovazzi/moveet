import { useMemo } from "react";
import type { GeoFence, GeoFenceType } from "@moveet/shared-types";
import { useMapContext } from "@/components/Map/hooks";

// Default colors per type
const TYPE_FILL: Record<GeoFenceType, string> = {
  restricted: "rgba(239,68,68,0.25)",
  delivery: "rgba(34,197,94,0.25)",
  monitoring: "rgba(59,130,246,0.25)",
};

const TYPE_STROKE: Record<GeoFenceType, string> = {
  restricted: "rgb(239,68,68)",
  delivery: "rgb(34,197,94)",
  monitoring: "rgb(59,130,246)",
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getFill(fence: GeoFence): string {
  if (fence.color) return hexToRgba(fence.color, 0.25);
  return TYPE_FILL[fence.type];
}

function getStroke(fence: GeoFence): string {
  if (fence.color) return fence.color;
  return TYPE_STROKE[fence.type];
}

function polygonToPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ") + " Z";
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
  const { projection } = useMapContext();

  const projected = useMemo(() => {
    if (!projection) return [];
    return fences.map((fence) => {
      const pts = fence.polygon
        .map((coord) => projection(coord))
        .filter((p): p is [number, number] => p !== null && isFinite(p[0]) && isFinite(p[1]));
      return { fence, pts };
    });
  }, [fences, projection]);

  if (!projection) return null;

  return (
    <>
      {projected.map(({ fence, pts }) => {
        if (pts.length < 3) return null;
        const isSelected = fence.id === selectedFenceId;
        const fill = getFill(fence);
        const stroke = getStroke(fence);
        const strokeWidth = isSelected ? 2 : 1;
        const d = polygonToPath(pts);
        const [cx, cy] = centroid(pts);

        return (
          <g key={fence.id} data-fence-id={fence.id} opacity={fence.active ? 1 : 0.4}>
            <path
              d={d}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill={stroke}
              stroke="rgba(0,0,0,0.6)"
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {fence.name}
            </text>
          </g>
        );
      })}
    </>
  );
}
