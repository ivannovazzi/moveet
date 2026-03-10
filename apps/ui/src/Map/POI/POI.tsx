import { Craft, Leisure, Office, Shop, Bus, Unknown } from "@/components/Icons";
import styles from "./POI.module.css";
import type { POI, Position } from "@/types";
import React, { memo } from "react";
import HTMLMarker from "@/components/Map/components/HTMLMarker";
import classNames from "classnames";
import { getFillByType, isBusStop } from "./helpers";

const IconByType = memo(function IconByType({ type }: { type: string }) {
  const svgProps = {
    className: styles.icon,
  };

  let icon = <Unknown />;
  if (type === "shop") {
    icon = <Shop />;
  } else if (type === "leisure") {
    icon = <Leisure />;
  } else if (type === "craft") {
    icon = <Craft />;
  } else if (type === "office") {
    icon = <Office />;
  } else if (type === "bus_stop") {
    icon = <Bus />;
  }

  return React.cloneElement(icon, svgProps);
});

interface POIMarkerProps {
  poi: POI;
  showLabel?: boolean;
  onClick?: () => void;
}

const POIMarker = memo(function POIMarker({ poi, showLabel, onClick }: POIMarkerProps) {
  const position = [poi.coordinates[1], poi.coordinates[0]] as Position;
  return (
    <HTMLMarker key={poi.id} position={position} onClick={onClick}>
      {showLabel && <div className={styles.label}>{poi.name}</div>}
      <div
        className={classNames({ [styles.poi]: !isBusStop(poi), [styles.bus]: isBusStop(poi) })}
        style={{ background: getFillByType(poi.type) }}
      >
        <IconByType type={poi.type} />
      </div>
    </HTMLMarker>
  );
});

export default POIMarker;
