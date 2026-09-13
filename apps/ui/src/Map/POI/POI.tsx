import {
  Bus,
  Church,
  Fuel,
  GraduationCap,
  HeartPulse,
  Landmark,
  ShoppingBag,
  Ticket,
  Utensils,
} from "lucide-react";
import type { POI, Position } from "@/types";
import { memo } from "react";
import HTMLMarker from "@/components/Map/components/HTMLMarker";
import { cn } from "@/lib/utils";
import { groupForType, type PoiGroup } from "./categories";
import { getFillForGroup } from "./helpers";

/** Same nine glyphs the icon atlas draws, so the HTML marker matches the GPU one. */
const GROUP_ICONS: Record<PoiGroup, typeof Bus> = {
  transit: Bus,
  shop: ShoppingBag,
  food: Utensils,
  health: HeartPulse,
  education: GraduationCap,
  civic: Landmark,
  worship: Church,
  leisure: Ticket,
  fuel: Fuel,
};

/**
 * A POI with no group is noise the map never draws — but it can still be the
 * search/inspector selection, so it borrows the neutral civic styling rather
 * than rendering as a blank chip.
 */
const FALLBACK_GROUP: PoiGroup = "civic";

interface POIMarkerProps {
  poi: POI;
  showLabel?: boolean;
  onClick?: () => void;
}

const POIMarker = memo(function POIMarker({ poi, showLabel, onClick }: POIMarkerProps) {
  const position = [poi.coordinates[1], poi.coordinates[0]] as Position;
  const group = groupForType(poi.type) ?? FALLBACK_GROUP;
  const transit = group === "transit";
  const Icon = GROUP_ICONS[group];
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
          transit
            ? "-ml-[8px] -mt-[8px] h-4 w-4 rounded-full border border-[#ffffff66] hover:scale-150"
            : "-ml-[11px] -mt-[11px] h-[22px] w-[22px] rounded-full border border-[#ffffff66] hover:scale-[2]"
        )}
        style={{ background: getFillForGroup(group) }}
      >
        <Icon className={cn("text-[#fffd]", transit ? "h-2.5 w-2.5" : "h-3.5 w-3.5")} />
      </div>
    </HTMLMarker>
  );
});

export default POIMarker;
