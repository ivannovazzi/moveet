import { memo, useMemo } from "react";
import { ScatterplotLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import type { Vehicle, DispatchAssignment } from "@/types";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

interface PendingDispatchProps {
  assignments: DispatchAssignment[];
  vehicles: Vehicle[];
}

const COLOR_RGBA: [number, number, number, number] = [57, 153, 255, 180]; // rgba(57,153,255,0.7)
const COLOR_SOLID_RGBA: [number, number, number, number] = [51, 153, 255, 255]; // #39f
const WHITE_RGBA: [number, number, number, number] = [255, 255, 255, 255];

interface MarkerDatum {
  position: [number, number]; // [lng, lat]
  label: string;
  index: number; // 1-based for display
}

interface LineDatum {
  path: [number, number][]; // [[lng,lat],[lng,lat]]
}

export default memo(function PendingDispatch({ assignments, vehicles }: PendingDispatchProps) {
  const vehicleMap = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const layers = useMemo(() => {
    if (assignments.length === 0) return [];

    const multiMarkers: MarkerDatum[] = [];
    const multiLines: LineDatum[] = [];
    const multiLabels: { position: [number, number]; text: string }[] = [];

    const singleMarkers: { position: [number, number]; label: string }[] = [];
    const singleInnerMarkers: { position: [number, number] }[] = [];

    for (const assignment of assignments) {
      const vehicle = vehicleMap.get(assignment.vehicleId);
      if (!vehicle || assignment.waypoints.length === 0) continue;

      const isMultiStop = assignment.waypoints.length > 1;

      if (isMultiStop) {
        // Waypoint positions: position is [lat, lng], deck.gl needs [lng, lat]
        const positions = assignment.waypoints.map(
          (wp) => [wp.position[1], wp.position[0]] as [number, number]
        );

        // Connecting lines between consecutive waypoints
        for (let i = 1; i < positions.length; i++) {
          multiLines.push({ path: [positions[i - 1], positions[i]] });
        }

        // Numbered markers at each waypoint
        for (let i = 0; i < positions.length; i++) {
          multiMarkers.push({
            position: positions[i],
            label: `${i + 1}`,
            index: i + 1,
          });
        }

        // Vehicle name label at first waypoint
        multiLabels.push({
          position: positions[0],
          text: assignment.vehicleName,
        });
      } else {
        // Single waypoint: target circle
        const dest = assignment.waypoints[0];
        const pos: [number, number] = [dest.position[1], dest.position[0]];

        singleMarkers.push({ position: pos, label: assignment.vehicleName });
        singleInnerMarkers.push({ position: pos });
      }
    }

    const result = [];

    // Multi-waypoint dashed connecting lines
    if (multiLines.length > 0) {
      result.push(
        new PathLayer<LineDatum>({
          id: "pending-dispatch-multi-lines",
          data: multiLines,
          getPath: (d) => d.path,
          getColor: [57, 153, 255, 120] as [number, number, number, number],
          getWidth: 1,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          pickable: false,
        })
      );
    }

    // Multi-waypoint numbered circle markers
    if (multiMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<MarkerDatum>({
          id: "pending-dispatch-multi-markers",
          data: multiMarkers,
          getPosition: (d) => d.position,
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: COLOR_SOLID_RGBA,
          getLineColor: WHITE_RGBA,
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
        })
      );
      result.push(
        new TextLayer<MarkerDatum>({
          id: "pending-dispatch-multi-numbers",
          data: multiMarkers,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: WHITE_RGBA,
          getSize: 10,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontWeight: "bold",
          pickable: false,
        })
      );
    }

    // Multi-waypoint vehicle name labels
    if (multiLabels.length > 0) {
      result.push(
        new TextLayer<(typeof multiLabels)[number]>({
          id: "pending-dispatch-multi-labels",
          data: multiLabels,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getColor: COLOR_RGBA,
          getSize: 12,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -10],
          fontWeight: "500",
          pickable: false,
        })
      );
    }

    // Single waypoint: outer ring
    if (singleMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<(typeof singleMarkers)[number]>({
          id: "pending-dispatch-single-outer",
          data: singleMarkers,
          getPosition: (d) => d.position,
          getRadius: 5,
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0], // transparent fill
          getLineColor: COLOR_SOLID_RGBA,
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
        })
      );
    }

    // Single waypoint: inner dot
    if (singleInnerMarkers.length > 0) {
      result.push(
        new ScatterplotLayer<(typeof singleInnerMarkers)[number]>({
          id: "pending-dispatch-single-inner",
          data: singleInnerMarkers,
          getPosition: (d) => d.position,
          getRadius: 1.5,
          radiusUnits: "pixels",
          getFillColor: COLOR_SOLID_RGBA,
          stroked: false,
          pickable: false,
        })
      );
    }

    // Single waypoint: vehicle name labels
    if (singleMarkers.length > 0) {
      result.push(
        new TextLayer<(typeof singleMarkers)[number]>({
          id: "pending-dispatch-single-labels",
          data: singleMarkers,
          getPosition: (d) => d.position,
          getText: (d) => d.label,
          getColor: COLOR_RGBA,
          getSize: 12,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -10],
          fontWeight: "500",
          pickable: false,
        })
      );
    }

    return result;
  }, [assignments, vehicleMap]);

  useRegisterLayers("pending-dispatch", layers);

  return null;
});
