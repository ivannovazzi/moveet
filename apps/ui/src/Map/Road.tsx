import type { Position, Road } from "@/types";
import { Polyline } from "@/components/Map/components/Polyline";
import { useEffect } from "react";
import { useMapControls } from "@/components/Map/hooks";
import Label from "@/components/Map/components/Label";

interface DirectionProps {
  road: Road;
}

function getBounds(streets: Position[]): [Position, Position] {
  const bounds = {
    min: { x: Infinity, y: Infinity },
    max: { x: -Infinity, y: -Infinity },
  };
  streets.forEach(([x, y]) => {
    bounds.min.x = Math.min(bounds.min.x, x);
    bounds.min.y = Math.min(bounds.min.y, y);
    bounds.max.x = Math.max(bounds.max.x, x);
    bounds.max.y = Math.max(bounds.max.y, y);
  });
  return [
    [bounds.min.x, bounds.min.y],
    [bounds.max.x, bounds.max.y],
  ];
}

export default function DirectionMap({ road }: DirectionProps) {
  const { setBounds } = useMapControls();
  useEffect(() => {
    setBounds(getBounds(road.streets.flat()));
  }, [road.streets, setBounds]);
  const lines = road.streets.map((street, i) => (
    <Polyline coordinates={street} key={`street-${i}`} color={"#fff"} />
  ));

  return (
    <>
      {lines}
      <Label coordinates={road.streets.flat()} label={road.name} color={"#fff"} />
    </>
  );
}
