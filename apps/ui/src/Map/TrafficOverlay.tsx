import { useClock } from "@/hooks/useClock";
import { useNetwork } from "@/hooks/useNetwork";
import { Polyline } from "@/components/Map/components/Polyline";
import type { TimeOfDay } from "@/types";

const TRAFFIC_STYLES: Partial<Record<TimeOfDay, { color: string; opacity: number }>> = {
  morning_rush: { color: "#fb923c", opacity: 0.55 },
  evening_rush: { color: "#ef4444", opacity: 0.7 },
  night: { color: "#818cf8", opacity: 0.35 },
  // midday: no overlay
};

export default function TrafficOverlay({ visible }: { visible: boolean }) {
  const { clock } = useClock();
  const network = useNetwork();

  if (!visible) return null;

  const style = TRAFFIC_STYLES[clock.timeOfDay];
  if (!style) return null;

  const affectedRoads = network.features.filter(
    (f) => f.properties.highway === "trunk" || f.properties.highway === "primary"
  );

  return (
    <>
      {affectedRoads.map((feature, i) => (
        <Polyline
          key={`traffic-${i}`}
          coordinates={feature.geometry.coordinates}
          color={style.color}
          width={2.5}
          opacity={style.opacity}
        />
      ))}
    </>
  );
}
