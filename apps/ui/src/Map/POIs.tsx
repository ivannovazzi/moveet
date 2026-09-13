import { useMemo } from "react";
import { IconLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from "@deck.gl/extensions";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { usePois } from "@/hooks/usePois";
import { createPOIIconAtlas } from "./POI/iconAtlas";
import { GROUP_META, mappableGroup, markerSizeForGroup, type PoiGroup } from "./POI/categories";
import { useSettledZoom } from "./hooks/useSettledZoom";
import { resolveMapColor } from "@/lib/mapColor";
import {
  LABEL_PRIORITY,
  LABEL_TOKEN,
  mapLabelProps,
  useVisibleLabels,
  type LabelItem,
} from "@/lib/mapLabels";
import type { POI } from "@/types";

// Build the atlas once at module level — this is a pure canvas operation.
const { iconAtlas, iconMapping } = createPOIIconAtlas();

const collisionFilter = new CollisionFilterExtension();

/**
 * Lowest zoom at which any POI is drawn — the earliest group gate
 * (health/fuel). Per-group gates live in GROUP_META.minZoom, so the map fills
 * in by usefulness rather than all at once.
 */
const MIN_ZOOM = 12.5;

/** Zoom at which persistent name labels appear beneath the markers. */
const LABEL_ZOOM = 15;

/**
 * Collision spacing multiplier — how much larger the collision hitbox is
 * compared to the rendered icon. 1.0 = no extra spacing, 2.0 = double.
 *
 * Wider below zoom 15, where a viewport still spans whole neighbourhoods and
 * the markers otherwise pack shoulder to shoulder; once you are inside a
 * street the extra air costs coverage instead of buying legibility.
 */
const COLLISION_SIZE_SCALE_WIDE = 3.5;
const COLLISION_SIZE_SCALE_TIGHT = 2.5;
const COLLISION_TIGHTEN_ZOOM = 15;

/** Fade-in duration in milliseconds. */
const FADE_DURATION_MS = 500;

/** Label size and offset, shared between the TextLayer and the declutter pass. */
const LABEL_SIZE = 12;
const LABEL_OFFSET: [number, number] = [0, 17];

/**
 * How far past the viewport a POI still counts as a label candidate. A little
 * slack keeps labels from popping in at the edge as you pan.
 */
const LABEL_BOUNDS_MARGIN = 0.25;

/**
 * Ceiling on label candidates handed to the declutter pass. Nairobi has ~21,000
 * POIs and a street-zoom viewport can still hold a few thousand; the pass is
 * O(n log n) across every layer on the map, and no viewport can fit more than a
 * few dozen labels anyway, so the rest is work with no possible effect on the
 * picture. Candidates are kept in group-priority order, so the cap trims the
 * leisure carpet before it trims a hospital.
 */
const MAX_LABEL_CANDIDATES = 400;

/** Round to ~100m so an inertial pan doesn't re-slice the candidate set. */
function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A POI paired with the group it renders as — resolved once, not per accessor. */
interface GroupedPOI {
  poi: POI;
  group: PoiGroup;
}

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
  /**
   * Whether POI markers respond to map clicks. Defaults to true. Set false when
   * another interaction owns map clicks so a POI must NOT pick (which would
   * return true from onClick and suppress DeckGL's map-level onClick).
   */
  selectable?: boolean;
}

