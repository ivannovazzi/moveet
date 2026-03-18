import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import Vehicles from "./Controls/Vehicles";
import Fleets from "./Controls/Fleets";
import Incidents from "./Controls/Incidents";
import RecordReplay from "./Controls/RecordReplay";
import DispatchFooter from "./Controls/DispatchFooter";
import IconRail from "./Controls/IconRail";
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
import GeofencePanel from "./Controls/GeofencePanel";
import CreateZoneDialog from "./Map/Geofence/CreateZoneDialog";
import type {
  Fleet,
  IncidentType,
  Modifiers,
  POI,
  Position,
  Road,
  SimulationStatus,
} from "./types";
import type { GeoFence, GeoFenceEvent, CreateGeoFenceRequest } from "@moveet/shared-types";
import styles from "./App.module.css";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import { useIncidents } from "./hooks/useIncidents";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { DispatchState } from "./hooks/useDispatchState";
import { useDispatchFlow } from "./hooks/useDispatchFlow";
import { usePanelNavigation } from "./hooks/usePanelNavigation";
import useContextMenu from "./hooks/useContextMenu";
import ContextMenu from "./components/ContextMenu";
import MapContextMenu from "./components/MapContextMenu";
import ConnectionStatus from "./components/ConnectionStatus";
import { useConnectionState } from "./hooks/useConnectionState";
import { isRoad } from "./utils/typeGuards";
import ErrorBoundary, { SectionErrorFallback } from "./components/ErrorBoundary";
import { toLatLng } from "./utils/coordinates";
import { analyticsStore } from "./hooks/analyticsStore";
import { useAnalytics } from "./hooks/useAnalytics";
import AnalyticsPanel from "./Controls/AnalyticsPanel";

