import { useMemo } from "react";
import { useMapContext } from "@/components/Map/hooks";
import { useSpeedLimits, type SpeedLimitSign } from "@/hooks/useSpeedLimits";
import HTMLMarker from "@/components/Map/components/HTMLMarker";
import type { Position } from "@/types";
import type { GeoProjection, ZoomTransform } from "d3";

/** Minimum pixel distance between speed limit signs */
const MIN_DISTANCE_PX = 100;

function distancePx(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function spacedSigns(
  items: SpeedLimitSign[],
  transform: ZoomTransform,
  projection: GeoProjection,
  minDist: number
) {
  const placed: Array<{ sign: SpeedLimitSign; px: number; py: number }> = [];
  for (const sign of items) {
    const [lat, lng] = sign.coordinates;
    const projected = projection([lng, lat]);
    if (!projected) continue;
    const [px, py] = transform.apply(projected);
    const tooClose = placed.some(({ px: x2, py: y2 }) => distancePx(px, py, x2, y2) < minDist);
    if (!tooClose) placed.push({ sign, px, py });
  }
  return placed;
}

/** European-style round speed limit sign */
function SpeedSign({ speed }: { speed: number }) {
  const size = 28;
  const r = size / 2;
  const borderWidth = 3;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        marginLeft: -r,
        marginTop: -r,
        cursor: "default",
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
      }}
    >
      {/* White background */}
      <circle cx={r} cy={r} r={r - 1} fill="white" />
      {/* Red border */}
      <circle
        cx={r}
        cy={r}
        r={r - borderWidth / 2 - 0.5}
        fill="none"
        stroke="#cc0000"
        strokeWidth={borderWidth}
      />
      {/* Speed number */}
      <text
        x={r}
        y={r}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Arial, sans-serif"
        fontWeight="bold"
        fontSize={speed >= 100 ? 9 : 11}
        fill="#111"
      >
        {speed}
      </text>
    </svg>
  );
}

interface SpeedLimitSignsProps {
  visible: boolean;
}

export default function SpeedLimitSigns({ visible }: SpeedLimitSignsProps) {
  const { signs } = useSpeedLimits();
  const { getBoundingBox, projection, transform } = useMapContext();
  const [[west, north], [east, south]] = getBoundingBox();

  const inBounds = useMemo(() => {
    if (!projection || !transform) return [];
    return signs.filter(
      ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
    );
  }, [signs, south, north, west, east, projection, transform]);

  const placed = useMemo(() => {
    if (!projection || !transform) return [];
    return spacedSigns(inBounds, transform, projection, MIN_DISTANCE_PX);
  }, [inBounds, transform, projection]);

  if (!visible || !projection || !transform) return null;

  return (
    <>
      {placed.map(({ sign }) => {
        const position = [sign.coordinates[1], sign.coordinates[0]] as Position;
        return (
          <HTMLMarker key={sign.id} position={position}>
            <SpeedSign speed={sign.speed} />
          </HTMLMarker>
        );
      })}
    </>
  );
}
