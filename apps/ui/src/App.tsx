import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import Vehicles from "./Controls/Vehicles";
import Fleets from "./Controls/Fleets";
import Incidents from "./Controls/Incidents";
import RecordReplay from "./Controls/RecordReplay";
import DispatchFooter from "./Controls/DispatchFooter";
import IconRail from "./Controls/IconRail";
import type { PanelId } from "./Controls/IconRail";
import BottomDock from "./Controls/BottomDock";
import TogglesPanel from "./Controls/TogglesPanel";
import SpeedPanel from "./Controls/SpeedPanel";
import ClockPanel from "./Controls/ClockPanel";
import AdapterDrawer from "./Controls/Adapter/AdapterDrawer";
import { useAdapterConfig } from "./Controls/Adapter/useAdapterConfig";
import useTracking from "./Controls/useTracking";
import MapView from "./Map/Map";
import FleetLegend from "./Map/FleetLegend";
import SearchBar from "./SearchBar";
import Zoom from "./Zoom/";
import type {
  DirectionResult,
  DispatchAssignment,
  Fleet,
  IncidentType,
  Modifiers,
  POI,
  Position,
  Road,
  SimulationStatus,
  Waypoint,
} from "./types";
import styles from "./App.module.css";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import { useIncidents } from "./hooks/useIncidents";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { useDispatchState, DispatchState } from "./hooks/useDispatchState";
import useContextMenu from "./hooks/useContextMenu";
import ContextMenu from "./components/ContextMenu";
import MapContextMenu from "./components/MapContextMenu";
import { isRoad } from "./utils/typeGuards";

