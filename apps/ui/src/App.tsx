import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import client from "./utils/client";
import Vehicles from "./Controls/Vehicles";
import Fleets from "./Controls/Fleets";
import Incidents from "./Controls/Incidents";
import RecordReplay from "./Controls/RecordReplay";
import ScenariosPanel from "./Controls/ScenariosPanel";
import DispatchFooter from "./Controls/DispatchFooter";
import NavRail from "./Controls/NavRail";
import BottomDock from "./Controls/BottomDock";
import Inspector from "./Inspector/Inspector";
import TogglesPanel from "./Controls/TogglesPanel";
import AdapterDrawer from "./Controls/Adapter/AdapterDrawer";
import { useAdapterConfig } from "./Controls/Adapter/useAdapterConfig";
import useTracking from "./Controls/useTracking";
import MapView from "./Map/Map";
import FleetLegend from "./Map/FleetLegend";
import SearchBar from "./SearchBar";
import Zoom from "./Zoom/";
import GeofencePanel from "./Controls/GeofencePanel";
import CreateZoneDialog from "./Map/Geofence/CreateZoneDialog";
import type { Fleet, Modifiers } from "./types";
import type { BoundingBox } from "@moveet/shared-types";
import type { POI } from "./types";
import { useVehicles } from "./hooks/useVehicles";
import type { Filters } from "./hooks/useVehicles";
import { SelectionContext, useSelection } from "./hooks/useSelection";
import { useFleets } from "./hooks/useFleets";
import { useVehicleTypeFilter } from "./hooks/useVehicleTypeFilter";
import { useSubscribeFilter } from "./hooks/useSubscribeFilter";
import { useIncidents } from "./hooks/useIncidents";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { useDispatchFlow } from "./hooks/useDispatchFlow";
import { DispatchState } from "./hooks/useDispatchState";
import { useInteractionMode, useInteractionKeyboard } from "./hooks/useInteractionMode";
import { usePanelNavigation } from "./hooks/usePanelNavigation";
import { useGeofenceManager } from "./hooks/useGeofenceManager";
import { useSimulationConnection } from "./hooks/useSimulationConnection";
import { useMapInteractions } from "./hooks/useMapInteractions";
import ContextMenu from "./components/ContextMenu";
import MapContextMenu from "./components/MapContextMenu";
import ModeBanner from "./components/ModeBanner";
import ConnectionStatus from "./components/ConnectionStatus";
import { useConnectionState } from "./hooks/useConnectionState";
import ErrorBoundary, { SectionErrorFallback } from "./components/ErrorBoundary";
import { useAnalytics } from "./hooks/useAnalytics";
import { useOptions } from "./hooks/useOptions";
import { useNetwork } from "./hooks/useNetwork";
import { useRoads } from "./hooks/useRoads";
import { useDataReady } from "./data/useData";
import AnalyticsPanel from "./Controls/AnalyticsPanel";
import LoadingOverlay from "./components/LoadingOverlay";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const connectionInfo = useConnectionState();

  // ─── Interaction mode (browse | dispatch | draw-geofence) ───────
  // Single owner of "what does a map click mean right now". Dispatch and
  // geofence drawing derive their active flags from it, so they are mutually
  // exclusive by construction, and both are refused while a replay runs.
  const replay = useReplay();
  const interaction = useInteractionMode({
    replayActive: replay.replayStatus.mode === "replay",
  });

  const dispatch = useDispatchFlow({
    active: interaction.mode.kind === "dispatch",
    onEnter: interaction.enterDispatch,
    onExit: interaction.exitToBrowse,
  });
  const { activePanel, setActivePanel, closePanel } = usePanelNavigation(dispatch.dispatchMode);

  const adapter = useAdapterConfig(activePanel === "adapter");
  const {
    vehicles,
    modifiers,
    filters,
    setVehicles,
    onHoverVehicle,
    onUnhoverVehicle,
    setModifiers,
    onFilterChange,
  } = useVehicles();

  // ─── Unified selection (vehicle | road | poi) ───────────────────
  // Single source of truth: selecting anything replaces the previous
  // selection of any kind, so a vehicle and a POI can never be selected
  // simultaneously. Provided via SelectionContext below (Inspector reads it).
  const selectionApi = useSelection();
  const { selection, selectedItem, select, selectItem, clear: clearSelection } = selectionApi;
  const selectedVehicleId = selection?.kind === "vehicle" ? selection.id : undefined;
  const onSelectVehicle = useCallback((id: string) => select("vehicle", id), [select]);

  // The map's existing prop paths (VehiclesLayer, Direction, Breadcrumbs) read
  // the scalar `filters.selected` — keep that shape by injecting the derived id.
  const mapFilters = useMemo<Filters>(
    () => ({ ...filters, selected: selectedVehicleId }),
    [filters, selectedVehicleId]
  );

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
  const analytics = useAnalytics();

  // ─── Geofencing ─────────────────────────────────────────────────
  const geofences = useGeofenceManager({
    drawingActive: interaction.mode.kind === "draw-geofence",
    onEnterDrawing: interaction.enterDrawGeofence,
    onExitDrawing: interaction.exitToBrowse,
  });

  // ─── Map / context-menu interactions ────────────────────────────
  const {
    contextMenuXY,
    closeContextMenu,
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
    selectedVehicleId,
    selectedItem,
    selectItem,
    clearSelection,
    createIncidentAtPosition: incidents.createAtPosition,
  });

  // Stable so the POI IconLayer's onClick-keyed useMemo isn't rebuilt each render
  // (which would discard deck.gl's in-flight enter/color transitions).
  const onPOIClick = useCallback((poi: POI) => selectItem(poi), [selectItem]);

  // Canvas hover on a vehicle mirrors the sidebar list's onMouseEnter/Leave pair.
  const onHoverMapVehicle = useCallback(
    (id: string | undefined) => (id ? onHoverVehicle(id) : onUnhoverVehicle()),
    [onHoverVehicle, onUnhoverVehicle]
  );

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

  // Vehicles' per-row speed bar renders relative to the configured max speed.
  // Now that SpeedPanel (the old "Speed" nav destination) is gone, this ref is
  // synced directly from the shared options context instead.
  const maxSpeedRef = useRef(60);
  const { options } = useOptions(300);
  useEffect(() => {
    maxSpeedRef.current = options.maxSpeed;
  }, [options.maxSpeed]);

  useTracking(vehicles, selectedVehicleId, status.interval);

  // The single window-level keyboard dispatcher. Escape priority: cancel
  // geofence draw → exit dispatch → clear selection (closes the inspector) →
  // close the active panel. Enter closes the draw polygon / submits dispatch.
  // (Destructured so the useCallbacks below depend on the stable functions,
  // not on the per-render `dispatch`/`geofences` object literals.)
  const { handleDispatch, handleDone } = dispatch;
  const { onDrawCancel, onConfirmDraw } = geofences;
  const submitDispatch = useCallback(() => {
    void handleDispatch();
  }, [handleDispatch]);
  useInteractionKeyboard(
    {
      modeKind: interaction.mode.kind,
      canConfirmDraw: geofences.drawingVertexCount >= 3,
      canSubmitDispatch:
        dispatch.dispatchState === DispatchState.ROUTE && dispatch.assignments.length > 0,
      hasSelection: selection !== null,
      panelOpen: activePanel !== null,
    },
    {
      onCancelDraw: onDrawCancel,
      onConfirmDraw: onConfirmDraw,
      onExitDispatch: handleDone,
      onSubmitDispatch: submitDispatch,
      onClearSelection: resetSelection,
      onClosePanel: closePanel,
    }
  );

  // ModeBanner's Exit routes to the active mode's own exit path so its
  // cleanup semantics stay identical to Escape.
  const exitActiveMode = useCallback(() => {
    if (interaction.mode.kind === "draw-geofence") onDrawCancel();
    else if (interaction.mode.kind === "dispatch") handleDone();
  }, [interaction.mode.kind, onDrawCancel, handleDone]);

  return (
    <SelectionContext.Provider value={selectionApi}>
      <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-background">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          data-ready={dataReady ? "" : undefined}
        >
          <NavRail
            activePanel={activePanel}
            onPanelChange={setActivePanel}
            incidentCount={incidents.incidents.length}
          />
          <ErrorBoundary fallback={<SectionErrorFallback section="Controls" />}>
            <aside
              className={cn(
                "absolute bottom-0 top-0 left-60 z-30 w-[clamp(248px,22vw,304px)] overflow-hidden",
                "transition-[transform,opacity,visibility] duration-slow ease-emphasized",
                activePanel !== null
                  ? "visible translate-x-0 opacity-100 pointer-events-auto"
                  : "invisible -translate-x-[calc(100%+20px)] opacity-0 pointer-events-none"
              )}
              aria-hidden={activePanel === null}
            >
              <div className="flex h-full w-full min-w-0 flex-col overflow-hidden border-r border-border surface-glass shadow-elevated backdrop-blur-2xl">
                {activePanel === "vehicles" && (
                  <>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-center border-b border-border px-4 py-3 text-sm font-medium tracking-wide transition-colors duration-fast ease-standard",
                        dispatch.dispatchMode
                          ? "surface-accent text-accent-foreground shadow-glow-accent"
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
                      selectedId={selectedVehicleId}
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
                  <TogglesPanel
                    modifiers={modifiers}
                    onChangeModifiers={onChangeModifiers}
                    hiddenVehicleTypes={hiddenVehicleTypes}
                    onToggleVehicleType={toggleVehicleType}
                  />
                )}
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
                filters={mapFilters}
                modifiers={modifiers}
                selectedItem={selectedItem}
                onClick={onSelectVehicle}
                onMapClick={onMapClick}
                onMapContextClick={onMapContextClick}
                onPOIClick={onPOIClick}
                onHoverVehicle={onHoverMapVehicle}
                vehicleFleetMap={vehicleFleetMap}
                hiddenFleetIds={hiddenFleetIds}
                hiddenVehicleTypes={hiddenVehicleTypes}
                dispatchState={dispatch.dispatchState}
                assignments={dispatch.assignments}
                onMoveWaypointGroup={dispatch.moveWaypointGroup}
                onRemoveWaypointGroup={dispatch.removeWaypointGroup}
                incidents={incidents.incidents}
                fences={geofences.fences}
                selectedFenceId={geofences.selectedFenceId}
                onFenceClick={geofences.selectFence}
                drawingActive={geofences.drawingActive}
                onDrawComplete={geofences.onDrawComplete}
                onDrawVertexCountChange={geofences.setDrawingVertexCount}
                drawConfirmId={geofences.drawConfirmId}
                onBboxChange={onBboxChange}
              />
              {/* The search bar and the mode banner share the top-center slot:
                  while a mode is active the banner replaces the search bar
                  (mode clicks and search-driven selection would conflict). */}
              {!mapLoading && interaction.mode.kind === "browse" && (
                <SearchBar
                  selectedItem={selectedItem}
                  onDestinationClick={onDestinationClick}
                  onItemSelect={selectItem}
                  onItemUnselect={clearSelection}
                />
              )}
              <ModeBanner
                mode={interaction.mode}
                dispatchState={dispatch.dispatchState}
                selectedCount={dispatch.selectedForDispatch.length}
                stopCount={dispatch.assignments.reduce((sum, a) => sum + a.waypoints.length, 0)}
                drawVertexCount={geofences.drawingVertexCount}
                onExit={exitActiveMode}
              />
              <Zoom />
              <FleetLegend
                fleets={fleets}
                hiddenFleetIds={hiddenFleetIds}
                onToggle={toggleFleetVisibility}
              />
              <Inspector vehicles={vehicles} vehicleFleetMap={vehicleFleetMap} />
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
            hasSelectedVehicle={!!selectedVehicleId}
            hasDispatchSelection={dispatch.selectedForDispatch.length > 0}
          />
        </ContextMenu>
        <Toaster position="bottom-right" />
      </div>
    </SelectionContext.Provider>
  );
}
