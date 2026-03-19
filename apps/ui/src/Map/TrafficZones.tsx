import { Polygon } from "@/components/Map/components/Polygon";
import { useHeatzones } from "@/hooks/useHeatzones";

export default function Heatzones({ visible }: { visible: boolean }) {
  const { heatzones } = useHeatzones();
  if (!visible) return null;
  return heatzones.map((heatzone) => {
    return (
      <Polygon
        key={heatzone.properties.id}
        coordinates={heatzone.geometry.coordinates}
        fill="#f00"
        fillOpacity={0.2}
        stroke="#ff000099"
        opacity={heatzone.properties.intensity}
      />
    );
  });
}