export default function App() {
  const [onContextClick, ref, xy, closeContextMenu] = useContextMenu();
  const [selectedItem, setSelectedItem] = useState<Road | POI | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);
  const [status, setStatus] = useState<SimulationStatus>({
    interval: 0,
    running: false,
    ready: false,
  });

  const [connected, setConnected] = useState(false);
  const connectionInfo = useConnectionState();

  // ─── Geofencing state ───────────────────────────────────────────
  const [fences, setFences] = useState<GeoFence[]>([]);
  const [alerts, setAlerts] = useState<GeoFenceEvent[]>([]);
  const [drawingActive, setDrawingActive] = useState(false);
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null);

  const dispatch = useDispatchFlow();
  const { activePanel, setActivePanel, closePanel } = usePanelNavigation(dispatch.dispatchMode);

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
  const analytics = useAnalytics();

  const vehicleFleetMap = useMemo(() => {
    const map = new Map<string, Fleet>();
    for (const fleet of fleets) {
      for (const vid of fleet.vehicleIds) {
        map.set(vid, fleet);
      }
    }
    return map;
  }, [fleets]);

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
      if (
        dispatch.dispatchState === DispatchState.ROUTE &&
        position &&
        dispatch.selectedForDispatch.length > 0
      ) {
        dispatch.addWaypointForSelected(position, vehicles);
        return;
      }
      clearMap();
    },
    [clearMap, dispatch, vehicles]
  );

  const onContextMenuAddWaypoint = useCallback(() => {
    if (!destination) return;
    const assignedIds = new Set(dispatch.assignments.map((a) => a.vehicleId));

    for (const id of dispatch.selectedForDispatch) {
      if (assignedIds.has(id)) {
        dispatch.onAddWaypoint(id, destination);
      }
    }

    const newAssignments = dispatch.selectedForDispatch
      .filter((id) => !assignedIds.has(id))
      .map((id) => {
        const vehicle = vehicles.find((v) => v.id === id);
        return {
          vehicleId: id,
          vehicleName: vehicle?.name ?? id,
          waypoints: [{ position: toLatLng(destination) as [number, number] }],
        };
      });

    if (newAssignments.length > 0) {
      dispatch.setAssignments((prev) => [...prev, ...newAssignments]);
    }

    closeContextMenu();
  }, [destination, dispatch, vehicles, closeContextMenu]);

  const onCreateIncident = useCallback(
    (type: IncidentType) => {
      if (!destination) return;
      const [lat, lng] = toLatLng(destination);
      incidents.createAtPosition(lat, lng, type);
      closeContextMenu();
    },
    [destination, incidents, closeContextMenu]
  );

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
      coordinates = toLatLng(selectedItem.coordinates);
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

  // ─── Geofence data loading ────────────────────────────────────────
  const fetchFences = useCallback(() => {
    client.getGeofences().then((response) => {
      if (response.data) setFences(response.data);
    });
  }, []);

  useEffect(() => {
    fetchFences();
  }, [fetchFences]);

  const onFenceToggle = useCallback((id: string) => {
    client.toggleGeofence(id).then((response) => {
      if (response.data) {
        setFences((prev) => prev.map((f) => (f.id === id ? response.data! : f)));
      }
    });
  }, []);

  const onFenceDelete = useCallback((id: string) => {
    client.deleteGeofence(id).then(() => {
      setFences((prev) => prev.filter((f) => f.id !== id));
    });
  }, []);

  const onDrawComplete = useCallback((polygon: [number, number][]) => {
    setDrawingActive(false);
    setPendingPolygon(polygon);
  }, []);

  const onDrawCancel = useCallback(() => {
    setDrawingActive(false);
    setPendingPolygon(null);
  }, []);

  const onCreateZone = useCallback((req: CreateGeoFenceRequest) => {
    client.createGeofence(req).then((response) => {
      if (response.data) {
        setFences((prev) => [...prev, response.data!]);
      }
      setPendingPolygon(null);
    });
  }, []);

  useEffect(() => {
    client.onConnect(() => {
      setConnected(true);
      analyticsStore.clear();
      // Re-fetch full state on reconnect
      client.getVehicles().then((response) => {
        if (response.data) setVehicles(response.data);
      });
    });
    client.onDisconnect(() => setConnected(false));
    client.onAnalytics((snapshot) => analyticsStore.push(snapshot));
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

    client.onGeofenceEvent((event) => {
      setAlerts((prev) => {
        const next = [event, ...prev];
        return next.length > 200 ? next.slice(0, 200) : next;
      });
    });

    client.connectWebSocket();
    return () => {
      client.offGeofenceEvent();
      client.disconnect();
    };
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
        <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
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
                      [styles.dispatchToggleActive]: dispatch.dispatchMode,
                    })}
                    onClick={dispatch.toggleDispatchMode}
                  >
                    {dispatch.dispatchMode ? "Exit Dispatch" : "Dispatch"}
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
                    dispatchState={dispatch.dispatchState}
                    selectedForDispatch={dispatch.selectedForDispatch}
                    onToggleVehicleForDispatch={dispatch.onToggleVehicleForDispatch}
                    assignments={dispatch.assignments}
                    results={dispatch.results}
                  />
                  <DispatchFooter
                    state={dispatch.dispatchState}
                    selectedCount={dispatch.selectedForDispatch.length}
                    assignments={dispatch.assignments}
                    results={dispatch.results}
                    onDispatch={dispatch.handleDispatch}
                    onClear={dispatch.handleDone}
                    onDone={dispatch.handleDone}
                    onRetryFailed={dispatch.handleRetryFailed}
                    dispatching={dispatch.dispatching}
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
              {activePanel === "analytics" && (
                <AnalyticsPanel
                  summary={analytics.summary}
                  fleetHistory={analytics.fleetHistory}
                  summaryHistory={analytics.summaryHistory}
                />
              )}
              {activePanel === "geofences" && (
                <GeofencePanel
                  fences={fences}
                  onFenceToggle={onFenceToggle}
                  onFenceDelete={onFenceDelete}
                  alerts={alerts}
                />
              )}
              {activePanel === "adapter" && (
                <AdapterDrawer
                  isOpen={true}
                  health={adapter.health}
                  config={adapter.config}
                  loading={adapter.loading}
                  error={adapter.error}
                  onClose={closePanel}
                  onSetSource={adapter.setSource}
                  onAddSink={adapter.addSink}
                  onRemoveSink={adapter.removeSink}
                />
              )}
            </div>
          </aside>
        </ErrorBoundary>
        <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
          <div className={styles.map}>
            <ConnectionStatus connectionInfo={connectionInfo} />
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
              dispatchState={dispatch.dispatchState}
              assignments={dispatch.assignments}
              incidents={incidents.incidents}
              fences={fences}
              drawingActive={drawingActive}
              onDrawComplete={onDrawComplete}
              onDrawCancel={onDrawCancel}
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
            {/* Draw Zone toolbar button */}
            <button
              type="button"
              className={classNames(styles.drawZoneButton, {
                [styles.drawZoneButtonActive]: drawingActive,
              })}
              onClick={() => setDrawingActive((v) => !v)}
              title={drawingActive ? "Cancel drawing (Esc)" : "Draw geofence zone"}
              aria-pressed={drawingActive}
            >
              {drawingActive ? "Cancel Zone" : "Draw Zone"}
            </button>
            <CreateZoneDialog
              polygon={pendingPolygon}
              onSubmit={onCreateZone}
              onClose={() => setPendingPolygon(null)}
            />
          </div>
        </ErrorBoundary>
      </div>
      {xy && (
        <ContextMenu position={xy} onClose={closeContextMenu}>
          <div ref={ref} className={styles.contextMenu}>
            <MapContextMenu
              state={dispatch.dispatchState}
              onFindDirections={onPointDestinationClick}
              onFindRoad={onFindRoadClick}
              onSendVehicle={onPointDestinationSingleClick}
              onAddWaypoint={onContextMenuAddWaypoint}
              onCreateIncident={onCreateIncident}
              hasSelectedVehicle={!!filters.selected}
              hasDispatchSelection={dispatch.selectedForDispatch.length > 0}
            />
          </div>
        </ContextMenu>
      )}
    </div>
  );
}
