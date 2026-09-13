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
import { groupForType, markerSizeForGroup, type PoiGroup } from "./categories";
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

/** Glyph size as a fraction of the disc, matching the icon atlas's proportions. */
const GLYPH_RATIO = 0.64;

interface POIMarkerProps {
  poi: POI;
  showLabel?: boolean;
  onClick?: () => void;
}

const POIMarker = memo(function POIMarker({ poi, showLabel, onClick }: POIMarkerProps) {
  const position = [poi.coordinates[1], poi.coordinates[0]] as Position;
  const group = groupForType(poi.type) ?? FALLBACK_GROUP;
  const Icon = GROUP_ICONS[group];
  // The same anchor/carpet sizing the GPU markers use, so the selected POI does
  // not change size when it crosses from `POIs`' IconLayer to this marker.
  // Sized inline rather than in classes: the sizes are data, and Tailwind can
  // only emit the utilities it can see spelled out.
  const size = markerSizeForGroup(group);
  const glyph = Math.round(size * GLYPH_RATIO);
  return (
    <HTMLMarker key={poi.id} position={position} onClick={onClick}>
      {showLabel && (
        <div className="absolute bottom-8 left-1/2 min-w-[120px] -translate-x-1/2 rounded-md border border-border bg-card/90 p-1.5 text-center text-base backdrop-blur-md">
          {poi.name}
        </div>
      )}
      <div
        className="flex animate-in fade-in cursor-pointer items-center justify-center rounded-full border border-[#ffffff66] transition-transform duration-200 ease-out hover:scale-150"
        style={{
          background: getFillForGroup(group),
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
        }}
      >
        <Icon className="text-[#fffd]" style={{ width: glyph, height: glyph }} />
      </div>
    </HTMLMarker>
  );
});

export default POIMarker;
