import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ScatterplotLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import type { Vehicle, DispatchAssignment } from "@/types";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useMapContext, useOverlay } from "@/components/Map/hooks";
import { resolveMapColor } from "@/lib/mapColor";
import { mapLabelProps } from "@/lib/mapLabels";
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
const LABEL_TOKEN = "var(--color-map-label)";
const LABEL_ALPHA = 180;
const LINE_ALPHA = 120;

const HIT_PX = 12;
const DRAG_THRESHOLD_PX = 3;

interface MarkerDatum {
  key: string;
  position: [number, number]; // [lng, lat]
  label: string; // "1", "2", ...
  index: number;
  isMultiStop: boolean;
  enlarged: boolean;
}

interface LineDatum {
  path: [number, number][];
}

interface NameLabel {
  position: [number, number];
  text: string;
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
  const { viewport } = useMapContext();
  const { mapHTMLElement } = useOverlay();

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

  // ── Render layers ─────────────────────────────────────────────────
  const layers = useMemo(() => {
    if (assignments.length === 0) return [];

    // Resolved here, not at module load: resolveMapColor caches its first
    // answer, which at module-eval time predates the stylesheet.
    const drawRgba = resolveMapColor(DRAW_TOKEN);
    const labelRgba = resolveMapColor(DRAW_TOKEN, LABEL_ALPHA);
    const lineRgba = resolveMapColor(DRAW_TOKEN, LINE_ALPHA);
    const hoverRgba = resolveMapColor(HOVER_TOKEN);
    const inkRgba = resolveMapColor(LABEL_TOKEN);

    const multiMarkers: MarkerDatum[] = [];
    const multiLines: LineDatum[] = [];
    const nameLabels: NameLabel[] = [];
    const singleMarkers: MarkerDatum[] = [];

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
            enlarged: editable && (key === hoverKey || key === dragKey),
          });
        }
        nameLabels.push({
          position: positions[0],
          text: assignment.vehicleName,
        });
      } else {
        const key = `${assignment.waypoints[0].position[0].toFixed(6)},${assignment.waypoints[0].position[1].toFixed(6)}`;
        singleMarkers.push({
          key,
          position: positions[0],
          label: assignment.vehicleName,
          index: 1,
          isMultiStop: false,
          enlarged: editable && (key === hoverKey || key === dragKey),
        });
      }
    }

    const result = [];

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

    // Multi-stop vehicle name labels
    if (nameLabels.length > 0) {
      result.push(
        new TextLayer<NameLabel>({
          ...mapLabelProps(12),
          id: "pending-dispatch-multi-labels",
          data: nameLabels,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getColor: labelRgba,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -14],
          pickable: false,
        })
      );
    }

    // Single-waypoint outer ring
    if (singleMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<MarkerDatum>({
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
        new ScatterplotLayer<MarkerDatum>({
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
      result.push(
        new TextLayer<MarkerDatum>({
          ...mapLabelProps(12),
          id: "pending-dispatch-single-labels",
          data: singleMarkers,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: labelRgba,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -10],
          pickable: false,
        })
      );
    }

    return result;
  }, [assignments, vehicleMap, hoverKey, dragKey, editable]);

  useRegisterLayers("pending-dispatch", layers);

  return null;
});