export default function App() {
  const [onContextClick, ref, xy, closeContextMenu] = useContextMenu();
  const [selectedItem, setSelectedItem] = useState<Road | POI | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [dispatchMode, setDispatchMode] = useState(false);
  const [assignments, setAssignments] = useState<DispatchAssignment[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [results, setResults] = useState<DirectionResult[]>([]);
  const [selectedForDispatch, setSelectedForDispatch] = useState<string[]>([]);
  const [status, setStatus] = useState<SimulationStatus>({
    interval: 0,
    running: false,
    ready: false,
  });

  const [connected, setConnected] = useState(false);
  const adapter = useAdapterConfig(activePanel === "adapter");
  const {
    vehicles,
    modifiers,
    filters,
    setVehicles,
    onSelectVehicle,
    onUnselectVehicle,
    onHoverVehicle,
    onUnhoverVehicle,
    setModifiers,
    onFilterChange,
  } = useVehicles();

  const { fleets, createFleet, deleteFleet, hiddenFleetIds, toggleFleetVisibility } = useFleets();

  const incidents = useIncidents();
  const recording = useRecording();
  const replay = useReplay();

  const vehicleFleetMap = useMemo(() => {
    const map = new Map<string, Fleet>();
    for (const fleet of fleets) {
      for (const vid of fleet.vehicleIds) {
        map.set(vid, fleet);
      }
    }
    return map;
  }, [fleets]);

  const dispatchState = useDispatchState({
    dispatchMode,
    selectedForDispatch,
    assignments,
    dispatching,
    results,
  });

  const onChangeModifiers = useCallback(
    <T extends keyof Modifiers>(name: T) =>
      (value: Modifiers[T]) => {
        setModifiers((prev) => ({
          ...prev,
          [name]: value,
        }));
      },
    [setModifiers]
  );

  const clearMap = useCallback(() => {
    closeContextMenu();
    setDestination(null);
    onUnselectVehicle();
    setSelectedItem(null);
  }, [closeContextMenu, onUnselectVehicle]);

  const onMapClick = useCallback(
    (_event?: React.MouseEvent, position?: Position) => {
      if (dispatchState === DispatchState.ROUTE && position && selectedForDispatch.length > 0) {
        const newWaypoint: Waypoint = { position: [position[1], position[0]] };

        setAssignments((prev) => {
          // Append waypoint to existing assignments for selected vehicles
          const updated = prev.map((a) => {
            if (!selectedForDispatch.includes(a.vehicleId)) return a;
            return { ...a, waypoints: [...a.waypoints, newWaypoint] };
          });

          // Create new assignments for vehicles not yet assigned
          const existingIds = new Set(updated.map((a) => a.vehicleId));
          const newAssignments: DispatchAssignment[] = selectedForDispatch
            .filter((id) => !existingIds.has(id))
            .map((id) => {
              const vehicle = vehicles.find((v) => v.id === id);
              return {
                vehicleId: id,
                vehicleName: vehicle?.name ?? id,
                waypoints: [newWaypoint],
              };
            });

          return [...updated, ...newAssignments];
        });
        // Do NOT clear selectedForDispatch — user can keep adding waypoints
        return;
      }
      clearMap();
    },
    [clearMap, dispatchState, selectedForDispatch, vehicles]
  );

  const onAddWaypoint = useCallback((vehicleId: string, position: Position) => {
    const newWaypoint: Waypoint = { position: [position[1], position[0]] };
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.vehicleId !== vehicleId) return a;
        return { ...a, waypoints: [...a.waypoints, newWaypoint] };
      })
    );
  }, []);

  const onContextMenuAddWaypoint = useCallback(() => {
    if (!destination) return;
    const assignedIds = new Set(assignments.map((a) => a.vehicleId));

    for (const id of selectedForDispatch) {
      if (assignedIds.has(id)) {
        onAddWaypoint(id, destination);
      }
    }

    const newAssignments: DispatchAssignment[] = selectedForDispatch
      .filter((id) => !assignedIds.has(id))
      .map((id) => {
        const vehicle = vehicles.find((v) => v.id === id);
        const newWaypoint: Waypoint = { position: [destination[1], destination[0]] };
        return {
          vehicleId: id,
          vehicleName: vehicle?.name ?? id,
          waypoints: [newWaypoint],
        };
      });

    if (newAssignments.length > 0) {
      setAssignments((prev) => [...prev, ...newAssignments]);
    }

    closeContextMenu();
  }, [destination, selectedForDispatch, assignments, vehicles, onAddWaypoint, closeContextMenu]);

  const onCreateIncident = useCallback(
    (type: IncidentType) => {
      if (!destination) return;
      incidents.createAtPosition(destination[1], destination[0], type);
      closeContextMenu();
    },
    [destination, incidents, closeContextMenu]
  );

  const handleDispatch = useCallback(async () => {
    if (assignments.length === 0) return;
    setDispatching(true);
    setResults([]);

    const body = assignments.map((a) => {
      const dest = a.waypoints[a.waypoints.length - 1];
      return {
        id: a.vehicleId,
        lat: dest.position[0],
        lng: dest.position[1],
        ...(a.waypoints.length > 1
          ? {
              waypoints: a.waypoints.map((wp) => ({
                lat: wp.position[0],
                lng: wp.position[1],
                ...(wp.label ? { label: wp.label } : {}),
                ...(wp.dwellTime != null ? { dwellTime: wp.dwellTime } : {}),
              })),
            }
          : {}),
      };
    });

    try {
      const response = await client.batchDirection(body);
      if (response.data?.results) {
        setResults(response.data.results);
      }
    } catch (error) {
      console.error("Dispatch failed:", error);
    } finally {
      setDispatching(false);
    }
  }, [assignments]);

  const handleDone = useCallback(() => {
    setDispatchMode(false);
    setSelectedForDispatch([]);
    setAssignments([]);
    setResults([]);
    setDispatching(false);
  }, []);

  const handleRetryFailed = useCallback(() => {
    const failedIds = results.filter((r) => r.status === "error").map((r) => r.vehicleId);
    setSelectedForDispatch(failedIds);
    setAssignments((prev) => prev.filter((a) => failedIds.includes(a.vehicleId)));
    setResults([]);
  }, [results]);

  const onToggleVehicleForDispatch = useCallback((id: string) => {
    setSelectedForDispatch((prev) =>
      prev.includes(id) ? prev.filter((vid) => vid !== id) : [...prev, id]
    );
  }, []);

  const setFinalDestination = useCallback(async (position: Position, vehicleIds: string[]) => {
    const coordinates = await client.findNode(position);
    if (!coordinates.data) return;
    await client.direction(vehicleIds, coordinates.data);
  }, []);

  const onDestinationClick = useCallback(async () => {
    let coordinates: Position;
    if (!selectedItem) return;
    if (isRoad(selectedItem)) {
      const getOne = (arr: Position[]) => arr[Math.floor(Math.random() * arr.length)];
      coordinates = getOne(selectedItem.streets.flat());
    } else {
      coordinates = [selectedItem.coordinates[1], selectedItem.coordinates[0]];
    }
    await setFinalDestination(
      coordinates,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [selectedItem, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationClick = useCallback(async () => {
    await setFinalDestination(
      destination!,
      vehicles.map((v) => v.id)
    );
    clearMap();
  }, [destination, vehicles, setFinalDestination, clearMap]);

  const onPointDestinationSingleClick = useCallback(async () => {
    await setFinalDestination(destination!, [filters.selected!]);
    clearMap();
  }, [destination, filters.selected, setFinalDestination, clearMap]);

  const onFindRoadClick = useCallback(async () => {
    const road = await client.findRoad(destination!);
    if (road.data) setSelectedItem(road.data);
    closeContextMenu();
  }, [destination, closeContextMenu]);

  const onMapContextClick = useCallback(
    (e: React.MouseEvent, position: Position) => {
      setDestination(position);
      onContextClick(e);
    },
    [onContextClick]
  );

  // Auto-open sidebar when dispatch mode is activated
  useEffect(() => {
    if (dispatchMode) {
      setActivePanel("vehicles");
    }
  }, [dispatchMode]);

  useEffect(() => {
    client.getVehicles().then((response) => {
      if (response.error) {
        console.error("Failed to fetch vehicles:", response.error);
        return;
      }
      if (response.data) {
        setVehicles(response.data);
      }
    });
  }, [setVehicles]);

  useEffect(() => {
    client.onConnect(() => {
      setConnected(true);
      // Re-fetch full state on reconnect
      client.getVehicles().then((response) => {
        if (response.data) setVehicles(response.data);
      });
    });
    client.onDisconnect(() => setConnected(false));
    client.onStatus((data) => {
      setStatus(data);
    });
    client.onReset((data) => {
      setVehicles(data.vehicles);
      setSelectedItem(null);
      setDestination(null);
      onUnselectVehicle();
    });
    client.getStatus().then((response) => {
      if (response.data) {
        setStatus(response.data);
      }
    });

    client.connectWebSocket();
    return () => client.disconnect();
  }, [setVehicles, onUnselectVehicle]);

  const maxSpeedRef = useRef(60);
  useTracking(vehicles, filters.selected, status.interval);

  return (
    <div className={styles.app}>
      <div className={styles.content}>
        <IconRail
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          incidentCount={incidents.incidents.length}
        />
        <aside
          className={classNames(styles.panelRail, styles.leftPanel, {
            [styles.leftPanelOpen]: activePanel !== null,
          })}
          aria-hidden={activePanel === null}
        >
          <div className={styles.panelInner}>
            {activePanel === "vehicles" && (
              <>
                <button
                  type="button"
                  className={classNames(styles.dispatchToggle, {
                    [styles.dispatchToggleActive]: dispatchMode,
                  })}
                  onClick={() => {
                    setDispatchMode((prev) => {
                      if (prev) {
                        setSelectedForDispatch([]);
                        setAssignments([]);
                        setResults([]);
                        setDispatching(false);
                      }
                      return !prev;
                    });
                  }}
                >
                  {dispatchMode ? "Exit Dispatch" : "Dispatch"}
                </button>
                <Vehicles
                  filter={filters.filter}
                  onFilterChange={onFilterChange}
                  vehicles={vehicles}
                  onSelectVehicle={onSelectVehicle}
                  onHoverVehicle={onHoverVehicle}
                  onUnhoverVehicle={onUnhoverVehicle}
                  maxSpeed={maxSpeedRef.current}
                  fleets={fleets}
                  dispatchState={dispatchState}
                  selectedForDispatch={selectedForDispatch}
                  onToggleVehicleForDispatch={onToggleVehicleForDispatch}
                  assignments={assignments}
                  results={results}
                />
                <DispatchFooter
                  state={dispatchState}
                  selectedCount={selectedForDispatch.length}
                  assignments={assignments}
                  results={results}
                  onDispatch={handleDispatch}
                  onClear={handleDone}
                  onDone={handleDone}
                  onRetryFailed={handleRetryFailed}
                  dispatching={dispatching}
                />
              </>
            )}
            {activePanel === "fleets" && (
              <Fleets fleets={fleets} onCreateFleet={createFleet} onDeleteFleet={deleteFleet} />
            )}
            {activePanel === "incidents" && (
              <Incidents
                incidents={incidents.incidents}
                createRandom={incidents.createRandom}
                remove={incidents.remove}
              />
            )}
            {activePanel === "recordings" && (
              <RecordReplay
                recording={recording}
                replayStatus={replay.replayStatus}
                onStartReplay={replay.startReplay}
              />
            )}
            {activePanel === "toggles" && (
              <TogglesPanel modifiers={modifiers} onChangeModifiers={onChangeModifiers} />
            )}
            {activePanel === "speed" && <SpeedPanel maxSpeedRef={maxSpeedRef} />}
            {activePanel === "clock" && <ClockPanel />}
            {activePanel === "adapter" && (
              <AdapterDrawer
                isOpen={true}
                health={adapter.health}
                config={adapter.config}
                loading={adapter.loading}
                error={adapter.error}
                onClose={() => setActivePanel(null)}
                onSetSource={adapter.setSource}
                onAddSink={adapter.addSink}
                onRemoveSink={adapter.removeSink}
              />
            )}
          </div>
        </aside>
        <div className={styles.map}>
          {!connected && (
            <div className={styles.disconnectedBanner} role="alert">
              Disconnected — attempting to reconnect...
            </div>
          )}
          <MapView
            vehicles={vehicles}
            filters={filters}
            modifiers={modifiers}
            selectedItem={selectedItem}
            onClick={onSelectVehicle}
            onMapClick={onMapClick}
            onMapContextClick={onMapContextClick}
            onPOIClick={(poi) => setSelectedItem(poi)}
            vehicleFleetMap={vehicleFleetMap}
            hiddenFleetIds={hiddenFleetIds}
            dispatchState={dispatchState}
            assignments={assignments}
            incidents={incidents.incidents}
          />
          <SearchBar
            selectedItem={selectedItem}
            onDestinationClick={onDestinationClick}
            onItemSelect={(item) => setSelectedItem(item)}
            onItemUnselect={() => setSelectedItem(null)}
          />
          <Zoom />
          <FleetLegend
            fleets={fleets}
            hiddenFleetIds={hiddenFleetIds}
            onToggle={toggleFleetVisibility}
          />
          <BottomDock
            status={status}
            connected={connected}
            vehicleCount={vehicles.length}
            replayStatus={replay.replayStatus}
            onPauseReplay={replay.pauseReplay}
            onResumeReplay={replay.resumeReplay}
            onStopReplay={replay.stopReplay}
            onSeekReplay={replay.seekReplay}
            onSetReplaySpeed={replay.setReplaySpeed}
            isRecording={recording.isRecording}
            onStartRecording={recording.startRecording}
            onStopRecording={recording.stopRecording}
          />
        </div>
      </div>
      {xy && (
        <ContextMenu position={xy}>
          <div ref={ref} className={styles.contextMenu}>
            <MapContextMenu
              state={dispatchState}
              onFindDirections={onPointDestinationClick}
              onFindRoad={onFindRoadClick}
              onSendVehicle={onPointDestinationSingleClick}
              onAddWaypoint={onContextMenuAddWaypoint}
              onCreateIncident={onCreateIncident}
              hasSelectedVehicle={!!filters.selected}
              hasDispatchSelection={selectedForDispatch.length > 0}
            />
          </div>
        </ContextMenu>
      )}
    </div>
  );
}
