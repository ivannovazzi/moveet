import { useMemo } from "react";
import { useClock } from "@/hooks/useClock";
import { useNetwork } from "@/hooks/useNetwork";
import { Polyline } from "@/components/Map/components/Polyline";
import type { TimeOfDay } from "@/types";

// Per-time-of-day base colour
const TIME_COLORS: Record<TimeOfDay, string> = {
  morning_rush: "#fb923c",
  midday: "#4ade80",
  evening_rush: "#ef4444",
  night: "#818cf8",
};

// Road class → width and opacity weight (major roads are bolder)
const ROAD_TIERS: Record<string, { width: number; opacityScale: number }> = {
  motorway: { width: 3.5, opacityScale: 1.0 },
  trunk: { width: 3.0, opacityScale: 0.95 },
  primary: { width: 2.5, opacityScale: 0.85 },
  secondary: { width: 1.8, opacityScale: 0.6 },
  tertiary: { width: 1.2, opacityScale: 0.35 },
};

// Base opacity per time-of-day (scaled by road tier)
const TIME_OPACITY: Record<TimeOfDay, number> = {
  morning_rush: 0.65,
  midday: 0.35,
  evening_rush: 0.8,
  night: 0.45,
};

const HIGHWAY_TYPES = new Set(Object.keys(ROAD_TIERS));

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { clock } = useClock();
  const network = useNetwork();

  const roads = useMemo(
    () => network.features.filter((f) => HIGHWAY_TYPES.has(f.properties.highway ?? "")),
    [network]
  );

  if (!visible) return null;

  const color = TIME_COLORS[clock.timeOfDay];
  const baseOpacity = TIME_OPACITY[clock.timeOfDay];

  return (
    <>
      {roads.map((feature, i) => {
        const tier = ROAD_TIERS[feature.properties.highway ?? ""] ?? ROAD_TIERS.tertiary;
        return (
          <Polyline
            key={`traffic-${i}`}
            coordinates={feature.geometry.coordinates}
            color={color}
            width={tier.width}
            opacity={baseOpacity * tier.opacityScale}
          />
        );
      })}
    </>
  );
}