export default function POIs({ visible, onClick, selectable = true }: POIMarkerProps) {
  const { getZoom, getBoundingBox, viewport } = useMapContext();
  const { pois } = usePois();
  const zoom = getZoom();

  const { settledZoom, isZooming } = useSettledZoom(zoom);
  const showData = visible && settledZoom >= MIN_ZOOM - 1;
  const showLabels = showData && !isZooming && settledZoom >= LABEL_ZOOM;

  // Data is emptied while zooming so items disappear instantly.
  // When isZooming flips false the array repopulates and deck.gl's
  // enter-transition fades each icon in from alpha 0.
  //
  // A POI earns a marker only if it has a name AND a group: the raw feed is
  // ~130 OSM types, most of them street furniture that used to land in a grey
  // "unknown" bucket and swamp the map.
  const visiblePois = useMemo(() => {
    if (!showData || isZooming) return [] as GroupedPOI[];
    const grouped: GroupedPOI[] = [];
    for (const poi of pois) {
      const group = mappableGroup(poi);
      if (!group) continue;
      grouped.push({ poi, group });
    }
    return grouped;
  }, [pois, showData, isZooming]);

  // The viewport box, quantised so it is a stable memo key across a pan rather
  // than a fresh array every animation frame.
  const [[west, south], [east, north]] = getBoundingBox();
  const boundsKey = `${quantize(west)}|${quantize(south)}|${quantize(east)}|${quantize(north)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `boundsKey` is the quantised identity of the box
  const labelBounds = useMemo(() => {
    if (west === east || south === north) return null;
    const padX = (east - west) * LABEL_BOUNDS_MARGIN;
    const padY = (north - south) * LABEL_BOUNDS_MARGIN;
    return { west: west - padX, east: east + padX, south: south - padY, north: north + padY };
  }, [boundsKey]);

  // Candidate labels are decluttered against every other map label layer, so
  // POI names yield to route, dispatch, job and geofence text. Within POIs the
  // group priority breaks ties, matching the icon collision order.
  //
  // Only POIs near the viewport are offered, and only the most useful
  // MAX_LABEL_CANDIDATES of those: the declutter pass is shared across every
  // map layer, so feeding it the whole city would tax every other layer too.
  const labelItems = useMemo<LabelItem[]>(() => {
    if (!showLabels) return [];
    const candidates: LabelItem[] = [];
    for (const { poi, group } of visiblePois) {
      const [lat, lng] = poi.coordinates;
      if (
        labelBounds &&
        (lng < labelBounds.west ||
          lng > labelBounds.east ||
          lat < labelBounds.south ||
          lat > labelBounds.north)
      ) {
        continue;
      }
      candidates.push({
        id: poi.id,
        position: [lng, lat],
        text: poi.name ?? "",
        size: LABEL_SIZE,
        priority: LABEL_PRIORITY.poi + GROUP_META[group].priority,
        pixelOffset: LABEL_OFFSET,
      });
    }
    if (candidates.length <= MAX_LABEL_CANDIDATES) return candidates;
    return candidates
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .slice(0, MAX_LABEL_CANDIDATES);
  }, [visiblePois, showLabels, labelBounds]);

  const collisionSizeScale =
    settledZoom >= COLLISION_TIGHTEN_ZOOM ? COLLISION_SIZE_SCALE_TIGHT : COLLISION_SIZE_SCALE_WIDE;

  const visibleLabels = useVisibleLabels("poi-labels", labelItems, viewport, settledZoom);

  const labelledPois = useMemo(
    () => (showLabels ? visiblePois.filter(({ poi }) => visibleLabels.has(poi.id)) : []),
    [visiblePois, showLabels, visibleLabels]
  );

  // Always create the layer so deck.gl preserves transition state across
  // data changes. Returning [] would destroy the layer and lose all
  // in-flight enter/color transitions.
  const layers = useMemo(
    () => [
      new IconLayer<GroupedPOI, CollisionFilterExtensionProps<GroupedPOI>>({
        id: "pois",
        data: visiblePois,
        updateTriggers: {
          getColor: [settledZoom],
        },
        getPosition: (d) => [d.poi.coordinates[1], d.poi.coordinates[0]],
        getIcon: (d) => d.group,
        getSize: (d) => markerSizeForGroup(d.group),
        getColor: (d) => {
          const alpha = settledZoom >= GROUP_META[d.group].minZoom ? 255 : 0;
          return [255, 255, 255, alpha];
        },
        iconAtlas,
        iconMapping,
        // Only pickable in browse mode: while another interaction owns map
        // clicks, a POI pick would return true and swallow the map-level click.
        pickable: selectable,
        autoHighlight: selectable,
        highlightColor: [255, 255, 255, 80],
        onClick: (info) => {
          if (selectable && info.object) {
            onClick(info.object.poi);
            return true; // stop event propagation
          }
          return false;
        },
        sizeUnits: "pixels",
        sizeMinPixels: 12,
        sizeMaxPixels: 32,
        transitions: {
          getColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
        extensions: [collisionFilter],
        ...({
          collisionEnabled: true,
          collisionGroup: "map-markers",
          getCollisionPriority: (d: GroupedPOI) => GROUP_META[d.group].priority,
          // `collisionTestProps` is not an accessor, so no updateTrigger covers
          // it; the collision pass reads it live off the layer whenever it
          // re-renders, and it re-renders because this memo hands deck.gl a new
          // layer instance whenever `collisionSizeScale` flips.
          collisionTestProps: {
            sizeScale: collisionSizeScale,
            sizeMaxPixels: 200,
          },
        } as Record<string, unknown>),
      }),
      // Persistent name labels below each marker, thinned by the shared
      // cross-layer declutter pass. (CollisionFilterExtension is deliberately
      // NOT used here — on TextLayer it culls every label.)
      new TextLayer<GroupedPOI>({
        ...mapLabelProps(LABEL_SIZE),
        id: "poi-labels",
        data: labelledPois,
        getPosition: (d) => [d.poi.coordinates[1], d.poi.coordinates[0]],
        getText: (d) => d.poi.name ?? "",
        getColor: resolveMapColor(LABEL_TOKEN),
        getTextAnchor: "middle",
        getAlignmentBaseline: "top",
        getPixelOffset: LABEL_OFFSET,
        pickable: false,
      }),
    ],
    [visiblePois, labelledPois, onClick, selectable, settledZoom, collisionSizeScale]
  );

  useRegisterLayers("pois", layers, 45);

  return null;
}
