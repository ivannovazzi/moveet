import { Craft, Leisure, Office, Shop, Bus, Unknown } from "@/components/Icons";
import type { POI, Position } from "@/types";
import React, { memo } from "react";
import HTMLMarker from "@/components/Map/components/HTMLMarker";
import { cn } from "@/lib/utils";
import { getFillByType, isBusStop } from "./helpers";

const IconByType = memo(function IconByType({
  type,
  className,
}: {
  type: string;
  className: string;
}) {
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

  return React.cloneElement(icon, { className });
});

interface POIMarkerProps {
  poi: POI;
  showLabel?: boolean;
  onClick?: () => void;
}

const POIMarker = memo(function POIMarker({ poi, showLabel, onClick }: POIMarkerProps) {
  const position = [poi.coordinates[1], poi.coordinates[0]] as Position;
  const bus = isBusStop(poi);
  return (
    <HTMLMarker key={poi.id} position={position} onClick={onClick}>
      {showLabel && (
        <div className="absolute bottom-8 left-1/2 min-w-[120px] -translate-x-1/2 rounded-md border border-border bg-card/90 p-1.5 text-center text-base backdrop-blur-md">
          {poi.name}
        </div>
      )}
      <div
        className={cn(
          "flex animate-in fade-in cursor-pointer items-center justify-center transition-transform duration-200 ease-out",
          bus
            ? "-ml-[7px] -mt-[7px] h-3.5 w-3.5 rounded-[5px] border border-[#333d] hover:scale-150"
            : "-ml-[11px] -mt-[11px] h-[22px] w-[22px] rounded-full border border-[#ffffff66] hover:scale-[2]"
        )}
        style={{ background: getFillByType(poi.type) }}
      >
        <IconByType
          type={poi.type}
          className={cn(bus ? "h-5 w-5 fill-[#333d]" : "h-4 w-4 fill-[#fffd]")}
        />
      </div>
    </HTMLMarker>
  );
});

export default POIMarker;
