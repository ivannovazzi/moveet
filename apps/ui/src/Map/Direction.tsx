import { useEffect, useState, memo } from "react";
import type { Route } from "@/types";
import { useDirections } from "@/hooks/useDirections";
import { Polyline } from "@/components/Map/components/Polyline";
import { invertLatLng } from "@/utils/coordinates";
import Label from "@/components/Map/components/Label";

interface DirectionLineProps {
  direction: Route;
  color: string;
}

const DirectionLine = memo(function DirectionLine({ direction, color }: DirectionLineProps) {
  const distance = `${direction.distance.toFixed(1)} km`;
  const coordinates = direction.edges.map((edge) => edge.start.coordinates).map(invertLatLng);
  return (
    <>
      <Polyline coordinates={coordinates} color={color} />
      <Label label={distance} coordinates={coordinates} color={color} />
    </>
  );
});
interface DirectionProps {
  selected?: string;
  hovered?: string;
}

export default function DirectionMap({ selected, hovered }: DirectionProps) {
  const directions = useDirections();
  const [selectedDirection, setSelectedDirection] = useState<Route | null>(null);
  const [hoveredDirection, setHoveredDirection] = useState<Route | null>(null);
  useEffect(() => {
    if (selected && directions.size > 0) {
      setSelectedDirection(directions.get(selected) ?? null);
    } else {
      setSelectedDirection(null);
    }
  }, [directions, selected]);

  useEffect(() => {
    if (hovered && directions.size > 0) {
      setHoveredDirection(directions.get(hovered) ?? null);
    } else {
      setHoveredDirection(null);
    }
  }, [directions, hovered]);

  return (
    <>
      {hoveredDirection && (
        <DirectionLine direction={hoveredDirection} key={`${hovered}--hovered`} color={"#f93"} />
      )}
      {selectedDirection && (
        <DirectionLine direction={selectedDirection} key={`${selected}--selected`} color={"#39f"} />
      )}
    </>
  );
}
