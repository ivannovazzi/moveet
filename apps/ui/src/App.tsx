import { useCallback, useMemo, useRef, useState } from "react";
import client from "./utils/client";
import Dock from "./Dock/Dock";
import Inspector from "./Inspector/Inspector";
import useTracking from "./Controls/useTracking";
import MapView from "./Map/Map";
import FleetLegend from "./Map/FleetLegend";
import TypeLegend from "./Map/TypeLegend";
import SearchBar from "./SearchBar";
import Zoom from "./Zoom/";
import CreateZoneDialog from "./Map/Geofence/CreateZoneDialog";
import HeatzoneInspector from "./Map/HeatzoneInspector";
import { useHeatzoneEditorContext } from "./data/HeatzoneEditorContext";
import { useHeatzoneAutoReveal } from "./hooks/useHeatzoneAutoReveal";
import type { Fleet, Modifiers } from "./types";
import type { BoundingBox } from "@moveet/shared-types";
import type { POI } from "./types";
import { isRoad } from "./utils/typeGuards";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import { useVehicleTypeFilter } from "./hooks/useVehicleTypeFilter";
import { useSubscribeFilter } from "./hooks/useSubscribeFilter";
import { useIncidents } from "./hooks/useIncidents";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { useDispatchFlow } from "./hooks/useDispatchFlow";
import { useDispatchShortcuts } from "./hooks/useDispatchShortcuts";
import { useGeofenceManager } from "./hooks/useGeofenceManager";
import { useSimulationConnection } from "./hooks/useSimulationConnection";
import { useMapInteractions } from "./hooks/useMapInteractions";
import ContextMenu from "./components/ContextMenu";
import MapContextMenu from "./components/MapContextMenu";
import ConnectionStatus from "./components/ConnectionStatus";
import { useConnectionState } from "./hooks/useConnectionState";
import ErrorBoundary, { SectionErrorFallback } from "./components/ErrorBoundary";
import { useAnalytics } from "./hooks/useAnalytics";
import { useNetwork } from "./hooks/useNetwork";
import { useRoads } from "./hooks/useRoads";
import { useDataReady } from "./data/useData";
import LoadingOverlay from "./components/LoadingOverlay";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const connectionInfo = useConnectionState();

  const dispatch = useDispatchFlow();

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
    error: fleetsError,
  } = useFleets();
  const { hiddenVehicleTypes, toggleVehicleType } = useVehicleTypeFilter();
  const [viewportBbox, setViewportBbox] = useState<BoundingBox | null>(null);

  useSubscribeFilter(fleets, hiddenFleetIds, hiddenVehicleTypes, viewportBbox);

  const onBboxChange = useCallback((bbox: BoundingBox | null) => setViewportBbox(bbox), []);

  const { network, loading: networkLoading } = useNetwork();
  const { loading: roadsLoading } = useRoads();
  // The map can't render (and the SearchBar has nothing to search) until the
  // road network + roads have loaded. Drives both the loading overlay and the
  // SearchBar's visibility.
  const mapLoading = networkLoading || roadsLoading;
  const dataReady = useDataReady();
  const incidents = useIncidents();
  const recording = useRecording();
  const replay = useReplay();
  const analytics = useAnalytics();

  // ─── Geofencing ─────────────────────────────────────────────────
  const geofences = useGeofenceManager();

  // ─── Manual heat zones ──────────────────────────────────────────
  // Reveal the zone layer when the user starts drawing/selecting or seeds
  // zones, but only on those transitions so the user can still toggle it back
  // off while a zone stays selected. See useHeatzoneAutoReveal.
  const heatzoneEditor = useHeatzoneEditorContext();
  useHeatzoneAutoReveal(heatzoneEditor.mode, heatzoneEditor.seedNonce, setModifiers);

  // ─── Map / context-menu interactions ────────────────────────────
  const {
    contextMenuXY,
    closeContextMenu,
    selectedItem,
    setSelectedItem,
    resetSelection,
    onMapClick,
    onMapContextClick,
    onContextMenuAddWaypoint,
    onCreateIncident,
    onDestinationClick,
    onPointDestinationClick,
    onPointDestinationSingleClick,
    onFindRoadClick,
  } = useMapInteractions({
    dispatch,
    vehicles,
    selectedVehicleId: filters.selected,
    onUnselectVehicle,
    createIncidentAtPosition: incidents.createAtPosition,
  });

  // Stable so the POI IconLayer's onClick-keyed useMemo isn't rebuilt each render
  // (which would discard deck.gl's in-flight enter/color transitions).
  const onPOIClick = useCallback((poi: POI) => setSelectedItem(poi), [setSelectedItem]);

  // Canvas hover on a vehicle mirrors the sidebar list's onMouseEnter/Leave pair.
  const onHoverMapVehicle = useCallback(
    (id: string | undefined) => (id ? onHoverVehicle(id) : onUnhoverVehicle()),
    [onHoverVehicle, onUnhoverVehicle]
  );

  // Escape-to-deselect defers entirely to dispatch mode / geofence drawing -
  // both already own Escape via their own window-level shortcut handlers
  // (useDispatchShortcuts, GeofenceDrawTool), which fire independently of
  // this one; without this guard a single Escape press while the map has
  // focus would both exit that mode AND clear the current selection.
  const onMapEscape = useCallback(() => {
    if (dispatch.dispatchMode || geofences.drawingActive) return;
    resetSelection();
  }, [dispatch.dispatchMode, geofences.drawingActive, resetSelection]);

  // ─── WebSocket connection / simulation status ───────────────────
  const { connected, status } = useSimulationConnection({
    setVehicles,
    onReset: resetSelection,
  });

  const vehicleFleetMap = useMemo(() => {
    const fleetMap = new Map<string, Fleet>();
    for (const fleet of fleets) {
      for (const vid of fleet.vehicleIds) {
        fleetMap.set(vid, fleet);
      }
    }
    return fleetMap;
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

  // ─── Inspector selection ────────────────────────────────────────
  // Resolve the selected vehicle / POI objects from the existing selection
  // state (no new selection source) to feed the on-demand Inspector panel.
  const selectedVehicle = useMemo(
    () => (filters.selected ? vehicles.find((v) => v.id === filters.selected) : undefined),
    [filters.selected, vehicles]
  );
  const selectedPoi = selectedItem && !isRoad(selectedItem) ? selectedItem : undefined;
  const closeInspector = useCallback(() => {
    onUnselectVehicle();
    setSelectedItem(null);
  }, [onUnselectVehicle, setSelectedItem]);

  const maxSpeedRef = useRef(60);
  useTracking(vehicles, filters.selected, status.interval);

  // Keyboard shortcuts while in dispatch mode: Enter dispatches, Esc exits.
  useDispatchShortcuts(dispatch);

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-background">
      <div
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-ready={dataReady ? "" : undefined}
      >
        <ErrorBoundary fallback={<SectionErrorFallback section="Map" />}>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <ConnectionStatus connectionInfo={connectionInfo} onRetry={client.retryConnection} />
            <LoadingOverlay visible={mapLoading} />
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
              onHoverVehicle={onHoverMapVehicle}
              onEscape={onMapEscape}
              vehicleFleetMap={vehicleFleetMap}
              hiddenFleetIds={hiddenFleetIds}
              hiddenVehicleTypes={hiddenVehicleTypes}
              dispatchState={dispatch.dispatchState}
              assignments={dispatch.assignments}
              selectedForDispatchCount={dispatch.selectedForDispatch.length}
              onMoveWaypointGroup={dispatch.moveWaypointGroup}
              onRemoveWaypointGroup={dispatch.removeWaypointGroup}
              incidents={incidents.incidents}
              fences={geofences.fences}
              selectedFenceId={geofences.selectedFenceId}
              onSelectFence={geofences.onSelectFence}
              drawingActive={geofences.drawingActive}
              onDrawComplete={geofences.onDrawComplete}
              onDrawCancel={geofences.onDrawCancel}
              onDrawVertexCountChange={geofences.setDrawingVertexCount}
              drawConfirmId={geofences.drawConfirmId}
              onBboxChange={onBboxChange}
            />
            {!mapLoading && (
              <SearchBar
                selectedItem={selectedItem}
                onDestinationClick={onDestinationClick}
                onItemSelect={(item) => setSelectedItem(item)}
                onItemUnselect={() => setSelectedItem(null)}
              />
            )}
            <Zoom />
            <FleetLegend
              fleets={fleets}
              hiddenFleetIds={hiddenFleetIds}
              onToggle={toggleFleetVisibility}
            />
            <TypeLegend hiddenVehicleTypes={hiddenVehicleTypes} onToggle={toggleVehicleType} />
            <Dock
              status={status}
              connected={connected}
              isRecording={recording.isRecording}
              onStartRecording={recording.startRecording}
              onStopRecording={recording.stopRecording}
              replayStatus={replay.replayStatus}
              onPauseReplay={replay.pauseReplay}
              onResumeReplay={replay.resumeReplay}
              onStopReplay={replay.stopReplay}
              onSeekReplay={replay.seekReplay}
              onSetReplaySpeed={replay.setReplaySpeed}
              vehicles={vehicles}
              filter={filters.filter}
              onFilterChange={onFilterChange}
              selectedId={filters.selected}
              onSelectVehicle={onSelectVehicle}
              onHoverVehicle={onHoverVehicle}
              onUnhoverVehicle={onUnhoverVehicle}
              maxSpeed={maxSpeedRef.current}
              vehicleFleetMap={vehicleFleetMap}
              fleets={fleets}
              onCreateFleet={createFleet}
              onDeleteFleet={deleteFleet}
              onAssignVehicle={assignVehicle}
              onUnassignVehicle={unassignVehicle}
              fleetsError={fleetsError}
              dispatch={dispatch}
              incidents={{
                incidents: incidents.incidents,
                createRandom: incidents.createRandom,
                remove: incidents.remove,
                error: incidents.error,
              }}
              geofences={{
                fences: geofences.fences,
                onFenceToggle: geofences.onFenceToggle,
                onFenceDelete: geofences.onFenceDelete,
                alerts: geofences.alerts,
                drawingActive: geofences.drawingActive,
                vertexCount: geofences.drawingVertexCount,
                onStartDrawing: geofences.startDrawing,
                onCancelDrawing: geofences.onDrawCancel,
                onConfirmDrawing: geofences.onConfirmDraw,
              }}
              analytics={{
                summary: analytics.summary,
                fleetHistory: analytics.fleetHistory,
                summaryHistory: analytics.summaryHistory,
              }}
              toggles={{ modifiers, onChangeModifiers }}
              recordings={{
                recordings: recording.recordings,
                replayStatus: replay.replayStatus,
                onStartReplay: replay.startReplay,
                onRefreshRecordings: recording.refreshRecordings,
              }}
              advanced={{ maxSpeedRef }}
            />
            <Inspector
              vehicle={selectedVehicle}
              poi={selectedPoi ?? undefined}
              fleet={selectedVehicle ? vehicleFleetMap.get(selectedVehicle.id) : undefined}
              onClose={closeInspector}
            />
            <CreateZoneDialog
              polygon={geofences.pendingPolygon}
              onSubmit={geofences.onCreateZone}
              onClose={geofences.closePendingPolygon}
            />
            <HeatzoneInspector />
          </div>
        </ErrorBoundary>
      </div>
      <ContextMenu position={contextMenuXY} onClose={closeContextMenu}>
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
      </ContextMenu>
      <Toaster position="bottom-right" />
    </div>
  );
}
