import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "@/utils/client";
import Vehicles from "./Controls/Vehicles";
import Fleets from "./Controls/Fleets";
import Incidents from "./Controls/Incidents";
import RecordReplay from "./Controls/RecordReplay";
import ScenariosPanel from "./Controls/ScenariosPanel";
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
import TypeLegend from "./Map/TypeLegend";
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
import type {
  BoundingBox,
  GeoFence,
  GeoFenceEvent,
  CreateGeoFenceRequest,
} from "@moveet/shared-types";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import { useVehicleTypeFilter } from "./hooks/useVehicleTypeFilter";
import { useSubscribeFilter } from "./hooks/useSubscribeFilter";
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
import type { AnalyticsSnapshot } from "./hooks/analyticsStore";
import type { ResetPayload } from "./utils/wsTypes";
import { useAnalytics } from "./hooks/useAnalytics";
import { useNetwork } from "./hooks/useNetwork";
import { useRoads } from "./hooks/useRoads";
import AnalyticsPanel from "./Controls/AnalyticsPanel";
import LoadingOverlay from "./components/LoadingOverlay";

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
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [drawConfirmId, setDrawConfirmId] = useState(0);
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

  const {
    fleets,
    createFleet,
    deleteFleet,
    assignVehicle,
    unassignVehicle,
    hiddenFleetIds,
    toggleFleetVisibility,
  } = useFleets();
  const { hiddenVehicleTypes, toggleVehicleType } = useVehicleTypeFilter();
  const [viewportBbox, setViewportBbox] = useState<BoundingBox | null>(null);

  useSubscribeFilter(fleets, hiddenFleetIds, hiddenVehicleTypes, viewportBbox);

  const onBboxChange = useCallback((bbox: BoundingBox | null) => setViewportBbox(bbox), []);
  // Stable so the POI IconLayer's onClick-keyed useMemo isn't rebuilt each render
  // (which would discard deck.gl's in-flight enter/color transitions).
  const onPOIClick = useCallback((poi: POI) => setSelectedItem(poi), []);

  const { network, loading: networkLoading } = useNetwork();
  const { loading: roadsLoading } = useRoads();
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

  const assignments = dispatch.assignments;
  const onContextMenuAddWaypoint = useCallback(() => {
    if (!destination) return;
    const assignedIds = new Set(assignments.map((a) => a.vehicleId));

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
  }, [destination, assignments, dispatch, vehicles, closeContextMenu]);

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

  const onFenceToggle = useCallback(
    async (id: string) => {
      const prev = fences;
      setFences((f) => f.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
      try {
        const res = await client.toggleGeofence(id);
        if (res.error) throw new Error(res.error);
      } catch {
        setFences(prev);
        console.warn("Failed to toggle geofence");
      }
    },
    [fences]
  );

  const onFenceDelete = useCallback(
    async (id: string) => {
      const prev = fences;
      setFences((f) => f.filter((x) => x.id !== id));
      try {
        const res = await client.deleteGeofence(id);
        if (res.error) throw new Error(res.error);
      } catch {
        setFences(prev);
        console.warn("Failed to delete geofence");
      }
    },
    [fences]
  );

  const onDrawComplete = useCallback((polygon: [number, number][]) => {
    setDrawingActive(false);
    setDrawingVertexCount(0);
    setPendingPolygon(polygon);
  }, []);

  const onDrawCancel = useCallback(() => {
    setDrawingActive(false);
    setDrawingVertexCount(0);
    setPendingPolygon(null);
  }, []);

  const onConfirmDraw = useCallback(() => {
    setDrawConfirmId((n) => n + 1);
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
    // Register named handlers so cleanup can remove exactly these — passing no
    // handler to off* deletes the whole handler set for that event type, which
    // would also wipe handlers other hooks (e.g. useDirections) registered for
    // the shared "connect"/"reset" events.
    const handleConnect = () => {
      setConnected(true);
      analyticsStore.clear();
      // Re-fetch full state on reconnect
      client.getVehicles().then((response) => {
        if (response.data) setVehicles(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleAnalytics = (snapshot: AnalyticsSnapshot) => analyticsStore.push(snapshot);
    const handleStatus = (data: SimulationStatus) => setStatus(data);
    const handleReset = (data: ResetPayload) => {
      setVehicles(data.vehicles);
      setSelectedItem(null);
      setDestination(null);
      onUnselectVehicle();
    };
    const handleGeofenceEvent = (event: GeoFenceEvent) => {
      setAlerts((prev) => {
        const next = [event, ...prev];
        return next.length > 200 ? next.slice(0, 200) : next;
      });
    };

    client.onConnect(handleConnect);
    client.onDisconnect(handleDisconnect);
    client.onAnalytics(handleAnalytics);
    client.onStatus(handleStatus);
    client.onReset(handleReset);
    client.getStatus().then((response) => {
      if (response.data) {
        setStatus(response.data);
      }
    });
    client.onGeofenceEvent(handleGeofenceEvent);

    client.connectWebSocket();
    return () => {
      client.offConnect(handleConnect);
      client.offDisconnect(handleDisconnect);
      client.offAnalytics(handleAnalytics);
      client.offStatus(handleStatus);
      client.offReset(handleReset);
      client.offGeofenceEvent(handleGeofenceEvent);
      client.disconnect();
    };
  }, [setVehicles, onUnselectVehicle]);

  const maxSpeedRef = useRef(60);
  useTracking(vehicles, filters.selected, status.interval);

  // Keyboard shortcuts while in dispatch mode: Enter dispatches, Esc exits.
  // Destructure the specific (stable) fields used so this effect depends on
  // them rather than the whole `dispatch` object — which is a fresh literal
  // every render and would otherwise re-subscribe the window listener constantly.
  const { dispatchMode, dispatchState, handleDone, handleDispatch } = dispatch;
  const assignmentCount = assignments.length;
  useEffect(() => {
    if (!dispatchMode) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept while typing in inputs/textareas.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleDone();
      } else if (e.key === "Enter") {
        if (dispatchState === DispatchState.ROUTE && assignmentCount > 0) {
          e.preventDefault();
          void handleDispatch();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dispatchMode, dispatchState, assignmentCount, handleDone, handleDispatch]);

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-background">
      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-ready={!networkLoading && !roadsLoading ? "" : undefined}
      >
        <IconRail
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          incidentCount={incidents.incidents.length}
        />
        <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
          <aside
            className={cn(
              "absolute bottom-0 top-0 left-14 z-30 w-[clamp(248px,22vw,304px)] overflow-hidden backdrop-blur-md",
              "transition-[transform,opacity,visibility] duration-300 ease-out",
              activePanel !== null
                ? "visible translate-x-0 opacity-100 pointer-events-auto"
                : "invisible -translate-x-[calc(100%+20px)] opacity-0 pointer-events-none"
            )}
            aria-hidden={activePanel === null}
          >
            <div className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-border bg-card shadow-lg">
              {activePanel === "vehicles" && (
                <>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-center border-b border-border px-4 py-3 text-sm font-medium tracking-wide transition-colors",
                      dispatch.dispatchMode
                        ? "bg-accent/15 text-accent"
                        : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    )}
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
                    error={dispatch.error}
                  />
                </>
              )}
              {activePanel === "fleets" && (
                <Fleets
                  fleets={fleets}
                  vehicles={vehicles}
                  onCreateFleet={createFleet}
                  onDeleteFleet={deleteFleet}
                  onAssignVehicle={assignVehicle}
                  onUnassignVehicle={unassignVehicle}
                />
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
                  recordings={recording.recordings}
                  replayStatus={replay.replayStatus}
                  onStartReplay={replay.startReplay}
                  onRefreshRecordings={recording.refreshRecordings}
                />
              )}
              {activePanel === "scenarios" && <ScenariosPanel />}
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
                  drawingActive={drawingActive}
                  vertexCount={drawingVertexCount}
                  onStartDrawing={() => setDrawingActive(true)}
                  onCancelDrawing={onDrawCancel}
                  onConfirmDrawing={onConfirmDraw}
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
                  onSetRealism={adapter.setRealism}
                />
              )}
            </div>
          </aside>
        </ErrorBoundary>
        <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <ConnectionStatus connectionInfo={connectionInfo} />
            <LoadingOverlay visible={networkLoading || roadsLoading} />
            <MapView
              network={network}
              vehicles={vehicles}
              filters={filters}
              modifiers={modifiers}
              selectedItem={selectedItem}
              onClick={onSelectVehicle}
              onMapClick={onMapClick}
              onMapContextClick={onMapContextClick}
              onPOIClick={onPOIClick}
              vehicleFleetMap={vehicleFleetMap}
              hiddenFleetIds={hiddenFleetIds}
              hiddenVehicleTypes={hiddenVehicleTypes}
              dispatchState={dispatch.dispatchState}
              assignments={dispatch.assignments}
              selectedForDispatchCount={dispatch.selectedForDispatch.length}
              onMoveWaypointGroup={dispatch.moveWaypointGroup}
              onRemoveWaypointGroup={dispatch.removeWaypointGroup}
              incidents={incidents.incidents}
              fences={fences}
              drawingActive={drawingActive}
              onDrawComplete={onDrawComplete}
              onDrawCancel={onDrawCancel}
              onDrawVertexCountChange={setDrawingVertexCount}
              drawConfirmId={drawConfirmId}
              onBboxChange={onBboxChange}
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
            <TypeLegend hiddenVehicleTypes={hiddenVehicleTypes} onToggle={toggleVehicleType} />
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
          <div
            ref={ref}
            className="flex flex-col items-stretch gap-2 rounded-lg bg-card/80 p-2 backdrop-blur-md"
          >
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
