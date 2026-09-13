import { useMemo } from "react";
import { IconLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from "@deck.gl/extensions";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { usePois } from "@/hooks/usePois";
import { createPOIIconAtlas } from "./POI/iconAtlas";
import { GROUP_META, groupForType, type PoiGroup } from "./POI/categories";
import { useSettledZoom } from "./hooks/useSettledZoom";
import { resolveMapColor } from "@/lib/mapColor";
import { LABEL_PRIORITY, mapLabelProps, useVisibleLabels, type LabelItem } from "@/lib/mapLabels";
import type { POI } from "@/types";

/** POI names are ambient context, so they take the neutral map ink. */
const LABEL_TOKEN = "var(--color-map-label)";

// Build the atlas once at module level — this is a pure canvas operation.
const { iconAtlas, iconMapping } = createPOIIconAtlas();

const collisionFilter = new CollisionFilterExtension();

/**
 * Lowest zoom at which any POI is drawn — the health group's gate. Per-group
 * gates live in GROUP_META.minZoom, so the map fills in by usefulness rather
 * than all at once.
 */
const MIN_ZOOM = 11.5;

/** Zoom at which persistent name labels appear beneath the markers. */
const LABEL_ZOOM = 15;

/**
 * Collision spacing multiplier — how much larger the collision hitbox is
 * compared to the rendered icon. 1.0 = no extra spacing, 2.0 = double.
 */
const COLLISION_SIZE_SCALE = 2.5;

/** Fade-in duration in milliseconds. */
const FADE_DURATION_MS = 500;

/** Bus-stop-style markers stay small; everything else is a full-size disc. */
const TRANSIT_SIZE = 16;
const DEFAULT_SIZE = 22;

/** Label size and offset, shared between the TextLayer and the declutter pass. */
const LABEL_SIZE = 12;
const LABEL_OFFSET: [number, number] = [0, 17];

/**
 * Zoom is quantized to discrete steps so deck.gl color transitions can
 * complete between updates instead of restarting on every animation frame.
 * Quantization + debouncing lives in {@link useSettledZoom}.
 */

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
  const { getZoom, viewport } = useMapContext();
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
      if (!poi.name) continue;
      const group = groupForType(poi.type);
      if (!group) continue;
      grouped.push({ poi, group });
    }
    return grouped;
  }, [pois, showData, isZooming]);

  // Candidate labels are decluttered against every other map label layer, so
  // POI names yield to route, dispatch, job and geofence text. Within POIs the
  // group priority breaks ties, matching the icon collision order.
  const labelItems = useMemo<LabelItem[]>(() => {
    if (!showLabels) return [];
    return visiblePois.map(({ poi, group }) => ({
      id: poi.id,
      position: [poi.coordinates[1], poi.coordinates[0]] as [number, number],
      text: poi.name ?? "",
      size: LABEL_SIZE,
      priority: LABEL_PRIORITY.poi + GROUP_META[group].priority,
      pixelOffset: LABEL_OFFSET,
    }));
  }, [visiblePois, showLabels]);

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
        getSize: (d) => (d.group === "transit" ? TRANSIT_SIZE : DEFAULT_SIZE),
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
          collisionTestProps: {
            sizeScale: COLLISION_SIZE_SCALE,
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
    [visiblePois, labelledPois, onClick, selectable, settledZoom]
  );

  useRegisterLayers("pois", layers, 45);

  return null;
}
