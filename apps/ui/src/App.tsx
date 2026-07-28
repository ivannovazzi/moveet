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
import { useJobs } from "./hooks/useJobs";
import { useJobDraft } from "./hooks/useJobDraft";
import { useJobsAutoReveal } from "./hooks/useJobsAutoReveal";
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
import { useDataReady, useOptionsContext, usePOIContext } from "./data/useData";
import CommandPalette, { buildCommands } from "./components/CommandPalette";
import LoadingOverlay from "./components/LoadingOverlay";
import StartHint from "./components/StartHint";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { toast } from "./lib/toast";
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
  const { roads, loading: roadsLoading } = useRoads();
  // Read-only context view of the POIs `SearchBar` already fetches — the
  // command palette searches them without adding a second request.
  const { pois } = usePOIContext();
  // The map can't render (and the SearchBar has nothing to search) until the
  // road network + roads have loaded. Drives both the loading overlay and the
  // SearchBar's visibility.
  const mapLoading = networkLoading || roadsLoading;
  const dataReady = useDataReady();
  const incidents = useIncidents();

  // ─── Jobs (trip/dispatch lifecycle) ─────────────────────────────
  // `useJobs` owns the board; `useJobDraft` owns the two-click pickup/dropoff
  // placement that creates one. Split because the board is live-updating state
  // and the draft is transient modal input over the map.
  const jobs = useJobs();
  const jobDraft = useJobDraft(jobs.createJob);
  useJobsAutoReveal(jobs.liveJobs.length, setModifiers);

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
    onJobPlacementClick: jobDraft.handleMapClick,
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
    // Job placement is the one modal mode without its own window-level Escape
    // handler, so cancel it here and stop — a single press must not also clear
    // the selection.
    if (jobDraft.active) {
      jobDraft.cancel();
      return;
    }
    if (dispatch.dispatchMode || geofences.drawingActive) return;
    resetSelection();
  }, [jobDraft, dispatch.dispatchMode, geofences.drawingActive, resetSelection]);

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

  // ─── First-run start affordance ─────────────────────────────────
  // The sim boots paused; StartHint owns its own (one-shot) visibility, this
  // only supplies the action. Options come from the shared context rather than
  // useOptions() so we don't add a second fetch/subscription for one button.
  const { options } = useOptionsContext();
  const onStartFromHint = useCallback(async () => {
    const res = await client.start(options);
    if (res?.error) {
      toast.error(`Failed to start simulation: ${res.error}`);
      return;
    }
    toast.success("Simulation started");
  }, [options]);

  // Long-open tabs keep running the bundle they loaded with; poll for redeploys.
  useVersionCheck();

  const maxSpeedRef = useRef(60);
  useTracking(vehicles, filters.selected, status.interval);

  // Keyboard shortcuts while in dispatch mode: Enter dispatches, Esc exits.
  // Modal shortcuts stay here; the palette exposes the same actions by name.
  useDispatchShortcuts(dispatch);

  // ─── Command palette (⌘K) ───────────────────────────────────────
  // Every dock action, built from the handlers already wired above. Deps are
  // the individual fields (not the `dispatch`/`recording` objects, which are
  // fresh literals each render) so this list only rebuilds when it changes.
  const {
    dispatchMode,
    dispatchState,
    toggleDispatchMode,
    handleDone,
    handleDispatch,
    handleRetryFailed,
  } = dispatch;
  const assignmentCount = dispatch.assignments.length;
  const hasFailedDispatches = dispatch.results.some((r) => r.status === "error");
  const paletteActions = useMemo(
    () =>
      buildCommands({
        running: status.running,
        options,
        isRecording: recording.isRecording,
        onStartRecording: recording.startRecording,
        onStopRecording: recording.stopRecording,
        replayStatus: replay.replayStatus,
        onPauseReplay: replay.pauseReplay,
        onResumeReplay: replay.resumeReplay,
        onStopReplay: replay.stopReplay,
        onSetReplaySpeed: replay.setReplaySpeed,
        dispatchMode,
        dispatchState,
        assignmentCount,
        hasFailedDispatches,
        onToggleDispatchMode: toggleDispatchMode,
        onExitDispatchMode: handleDone,
        onDispatch: handleDispatch,
        onRetryFailedDispatches: handleRetryFailed,
        jobPlacementActive: jobDraft.active,
        onStartJob: jobDraft.start,
        onCancelJobPlacement: jobDraft.cancel,
        onCreateRandomIncident: incidents.createRandom,
        onStartGeofenceDrawing: geofences.startDrawing,
        heatzones: heatzoneEditor,
        modifiers,
        onChangeModifiers,
        onClearSelection: resetSelection,
      }),
    [
      status.running,
      options,
      recording.isRecording,
      recording.startRecording,
      recording.stopRecording,
      replay.replayStatus,
      replay.pauseReplay,
      replay.resumeReplay,
      replay.stopReplay,
      replay.setReplaySpeed,
      dispatchMode,
      dispatchState,
      assignmentCount,
      hasFailedDispatches,
      toggleDispatchMode,
      handleDone,
      handleDispatch,
      handleRetryFailed,
      jobDraft.active,
      jobDraft.start,
      jobDraft.cancel,
      incidents.createRandom,
      geofences.startDrawing,
      heatzoneEditor,
      modifiers,
      onChangeModifiers,
      resetSelection,
    ]
  );

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
              jobs={jobs.liveJobs}
              jobDraftPickup={jobDraft.pickup}
              jobPlacementActive={jobDraft.active}
              fences={geofences.fences}
              selectedFenceId={geofences.selectedFenceId}
              onSelectFence={geofences.onSelectFence}
              drawingActive={geofences.drawingActive}
              onDrawComplete={geofences.onDrawComplete}
              onDrawCancel={geofences.onDrawCancel}
              onDrawVertexCountChange={geofences.setDrawingVertexCount}
              drawConfirmId={geofences.drawConfirmId}
              onBboxChange={onBboxChange}
              panLocked={heatzoneEditor.mode !== "idle"}
              zoneDrawActive={heatzoneEditor.mode === "draw"}
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
            <StartHint
              running={status.running}
              ready={!mapLoading && connected}
              onStart={onStartFromHint}
            />
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
              jobs={{
                jobs: jobs.jobs,
                counts: jobs.counts,
                draft: jobDraft,
                onCancelJob: jobs.cancelJob,
                onDeleteJob: jobs.deleteJob,
                error: jobs.error,
              }}
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
      {/* Keyboard-first surface over the same entities and dock actions.
          `setSelectedItem` / `onSelectVehicle` are the very handlers the
          SearchBar and vehicle list use, so selecting from here flies the
          camera and opens the Inspector exactly as clicking would. */}
      <CommandPalette
        vehicles={vehicles}
        roads={roads}
        pois={pois}
        actions={paletteActions}
        onSelectVehicle={onSelectVehicle}
        onSelectItem={setSelectedItem}
      />
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
