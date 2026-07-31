import { useCallback, useMemo, useRef, useState } from "react";
import client from "./utils/client";
import Dock from "./Dock/Dock";
import Inspector from "./Inspector/Inspector";
import useTracking from "./Controls/useTracking";
import MapView from "./Map/Map";
import FleetLegend from "./Map/FleetLegend";
import VisibilityRail from "./Map/VisibilityRail";
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
import { useFaults } from "./hooks/useFaults";
import { useRecording } from "./hooks/useRecording";
import { useReplay } from "./hooks/useReplay";
import { useDispatchFlow } from "./hooks/useDispatchFlow";
import { useDockNavigation } from "./hooks/useDockNavigation";
import { useGeofenceManager } from "./hooks/useGeofenceManager";
import {
  useInteractionMode,
  useInteractionKeyboard,
  type InteractionMode,
  type InteractionModeKind,
} from "./hooks/useInteractionMode";
import { useModeGuard } from "./hooks/useModeGuard";
import { describeMode, type ModeContext } from "./Dock/modeDescriptors";
import { ModeEntryProvider } from "./data/ModeEntryContext";
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
import StatusLeds from "./Dock/StatusLeds";
import { useAdapterConfig } from "./Controls/Adapter/useAdapterConfig";
import { FEED_HEALTH_TONE, feedHealth } from "./Dock/FeedsSection";
import SessionTimeline, { useSessionEventCapture } from "./components/SessionTimeline";
import LoadingOverlay from "./components/LoadingOverlay";
import StartHint from "./components/StartHint";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { toast } from "./lib/toast";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const connectionInfo = useConnectionState();

  // ─── Interaction mode ───────────────────────────────────────────
  // Single owner of "what does a map click mean right now". Dispatch and
  // geofence drawing derive their active flags from it; job placement and heat
  // zone authoring own richer state of their own, so the union *reads* them
  // (`derived`) instead of mirroring them. Either way exactly one tool has the
  // map, and all of them are refused while a replay runs.
  const replay = useReplay();
  const replayActive = replay.replayStatus.mode === "replay";

  // ─── Jobs (trip/dispatch lifecycle) ─────────────────────────────
  // `useJobs` owns the board; `useJobDraft` owns the two-click pickup/dropoff
  // placement that creates one. Split because the board is live-updating state
  // and the draft is transient modal input over the map.
  const jobs = useJobs();
  const jobDraft = useJobDraft(jobs.createJob);

  // ─── Manual heat zones ──────────────────────────────────────────
  const heatzoneEditor = useHeatzoneEditorContext();

  const derivedMode = useMemo<InteractionMode | null>(() => {
    if (jobDraft.active) return { kind: "place-job" };
    if (heatzoneEditor.mode === "draw") return { kind: "draw-heatzone" };
    if (heatzoneEditor.mode === "selected" && heatzoneEditor.selectedId) {
      return { kind: "edit-heatzone", id: heatzoneEditor.selectedId };
    }
    return null;
  }, [jobDraft.active, heatzoneEditor.mode, heatzoneEditor.selectedId]);

  const { cancel: cancelJobDraft, start: startJobDraft } = jobDraft;
  const {
    stopDraw: stopZoneDraw,
    deselect: deselectZone,
    startDraw: startZoneDraw,
  } = heatzoneEditor;
  const exitDerivedMode = useCallback(() => {
    cancelJobDraft();
    stopZoneDraw();
    deselectZone();
  }, [cancelJobDraft, stopZoneDraw, deselectZone]);

  const interaction = useInteractionMode({
    replayActive,
    derived: derivedMode,
    onExitDerived: exitDerivedMode,
  });

  const dispatch = useDispatchFlow({
    active: interaction.mode.kind === "dispatch",
    onEnter: interaction.enterDispatch,
    onExit: interaction.exitToBrowse,
  });

  // Which dock panel is open. Owned here (not inside Dock) so Escape can close
  // the open drawer as the lowest-priority branch of the one keyboard
  // dispatcher, and so the command palette can open/close the same panels by
  // calling this contract rather than looking up the dock's cluster buttons by
  // aria-label and clicking them.
  const dockNavigation = useDockNavigation();

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

  useJobsAutoReveal(jobs.liveJobs.length, setModifiers);

  const recording = useRecording();
  const analytics = useAnalytics();

  // ─── Feeds & sinks ──────────────────────────────────────────────
  // One poller, two readers: the Settings › Feeds panel and the corner health
  // lamps. It polls faster while that panel is open (see useAdapterConfig).
  const adapter = useAdapterConfig(
    dockNavigation.expanded === "settings" && dockNavigation.tab === "feeds"
  );

  // ─── Device faults ──────────────────────────────────────────────
  // Status counters are polled only while the Faults view is open; the
  // configuration itself arrives on `faults:config` either way, so the dock
  // badge stays honest with the panel closed.
  const faults = useFaults(
    dockNavigation.expanded === "monitor" && dockNavigation.tab === "faults"
  );
  const faultsEnabled = faults.config?.enabled ?? false;
  const toggleFaults = useCallback(
    () => void faults.configure({ enabled: !faultsEnabled }),
    [faults, faultsEnabled]
  );
  const clearFaultState = useCallback(() => void faults.reset(), [faults]);

  // ─── Geofencing ─────────────────────────────────────────────────
  const geofences = useGeofenceManager({
    drawingActive: interaction.mode.kind === "draw-geofence",
    onEnterDrawing: interaction.enterDrawGeofence,
    onExitDrawing: interaction.exitToBrowse,
  });

  // Reveal the zone layer when the user starts drawing/selecting or seeds
  // zones, but only on those transitions so the user can still toggle it back
  // off while a zone stays selected. See useHeatzoneAutoReveal.
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

  // ─── Session timeline ───────────────────────────────────────────
  // Retain incidents / geofence crossings / dispatches in a bounded buffer so
  // the bottom strip can mark them for the whole session, not just as they
  // happen. Capture lives here because the dispatch outcomes are App's.
  useSessionEventCapture({
    replayStatus: replay.replayStatus,
    dispatchResults: dispatch.results,
  });

  // Long-open tabs keep running the bundle they loaded with; poll for redeploys.
  useVersionCheck();

  const maxSpeedRef = useRef(60);
  useTracking(vehicles, filters.selected, status.interval);

  // Destructured up here so the keyboard dispatcher and the palette both
  // depend on the stable functions rather than the per-render `dispatch` /
  // `geofences` object literals.
  const { dispatchState, handleDone, handleDispatch, handleRetryFailed } = dispatch;
  const { clearSelection: clearDispatchSelection, selectForDispatch } = dispatch;
  const assignmentCount = dispatch.assignments.length;
  const { onDrawCancel, onConfirmDraw, onUndoVertex } = geofences;

  // The dock's "Select N" key ticks every vehicle currently on screen. Read
  // through a ref so the mode descriptor does not rebuild on every position
  // tick — it feeds the guard, the keyboard and the palette, all of which want
  // stable identities.
  const visibleVehiclesRef = useRef(vehicles);
  visibleVehiclesRef.current = vehicles;
  const selectVisibleForDispatch = useCallback(() => {
    selectForDispatch(visibleVehiclesRef.current.map((v) => v.id));
  }, [selectForDispatch]);

  // ─── The active mode, described once ────────────────────────────
  // One table turns the mode union into words, tone and actions. The dock's
  // mode rail renders it, the keyboard dispatcher below runs its exit/primary,
  // and the guard reads its `dirty` — so the bar, the keyboard and the
  // confirmation can't drift apart the way the old banner, footer and
  // keyActionFor switch did.
  const successCount = dispatch.results.filter((r) => r.status === "ok").length;
  const failureCount = dispatch.results.filter((r) => r.status === "error").length;
  const stopCount = dispatch.assignments.reduce((sum, a) => sum + a.waypoints.length, 0);
  const selectedForDispatchCount = dispatch.selectedForDispatch.length;
  const modeContext = useMemo<ModeContext>(
    () => ({
      dispatch: {
        state: dispatchState,
        selectedCount: selectedForDispatchCount,
        stopCount,
        assignmentCount,
        successCount,
        failureCount,
        onExit: handleDone,
        onDispatch: () => void handleDispatch(),
        onRetryFailed: handleRetryFailed,
        onClear: clearDispatchSelection,
        onSelectVisible: selectVisibleForDispatch,
        visibleCount: vehicles.length,
      },
      geofence: {
        vertexCount: geofences.drawingVertexCount,
        onCancel: onDrawCancel,
        onConfirm: onConfirmDraw,
        onUndo: onUndoVertex,
      },
      job: { stage: jobDraft.stage, onCancel: cancelJobDraft, onBack: jobDraft.back },
      heatzone: {
        onStopDraw: stopZoneDraw,
        onDeselect: deselectZone,
        // Only offered while a zone is selected — drawing a new one has nothing
        // to delete yet.
        onDelete: heatzoneEditor.selectedId
          ? () => void heatzoneEditor.removeSelected()
          : undefined,
      },
    }),
    [
      dispatchState,
      selectedForDispatchCount,
      stopCount,
      assignmentCount,
      successCount,
      failureCount,
      handleDone,
      handleDispatch,
      handleRetryFailed,
      clearDispatchSelection,
      selectVisibleForDispatch,
      vehicles.length,
      geofences.drawingVertexCount,
      onDrawCancel,
      onConfirmDraw,
      onUndoVertex,
      jobDraft.stage,
      jobDraft.back,
      cancelJobDraft,
      stopZoneDraw,
      deselectZone,
      heatzoneEditor,
    ]
  );
  const modeDescriptor = useMemo(
    () => describeMode(interaction.mode, modeContext),
    [interaction.mode, modeContext]
  );

  // ─── Mode guard ─────────────────────────────────────────────────
  // Every way into a mode goes through here, so starting one never silently
  // destroys the polygon / selection / half-placed job the last one was
  // holding. The confirmation renders in the dock's centre slot.
  const guard = useModeGuard(modeDescriptor?.dirty ?? null);
  const { enterDispatch, enterDrawGeofence } = interaction;
  const { request: guardRequest } = guard;
  const startMode = useCallback(
    (kind: InteractionModeKind) => {
      guardRequest(() => {
        if (replayActive && kind !== "browse") {
          toast.info("Map tools are unavailable during replay");
          return;
        }
        switch (kind) {
          case "dispatch":
            enterDispatch();
            break;
          case "draw-geofence":
            enterDrawGeofence();
            break;
          case "place-job":
            startJobDraft();
            break;
          case "draw-heatzone":
            startZoneDraw();
            break;
          default:
            break;
        }
      });
    },
    [guardRequest, replayActive, enterDispatch, enterDrawGeofence, startJobDraft, startZoneDraw]
  );
  const modeEntry = useMemo(() => ({ start: startMode }), [startMode]);
  const enterDispatchGuarded = useCallback(() => startMode("dispatch"), [startMode]);
  const startGeofenceDrawingGuarded = useCallback(() => startMode("draw-geofence"), [startMode]);
  const startJobGuarded = useCallback(() => startMode("place-job"), [startMode]);

  // ─── The one keyboard dispatcher ────────────────────────────────
  // Escape priority: exit the active mode → clear the selection (closes the
  // inspector) → close the dock panel. Enter runs the mode's primary action.
  // A bare D/J/G/H starts a mode from browse. Every other Escape listener
  // (dispatch shortcuts, the draw tool, DockPanel, Inspector, DeckGLMap) was
  // removed so one press unwinds exactly one thing.
  const exitActiveMode = useCallback(() => modeDescriptor?.exit(), [modeDescriptor]);
  const confirmActiveMode = useCallback(() => modeDescriptor?.primary?.run(), [modeDescriptor]);
  useInteractionKeyboard(
    {
      modeKind: interaction.mode.kind,
      canConfirmMode: (modeDescriptor?.primary?.enabled ?? false) && !modeDescriptor?.busy,
      hasSelection: filters.selected != null || selectedItem !== null,
      panelOpen: dockNavigation.panelOpen,
      // The map context menu or the CreateZoneDialog is open — those own
      // Escape/Enter themselves, so the global dispatcher stands down.
      overlayOpen:
        contextMenuXY !== null || geofences.pendingPolygon !== null || guard.pending !== null,
    },
    {
      onExitMode: exitActiveMode,
      onConfirmMode: confirmActiveMode,
      onClearSelection: resetSelection,
      onClosePanel: dockNavigation.close,
      onStartMode: startMode,
    }
  );

  // ─── Command palette (⌘K) ───────────────────────────────────────
  // Every dock action, built from the handlers already wired above. Deps are
  // the individual fields (not the `dispatch`/`recording` objects, which are
  // fresh literals each render) so this list only rebuilds when it changes.
  const hasFailedDispatches = dispatch.results.some((r) => r.status === "error");
  const paletteActions = useMemo(
    () =>
      buildCommands({
        dock: dockNavigation,
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
        modeDescriptor,
        onStartMode: startMode,
        dispatchState,
        assignmentCount,
        hasFailedDispatches,
        onDispatch: handleDispatch,
        onRetryFailedDispatches: handleRetryFailed,
        faultsArmed: faultsEnabled,
        onToggleFaults: toggleFaults,
        onClearFaultState: clearFaultState,
        onCreateRandomIncident: incidents.createRandom,
        heatzones: heatzoneEditor,
        modifiers,
        onChangeModifiers,
        onClearSelection: resetSelection,
      }),
    [
      dockNavigation,
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
      modeDescriptor,
      startMode,
      dispatchState,
      assignmentCount,
      hasFailedDispatches,
      handleDispatch,
      handleRetryFailed,
      faultsEnabled,
      toggleFaults,
      clearFaultState,
      incidents.createRandom,
      heatzoneEditor,
      modifiers,
      onChangeModifiers,
      resetSelection,
    ]
  );

  return (
    // Panels several levels down (the heat-zone tab, the geofence tab, the job
    // board) start map modes; the provider gives them the same guarded entry
    // point the dock's launcher and the keyboard shortcuts use.
    <ModeEntryProvider value={modeEntry}>
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
                vehicleFleetMap={vehicleFleetMap}
                hiddenFleetIds={hiddenFleetIds}
                hiddenVehicleTypes={hiddenVehicleTypes}
                dispatchState={dispatch.dispatchState}
                assignments={dispatch.assignments}
                onMoveWaypointGroup={dispatch.moveWaypointGroup}
                onRemoveWaypointGroup={dispatch.removeWaypointGroup}
                incidents={incidents.incidents}
                jobs={jobs.liveJobs}
                jobDraftPickup={jobDraft.pickup}
                jobPlacementActive={jobDraft.active}
                fences={geofences.fences}
                selectedFenceId={geofences.selectedFenceId}
                onSelectFence={geofences.onSelectFence}
                fencesSelectable={interaction.mode.kind === "browse"}
                drawingActive={geofences.drawingActive}
                onDrawComplete={geofences.onDrawComplete}
                onDrawVertexCountChange={geofences.setDrawingVertexCount}
                drawConfirmId={geofences.drawConfirmId}
                drawUndoId={geofences.drawUndoId}
                onBboxChange={onBboxChange}
                panLocked={heatzoneEditor.mode !== "idle"}
                zoneDrawActive={heatzoneEditor.mode === "draw"}
              />
              {/* The search bar and the mode banner share the top-center slot:
                while a mode is active the banner replaces the search bar (mode
                clicks and search-driven selection would conflict). */}
              {!mapLoading && interaction.mode.kind === "browse" && (
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
              {/* Layer visibility and the vehicle-type filters own the left edge
                  as icon keys — see VisibilityRail. Between them they replaced
                  the Settings › Visibility tab and the bottom-left type legend. */}
              <VisibilityRail
                modifiers={modifiers}
                onChangeModifiers={onChangeModifiers}
                hiddenVehicleTypes={hiddenVehicleTypes}
                onToggleVehicleType={toggleVehicleType}
              />
              <StartHint
                running={status.running}
                ready={!mapLoading && connected}
                onStart={onStartFromHint}
              />
              {/* Health lamps live in the corner, away from anything pressed. */}
              <StatusLeds
                leds={[
                  {
                    key: "ws",
                    label: "WS",
                    tone: connected ? "ok" : "idle",
                    title: connected ? "Live socket connected" : "Live socket disconnected",
                  },
                  {
                    key: "sim",
                    label: "SIM",
                    tone: status.running ? "ok" : "idle",
                    title: status.running ? "Simulation running" : "Simulation paused",
                  },
                  {
                    key: "feed",
                    label: "FEED",
                    tone: FEED_HEALTH_TONE[feedHealth(adapter.health)],
                    title: `Feeds & sinks: ${feedHealth(adapter.health).toLowerCase()}`,
                  },
                ]}
              />
              <Dock
                navigation={dockNavigation}
                adapter={adapter}
                status={status}
                options={options}
                connected={connected}
                modeDescriptor={modeDescriptor}
                guard={guard}
                onStartMode={startMode}
                onEnterDispatch={enterDispatchGuarded}
                onExitDispatch={handleDone}
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
                  // Starting a placement goes through the guard like every other
                  // way into a mode; cancelling and the rest are the draft's own.
                  draft: { ...jobDraft, start: startJobGuarded },
                  onCancelJob: jobs.cancelJob,
                  onDeleteJob: jobs.deleteJob,
                  onAssignJob: jobs.assignJob,
                  vehicles,
                  jobByVehicleId: jobs.jobByVehicleId,
                  error: jobs.error,
                }}
                incidents={{
                  incidents: incidents.incidents,
                  createRandom: incidents.createRandom,
                  remove: incidents.remove,
                  error: incidents.error,
                }}
                faults={{
                  faults,
                  vehicles,
                  selectedVehicleId: filters.selected,
                }}
                geofences={{
                  fences: geofences.fences,
                  onFenceToggle: geofences.onFenceToggle,
                  onFenceDelete: geofences.onFenceDelete,
                  alerts: geofences.alerts,
                  drawingActive: geofences.drawingActive,
                  vertexCount: geofences.drawingVertexCount,
                  onStartDrawing: startGeofenceDrawingGuarded,
                  onCancelDrawing: geofences.onDrawCancel,
                  onConfirmDrawing: geofences.onConfirmDraw,
                }}
                analytics={{
                  summary: analytics.summary,
                  fleetHistory: analytics.fleetHistory,
                  summaryHistory: analytics.summaryHistory,
                }}
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
                job={selectedVehicle ? jobs.jobByVehicleId.get(selectedVehicle.id) : undefined}
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
        {/* Below the map container, so it takes real layout space instead of
          covering the canvas or crowding the dock (both of which are absolutely
          positioned inside that container). */}
        <SessionTimeline
          replayStatus={replay.replayStatus}
          onSeek={replay.seekReplay}
          onSelectVehicle={onSelectVehicle}
        />
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
        {/* Position lives in the component: one place decides where the app
            talks, so it can't drift per call site. */}
        <Toaster />
      </div>
    </ModeEntryProvider>
  );
}
