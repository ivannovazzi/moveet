import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ScatterplotLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Vehicle, DispatchAssignment } from "@/types";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useMapContext, useOverlay } from "@/components/Map/hooks";
import { resolveMapColor } from "@/lib/mapColor";
import {
  LABEL_PRIORITY,
  LABEL_TOKEN,
  mapLabelProps,
  useVisibleLabels,
  type LabelItem,
} from "@/lib/mapLabels";
import { useSettledZoom } from "./hooks/useSettledZoom";
import type { WaypointRef } from "@/hooks/useDispatchFlow";

interface PendingDispatchProps {
  assignments: DispatchAssignment[];
  vehicles: Vehicle[];
  /** When true, waypoints are draggable / deletable. False during DISPATCH/RESULTS. */
  editable: boolean;
  onMoveWaypointGroup: (refs: WaypointRef[], newLat: number, newLng: number) => void;
  onRemoveWaypointGroup: (refs: WaypointRef[]) => void;
}

/** The pending-dispatch overlay shares the draw tool's blue; hover is the
 *  interaction amber used for vehicle hover rings. */
const DRAW_TOKEN = "var(--color-overlay-draw)";
const HOVER_TOKEN = "var(--color-overlay-hover)";
const LABEL_ALPHA = 180;
const LINE_ALPHA = 120;

const HIT_PX = 12;
const DRAG_THRESHOLD_PX = 3;

/** Stable empty arrays so an inactive memo never re-registers. */
const NO_LAYERS: Layer[] = [];
const NO_SHAPES: Shapes = {
  multiMarkers: [],
  multiLines: [],
  nameLabels: [],
  singleMarkers: [],
};

/** Vehicle-name label size and offsets, shared with the declutter pass. */
const LABEL_SIZE = 12;
const MULTI_LABEL_OFFSET: [number, number] = [0, -14];
const SINGLE_LABEL_OFFSET: [number, number] = [0, -10];

/** A waypoint marker's geometry: everything about it that hovering can't change. */
interface BaseMarkerDatum {
  key: string;
  position: [number, number]; // [lng, lat]
  label: string; // "1", "2", ...
  index: number;
  isMultiStop: boolean;
}

interface MarkerDatum extends BaseMarkerDatum {
  enlarged: boolean;
}

/**
 * A single-waypoint marker. Its label is the vehicle's name rather than a stop
 * number, so unlike the multi-stop variant it carries the id the declutter pass
 * keyed that name on.
 */
interface BaseSingleMarkerDatum extends BaseMarkerDatum {
  vehicleId: string;
}

interface SingleMarkerDatum extends BaseSingleMarkerDatum {
  enlarged: boolean;
}

interface LineDatum {
  path: [number, number][];
}

interface NameLabel {
  id: string;
  position: [number, number];
  text: string;
}

/** What the assignments alone determine — the input to both layer memos. */
interface Shapes {
  multiMarkers: BaseMarkerDatum[];
  multiLines: LineDatum[];
  nameLabels: NameLabel[];
  singleMarkers: BaseSingleMarkerDatum[];
}

/** Group identical-position waypoints across assignments so they drag/delete as one. */
function buildGroups(assignments: DispatchAssignment[]): Map<string, WaypointRef[]> {
  const groups = new Map<string, WaypointRef[]>();
  for (const a of assignments) {
    for (let i = 0; i < a.waypoints.length; i++) {
      const wp = a.waypoints[i];
      const key = `${wp.position[0].toFixed(6)},${wp.position[1].toFixed(6)}`;
      const bucket = groups.get(key);
      const ref: WaypointRef = { vehicleId: a.vehicleId, waypointIndex: i };
      if (bucket) bucket.push(ref);
      else groups.set(key, [ref]);
    }
  }
  return groups;
}

function pixDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export default memo(function PendingDispatch({
  assignments,
  vehicles,
  editable,
  onMoveWaypointGroup,
  onRemoveWaypointGroup,
}: PendingDispatchProps) {
  const { viewport, getZoom } = useMapContext();
  const { mapHTMLElement } = useOverlay();
  const { settledZoom } = useSettledZoom(getZoom());

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const vehicleMap = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const groups = useMemo(() => buildGroups(assignments), [assignments]);

  // Refs for stable access inside native DOM handlers
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const dragKeyRef = useRef(dragKey);
  dragKeyRef.current = dragKey;
  const moveRef = useRef(onMoveWaypointGroup);
  moveRef.current = onMoveWaypointGroup;
  const removeRef = useRef(onRemoveWaypointGroup);
  removeRef.current = onRemoveWaypointGroup;

  // Clear transient state when editing turns off
  useEffect(() => {
    if (!editable) {
      setHoverKey(null);
      setDragKey(null);
    }
  }, [editable]);

  // ── Native DOM event handlers (drag / right-click delete / hover) ──
  useEffect(() => {
    if (!editable || !mapHTMLElement) return;

    let downPx: [number, number] | null = null;
    let downKey: string | null = null;

    const getMouse = (e: MouseEvent): { px: [number, number]; geo: [number, number] } | null => {
      const vp = viewportRef.current;
      if (!vp) return null;
      const rect = mapHTMLElement.getBoundingClientRect();
      const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      const geoArr = vp.unproject(px);
      if (!geoArr) return null;
      return { px, geo: [geoArr[0], geoArr[1]] };
    };

    /** Find the waypoint group key closest to the given pixel, within threshold. */
    const findGroup = (px: [number, number]): string | null => {
      const vp = viewportRef.current;
      if (!vp) return null;
      let bestKey: string | null = null;
      let bestDist = Infinity;
      for (const key of groupsRef.current.keys()) {
        const [latStr, lngStr] = key.split(",");
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        const p = vp.project([lng, lat]);
        const d = pixDist(px[0], px[1], p[0], p[1]);
        if (d <= HIT_PX && d < bestDist) {
          bestDist = d;
          bestKey = key;
        }
      }
      return bestKey;
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      const m = getMouse(e);
      if (!m || downPx === null || downKey === null) return;

      if (dragKeyRef.current === null) {
        const d = pixDist(downPx[0], downPx[1], m.px[0], m.px[1]);
        if (d <= DRAG_THRESHOLD_PX) return;
        setDragKey(downKey);
      }

      const refs = groupsRef.current.get(downKey);
      if (!refs || refs.length === 0) return;
      // waypoint.position is stored as [lat, lng]
      moveRef.current(refs, m.geo[1], m.geo[0]);
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);

      const wasInteractingWithMarker = downKey !== null;
      const wasDragging = dragKeyRef.current !== null;
      if (wasDragging) setDragKey(null);

      // Suppress the synthetic click so App.tsx's onMapClick doesn't also
      // treat this as "add a new waypoint at the release point".
      if (wasInteractingWithMarker || wasDragging) {
        const suppress = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", suppress, {
          capture: true,
          once: true,
        });
      }

      downPx = null;
      downKey = null;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const m = getMouse(e);
      if (!m) return;
      const key = findGroup(m.px);
      if (!key) return;

      // Intercept before deck.gl's pan controller sees it.
      e.stopPropagation();
      e.preventDefault();
      downPx = m.px;
      downKey = key;
      window.addEventListener("mousemove", handleWindowMouseMove, true);
      window.addEventListener("mouseup", handleWindowMouseUp, true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (dragKeyRef.current !== null || downKey !== null) return;
      const m = getMouse(e);
      if (!m) return;
      const key = findGroup(m.px);
      setHoverKey(key);
    };

    const handleMouseLeave = () => {
      if (dragKeyRef.current !== null) return;
      setHoverKey(null);
    };

    const handleContextMenu = (e: MouseEvent) => {
      const m = getMouse(e);
      if (!m) return;
      const key = findGroup(m.px);
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      const refs = groupsRef.current.get(key);
      if (refs && refs.length > 0) removeRef.current(refs);
      setHoverKey(null);
    };

    mapHTMLElement.addEventListener("mousedown", handleMouseDown, true);
    mapHTMLElement.addEventListener("mousemove", handleMouseMove);
    mapHTMLElement.addEventListener("mouseleave", handleMouseLeave);
    mapHTMLElement.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      mapHTMLElement.removeEventListener("mousedown", handleMouseDown, true);
      mapHTMLElement.removeEventListener("mousemove", handleMouseMove);
      mapHTMLElement.removeEventListener("mouseleave", handleMouseLeave);
      mapHTMLElement.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
    };
  }, [editable, mapHTMLElement]);

  // ── Label declutter ───────────────────────────────────────────────
  // Vehicle names on pending waypoints are decluttered against every other map
  // label. The waypoint *numbers* are deliberately left out: they sit inside
  // their own marker, so hiding one would leave an unlabelled dot.
  const { multiLabels, singleLabels } = useMemo(() => {
    const multi: LabelItem[] = [];
    const single: LabelItem[] = [];
    for (const assignment of assignments) {
      if (!vehicleMap.has(assignment.vehicleId) || assignment.waypoints.length === 0) continue;
      const [lat, lng] = assignment.waypoints[0].position;
      const item: LabelItem = {
        id: assignment.vehicleId,
        position: [lng, lat],
        text: assignment.vehicleName,
        size: LABEL_SIZE,
        priority: LABEL_PRIORITY.dispatch,
      };
      if (assignment.waypoints.length > 1) {
        multi.push({ ...item, pixelOffset: MULTI_LABEL_OFFSET });
      } else {
        single.push({ ...item, pixelOffset: SINGLE_LABEL_OFFSET });
      }
    }
    return { multiLabels: multi, singleLabels: single };
  }, [assignments, vehicleMap]);

  const visibleMulti = useVisibleLabels(
    "pending-dispatch-multi-labels",
    multiLabels,
    viewport,
    settledZoom
  );
  const visibleSingle = useVisibleLabels(
    "pending-dispatch-single-labels",
    singleLabels,
    viewport,
    settledZoom
  );

  // ── Shapes ────────────────────────────────────────────────────────
  // What the assignments say, with nothing the pointer can change folded in.
  // The label layers below read `nameLabels` and `singleMarkers` from here, so
  // a hover — which rebuilds the geometry layers — leaves their inputs alone.
  const shapes = useMemo<Shapes>(() => {
    if (assignments.length === 0) return NO_SHAPES;

    const multiMarkers: BaseMarkerDatum[] = [];
    const multiLines: LineDatum[] = [];
    const nameLabels: NameLabel[] = [];
    const singleMarkers: BaseSingleMarkerDatum[] = [];

    for (const assignment of assignments) {
      const vehicle = vehicleMap.get(assignment.vehicleId);
      if (!vehicle || assignment.waypoints.length === 0) continue;

      const isMultiStop = assignment.waypoints.length > 1;

      // Waypoint.position is [lat, lng] — deck.gl wants [lng, lat]
      const positions = assignment.waypoints.map(
        (wp) => [wp.position[1], wp.position[0]] as [number, number]
      );

      if (isMultiStop) {
        for (let i = 1; i < positions.length; i++) {
          multiLines.push({ path: [positions[i - 1], positions[i]] });
        }
        for (let i = 0; i < positions.length; i++) {
          const key = `${assignment.waypoints[i].position[0].toFixed(6)},${assignment.waypoints[i].position[1].toFixed(6)}`;
          multiMarkers.push({
            key,
            position: positions[i],
            label: `${i + 1}`,
            index: i + 1,
            isMultiStop: true,
          });
        }
        nameLabels.push({
          id: assignment.vehicleId,
          position: positions[0],
          text: assignment.vehicleName,
        });
      } else {
        const key = `${assignment.waypoints[0].position[0].toFixed(6)},${assignment.waypoints[0].position[1].toFixed(6)}`;
        singleMarkers.push({
          key,
          vehicleId: assignment.vehicleId,
          position: positions[0],
          label: assignment.vehicleName,
          index: 1,
          isMultiStop: false,
        });
      }
    }

    return { multiMarkers, multiLines, nameLabels, singleMarkers };
  }, [assignments, vehicleMap]);

  // ── Render layers ─────────────────────────────────────────────────
  // Geometry and name labels live in separate memos: a label verdict changes
  // whenever anything anywhere on the map moves, and rebuilding the waypoint
  // markers and connecting lines for that would re-upload them for nothing.
  const geometryLayers = useMemo<Layer[]>(() => {
    const { multiLines } = shapes;
    if (shapes.multiMarkers.length === 0 && shapes.singleMarkers.length === 0) return NO_LAYERS;

    // Resolved here, not at module load: resolveMapColor caches its first
    // answer, which at module-eval time predates the stylesheet.
    const drawRgba = resolveMapColor(DRAW_TOKEN);
    const lineRgba = resolveMapColor(DRAW_TOKEN, LINE_ALPHA);
    const hoverRgba = resolveMapColor(HOVER_TOKEN);
    const inkRgba = resolveMapColor(LABEL_TOKEN);

    // The one thing the pointer changes, applied here rather than baked into
    // the shapes above.
    const isEnlarged = (key: string) => editable && (key === hoverKey || key === dragKey);
    const multiMarkers: MarkerDatum[] = shapes.multiMarkers.map((m) => ({
      ...m,
      enlarged: isEnlarged(m.key),
    }));
    const singleMarkers: SingleMarkerDatum[] = shapes.singleMarkers.map((m) => ({
      ...m,
      enlarged: isEnlarged(m.key),
    }));

    const result: Layer[] = [];

    // Multi-stop connecting lines
    if (multiLines.length > 0) {
      result.push(
        new PathLayer<LineDatum>({
          id: "pending-dispatch-multi-lines",
          data: multiLines,
          getPath: (d) => d.path,
          getColor: lineRgba,
          getWidth: 1,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          pickable: false,
        })
      );
    }

    // Multi-stop numbered markers
    if (multiMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<MarkerDatum>({
          id: "pending-dispatch-multi-markers",
          data: multiMarkers,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.enlarged ? 8 : 6),
          radiusUnits: "pixels",
          getFillColor: (d) => (d.enlarged ? hoverRgba : drawRgba),
          getLineColor: inkRgba,
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
          updateTriggers: {
            getRadius: [hoverKey, dragKey, editable],
            getFillColor: [hoverKey, dragKey, editable],
          },
        })
      );
      result.push(
        new TextLayer<MarkerDatum>({
          ...mapLabelProps(10),
          id: "pending-dispatch-multi-numbers",
          data: multiMarkers,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: inkRgba,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          pickable: false,
        })
      );
    }

    // Single-waypoint outer ring
    if (singleMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<SingleMarkerDatum>({
          id: "pending-dispatch-single-outer",
          data: singleMarkers,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.enlarged ? 7 : 5),
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          getLineColor: (d) => (d.enlarged ? hoverRgba : drawRgba),
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
          updateTriggers: {
            getRadius: [hoverKey, dragKey, editable],
            getLineColor: [hoverKey, dragKey, editable],
          },
        })
      );
      result.push(
        new ScatterplotLayer<SingleMarkerDatum>({
          id: "pending-dispatch-single-inner",
          data: singleMarkers,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.enlarged ? 2.5 : 1.5),
          radiusUnits: "pixels",
          getFillColor: (d) => (d.enlarged ? hoverRgba : drawRgba),
          stroked: false,
          pickable: false,
          updateTriggers: {
            getRadius: [hoverKey, dragKey, editable],
            getFillColor: [hoverKey, dragKey, editable],
          },
        })
      );
    }

    return result.length === 0 ? NO_LAYERS : result;
  }, [shapes, hoverKey, dragKey, editable]);

  const labelLayers = useMemo<Layer[]>(() => {
    const labelRgba = resolveMapColor(DRAW_TOKEN, LABEL_ALPHA);
    const result: Layer[] = [];

    const multi = shapes.nameLabels.filter((label) => visibleMulti.has(label.id));
    if (multi.length > 0) {
      result.push(
        new TextLayer<NameLabel>({
          ...mapLabelProps(LABEL_SIZE),
          id: "pending-dispatch-multi-labels",
          data: multi,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getColor: labelRgba,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: MULTI_LABEL_OFFSET,
          pickable: false,
        })
      );
    }

    const single = shapes.singleMarkers.filter((marker) => visibleSingle.has(marker.vehicleId));
    if (single.length > 0) {
      result.push(
        new TextLayer<BaseSingleMarkerDatum>({
          ...mapLabelProps(LABEL_SIZE),
          id: "pending-dispatch-single-labels",
          data: single,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: labelRgba,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: SINGLE_LABEL_OFFSET,
          pickable: false,
        })
      );
    }

    return result.length === 0 ? NO_LAYERS : result;
  }, [shapes.nameLabels, shapes.singleMarkers, visibleMulti, visibleSingle]);

  const layers = useMemo(
    () => (labelLayers.length === 0 ? geometryLayers : [...geometryLayers, ...labelLayers]),
    [geometryLayers, labelLayers]
  );

  useRegisterLayers("pending-dispatch", layers);

  return null;
});
