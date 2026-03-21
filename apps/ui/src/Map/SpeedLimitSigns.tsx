import { useMemo, useState, useEffect, useRef } from "react";
import type { WebMercatorViewport } from "@deck.gl/core";
import { useMapContext } from "@/components/Map/hooks";
import { useSpeedLimits, type SpeedLimitSign } from "@/hooks/useSpeedLimits";
import HTMLMarker from "@/components/Map/components/HTMLMarker";
import type { Position } from "@/types";

/** Minimum pixel distance between speed limit signs */
const MIN_DISTANCE_PX = 100;

/** Debounce delay to avoid recomputing during rapid zoom/pan */
const DEBOUNCE_MS = 150;

function distanceSq(x1: number, y1: number, x2: number, y2: number) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function spacedSigns(items: SpeedLimitSign[], viewport: WebMercatorViewport, minDist: number) {
  const placed: Array<{ sign: SpeedLimitSign; px: number; py: number }> = [];
  const minDistSq = minDist * minDist;
  for (const sign of items) {
    const [lat, lng] = sign.coordinates;
    const [px, py] = viewport.project([lng, lat]);
    if (!isFinite(px) || !isFinite(py)) continue;

    let tooClose = false;
    for (let i = 0; i < placed.length; i++) {
      if (distanceSq(px, py, placed[i].px, placed[i].py) < minDistSq) {
        tooClose = true;
        break;
      }
    }
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
      <circle cx={r} cy={r} r={r - 1} fill="white" />
      <circle
        cx={r}
        cy={r}
        r={r - borderWidth / 2 - 0.5}
        fill="none"
        stroke="#cc0000"
        strokeWidth={borderWidth}
      />
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
  const { viewport, getBoundingBox } = useMapContext();

  // Debounced viewport — only recompute after zoom/pan settles
  const [stableViewport, setStableViewport] = useState(viewport);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStableViewport(viewport), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [viewport]);

  const [[west, south], [east, north]] = getBoundingBox();

  const inBounds = useMemo(() => {
    if (!stableViewport) return [];
    return signs.filter(
      ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
    );
  }, [signs, south, north, west, east, stableViewport]);

  const placed = useMemo(() => {
    if (!stableViewport) return [];
    return spacedSigns(inBounds, stableViewport, MIN_DISTANCE_PX);
  }, [inBounds, stableViewport]);

  if (!visible || !stableViewport) return null;

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
