import styles from "./Vehicle.module.css";
import classNames from "classnames";
import React, { memo, useEffect, useMemo } from "react";
import type { Position, Vehicle } from "@/types";
import { calculateRotation } from "@/utils/coordinates";
import { Marker } from "../../components/Map/components/Marker";
import { useMapContext } from "../../components/Map/hooks";

interface VehicleProps extends Vehicle {
  position: Position;
  animFreq: number;
  scale: number;
  fleetColor?: string;
  onClick: () => void;
}

function VehicleMarker({
  position,
  selected,
  hovered,
  heading,
  visible,
  animFreq,
  scale,
  fleetColor,
  onClick,
}: VehicleProps) {
  const { transform } = useMapContext();
  const k = transform?.k ?? 1;
  const [prevHeading, setPrevHeading] = React.useState(heading);
  useEffect(() => {
    setPrevHeading(heading);
  }, [heading]);

  const rotation = calculateRotation(prevHeading, heading);

  const className = classNames(styles.vehicle, {
    [styles.selected]: selected,
    [styles.hovered]: hovered,
  });

  const zoomCompensation = Math.pow(k, 0.75);
  const inverseScale = scale / zoomCompensation;

  const bearingStyle = useMemo(
    () => ({
      transform: `rotate(${prevHeading + rotation}deg) scale(${inverseScale})`,
      transition: `transform ${animFreq}ms linear`,
    }),
    [prevHeading, rotation, inverseScale, animFreq]
  );

  if (!visible) return null;

  return (
    <Marker position={position} animation={animFreq} onClick={onClick}>
      <g style={bearingStyle}>
        <polygon
          points="0,-4 2.5,3 0,1.5 -2.5,3"
          className={className}
          style={fleetColor ? { fill: fleetColor } : undefined}
        />
        {selected && <circle r="6" className={styles.selectionRing} />}
      </g>
    </Marker>
  );
}

/** Custom comparator for memo: only re-render when rendering-relevant props change. */
function vehicleMarkerEqual(prev: VehicleProps, next: VehicleProps): boolean {
  return (
    prev.id === next.id &&
    prev.position[0] === next.position[0] &&
    prev.position[1] === next.position[1] &&
    prev.heading === next.heading &&
    prev.speed === next.speed &&
    prev.visible === next.visible &&
    prev.selected === next.selected &&
    prev.hovered === next.hovered &&
    prev.fleetColor === next.fleetColor &&
    prev.animFreq === next.animFreq &&
    prev.scale === next.scale &&
    prev.onClick === next.onClick
  );
}

export default memo(VehicleMarker, vehicleMarkerEqual);
