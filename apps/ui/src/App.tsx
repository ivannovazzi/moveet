import { cn } from "@/lib/utils";
import { useCallback, useMemo, useRef, useState } from "react";
import client from "./utils/client";
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
import type { Fleet, Modifiers } from "./types";
import type { BoundingBox } from "@moveet/shared-types";
import type { POI } from "./types";
import { useVehicles } from "./hooks/useVehicles";
import { useFleets } from "./hooks/useFleets";
import { useVehicleTypeFilter } from "./hooks/useVehicleTypeFilter";
import { useSubscribeFilter } from "./hooks/useSubscribeFilter";
import { useIncidents } from "./hooks/useIncidents";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { useDispatchFlow } from "./hooks/useDispatchFlow";
import { useDispatchShortcuts } from "./hooks/useDispatchShortcuts";
import { usePanelNavigation } from "./hooks/usePanelNavigation";
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
import AnalyticsPanel from "./Controls/AnalyticsPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const connectionInfo = useConnectionState();

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
        <IconRail
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          incidentCount={incidents.incidents.length}
        />
        <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
          <aside
            className={cn(
              "absolute bottom-0 top-0 left-14 z-30 w-[clamp(248px,22vw,304px)] overflow-hidden",
              "transition-[transform,opacity,visibility] duration-slow ease-out",
              activePanel !== null
                ? "visible translate-x-0 opacity-100 pointer-events-auto"
                : "invisible -translate-x-[calc(100%+20px)] opacity-0 pointer-events-none"
            )}
            aria-hidden={activePanel === null}
          >
            <div className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-border bg-card/70 shadow-xl backdrop-blur-2xl">
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
                    selectedId={filters.selected}
                    onSelectVehicle={onSelectVehicle}
                    onHoverVehicle={onHoverVehicle}
                    onUnhoverVehicle={onUnhoverVehicle}
                    maxSpeed={maxSpeedRef.current}
                    vehicleFleetMap={vehicleFleetMap}
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
                  error={fleetsError}
                />
              )}
              {activePanel === "incidents" && (
                <Incidents
                  incidents={incidents.incidents}
                  createRandom={incidents.createRandom}
                  remove={incidents.remove}
                  error={incidents.error}
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
                  fences={geofences.fences}
                  onFenceToggle={geofences.onFenceToggle}
                  onFenceDelete={geofences.onFenceDelete}
                  alerts={geofences.alerts}
                  drawingActive={geofences.drawingActive}
                  vertexCount={geofences.drawingVertexCount}
                  onStartDrawing={geofences.startDrawing}
                  onCancelDrawing={geofences.onDrawCancel}
                  onConfirmDrawing={geofences.onConfirmDraw}
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
              polygon={geofences.pendingPolygon}
              onSubmit={geofences.onCreateZone}
              onClose={geofences.closePendingPolygon}
            />
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
