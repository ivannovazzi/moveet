// SimulationService is the singleton transport facade for the UI. The REST/WS
// surface is grouped by domain into segment classes under ./client/*; this file
// composes them and re-exposes their (constructor-bound) methods so the public
// API — names, signatures, return types, and destructure-safe binding — is
// unchanged from when everything lived in one class.
import { HttpClient } from "./httpClient";
import { WebSocketClient } from "./wsClient";
import { config as appConfig } from "./config";
import type { ClientDeps } from "./client/types";
import { ConnectionSegment } from "./client/connection";
import { SimulationSegment } from "./client/simulation";
import { FleetSegment } from "./client/fleets";
import { IncidentSegment } from "./client/incidents";
import { RecordingSegment } from "./client/recording";
import { TelemetrySegment } from "./client/telemetry";
import { GeofenceSegment } from "./client/geofences";
import { ScenarioSegment } from "./client/scenarios";

class SimulationService {
  // ─── Connection / core real-time channels ──────────────────────
  connectWebSocket: ConnectionSegment["connectWebSocket"];
  retryConnection: ConnectionSegment["retryConnection"];
  disconnect: ConnectionSegment["disconnect"];
  onConnect: ConnectionSegment["onConnect"];
  offConnect: ConnectionSegment["offConnect"];
  onDisconnect: ConnectionSegment["onDisconnect"];
  offDisconnect: ConnectionSegment["offDisconnect"];
  onConnectionStateChange: ConnectionSegment["onConnectionStateChange"];
  onVehicle: ConnectionSegment["onVehicle"];
  offVehicle: ConnectionSegment["offVehicle"];
  onStatus: ConnectionSegment["onStatus"];
  offStatus: ConnectionSegment["offStatus"];
  onOptions: ConnectionSegment["onOptions"];
  offOptions: ConnectionSegment["offOptions"];
  onHeatzones: ConnectionSegment["onHeatzones"];
  offHeatzones: ConnectionSegment["offHeatzones"];
  onDirection: ConnectionSegment["onDirection"];
  offDirection: ConnectionSegment["offDirection"];
  onReset: ConnectionSegment["onReset"];
  offReset: ConnectionSegment["offReset"];

  // ─── Simulation control + network/road/POI queries ─────────────
  start: SimulationSegment["start"];
  stop: SimulationSegment["stop"];
  reset: SimulationSegment["reset"];
  direction: SimulationSegment["direction"];
  batchDirection: SimulationSegment["batchDirection"];
  getStatus: SimulationSegment["getStatus"];
  getVehicles: SimulationSegment["getVehicles"];
  getNetwork: SimulationSegment["getNetwork"];
  getRoads: SimulationSegment["getRoads"];
  getPois: SimulationSegment["getPois"];
  findRoad: SimulationSegment["findRoad"];
  findNode: SimulationSegment["findNode"];
  getOptions: SimulationSegment["getOptions"];
  updateOptions: SimulationSegment["updateOptions"];
  getDirections: SimulationSegment["getDirections"];
  getHeatzones: SimulationSegment["getHeatzones"];
  makeHeatzones: SimulationSegment["makeHeatzones"];
  search: SimulationSegment["search"];

  // ─── Fleets ─────────────────────────────────────────────────────
  getFleets: FleetSegment["getFleets"];
  createFleet: FleetSegment["createFleet"];
  deleteFleet: FleetSegment["deleteFleet"];
  assignVehicles: FleetSegment["assignVehicles"];
  unassignVehicles: FleetSegment["unassignVehicles"];
  onFleetCreated: FleetSegment["onFleetCreated"];
  offFleetCreated: FleetSegment["offFleetCreated"];
  onFleetDeleted: FleetSegment["onFleetDeleted"];
  offFleetDeleted: FleetSegment["offFleetDeleted"];
  onFleetAssigned: FleetSegment["onFleetAssigned"];
  offFleetAssigned: FleetSegment["offFleetAssigned"];
  onWaypointReached: FleetSegment["onWaypointReached"];
  offWaypointReached: FleetSegment["offWaypointReached"];
  onRouteCompleted: FleetSegment["onRouteCompleted"];
  offRouteCompleted: FleetSegment["offRouteCompleted"];

  // ─── Incidents ──────────────────────────────────────────────────
  getIncidents: IncidentSegment["getIncidents"];
  createRandomIncident: IncidentSegment["createRandomIncident"];
  removeIncident: IncidentSegment["removeIncident"];
  createIncidentAtPosition: IncidentSegment["createIncidentAtPosition"];
  onIncidentCreated: IncidentSegment["onIncidentCreated"];
  offIncidentCreated: IncidentSegment["offIncidentCreated"];
  onIncidentCleared: IncidentSegment["onIncidentCleared"];
  offIncidentCleared: IncidentSegment["offIncidentCleared"];
  onVehicleRerouted: IncidentSegment["onVehicleRerouted"];
  offVehicleRerouted: IncidentSegment["offVehicleRerouted"];

  // ─── Recording / replay / historical generation ────────────────
  startRecording: RecordingSegment["startRecording"];
  stopRecording: RecordingSegment["stopRecording"];
  getRecordings: RecordingSegment["getRecordings"];
  startReplay: RecordingSegment["startReplay"];
  pauseReplay: RecordingSegment["pauseReplay"];
  resumeReplay: RecordingSegment["resumeReplay"];
  stopReplay: RecordingSegment["stopReplay"];
  seekReplay: RecordingSegment["seekReplay"];
  setReplaySpeed: RecordingSegment["setReplaySpeed"];
  getReplayStatus: RecordingSegment["getReplayStatus"];
  onReplayStatus: RecordingSegment["onReplayStatus"];
  offReplayStatus: RecordingSegment["offReplayStatus"];
  generateRecording: RecordingSegment["generateRecording"];
  getGenerateStatus: RecordingSegment["getGenerateStatus"];
  onGenerateProgress: RecordingSegment["onGenerateProgress"];
  offGenerateProgress: RecordingSegment["offGenerateProgress"];
  onGenerateComplete: RecordingSegment["onGenerateComplete"];
  offGenerateComplete: RecordingSegment["offGenerateComplete"];
  onGenerateError: RecordingSegment["onGenerateError"];
  offGenerateError: RecordingSegment["offGenerateError"];

  // ─── Clock / traffic / analytics ────────────────────────────────
  getClock: TelemetrySegment["getClock"];
  setClock: TelemetrySegment["setClock"];
  onClock: TelemetrySegment["onClock"];
  offClock: TelemetrySegment["offClock"];
  getTraffic: TelemetrySegment["getTraffic"];
  onTraffic: TelemetrySegment["onTraffic"];
  offTraffic: TelemetrySegment["offTraffic"];
  onAnalytics: TelemetrySegment["onAnalytics"];
  offAnalytics: TelemetrySegment["offAnalytics"];
  getAnalyticsSummary: TelemetrySegment["getAnalyticsSummary"];
  getFleetAnalytics: TelemetrySegment["getFleetAnalytics"];
  resetAnalytics: TelemetrySegment["resetAnalytics"];

  // ─── Geofences ──────────────────────────────────────────────────
  getGeofences: GeofenceSegment["getGeofences"];
  createGeofence: GeofenceSegment["createGeofence"];
  updateGeofence: GeofenceSegment["updateGeofence"];
  deleteGeofence: GeofenceSegment["deleteGeofence"];
  toggleGeofence: GeofenceSegment["toggleGeofence"];
  onGeofenceEvent: GeofenceSegment["onGeofenceEvent"];
  offGeofenceEvent: GeofenceSegment["offGeofenceEvent"];
  subscribe: GeofenceSegment["subscribe"];

  // ─── Scenarios ──────────────────────────────────────────────────
  getScenarios: ScenarioSegment["getScenarios"];
  loadScenarioByName: ScenarioSegment["loadScenarioByName"];
  startScenario: ScenarioSegment["startScenario"];
  pauseScenario: ScenarioSegment["pauseScenario"];
  stopScenario: ScenarioSegment["stopScenario"];
  getScenarioStatus: ScenarioSegment["getScenarioStatus"];
  onScenarioEvent: ScenarioSegment["onScenarioEvent"];
  offScenarioEvent: ScenarioSegment["offScenarioEvent"];

  constructor(http: HttpClient, ws: WebSocketClient) {
    const deps: ClientDeps = { http, ws };

    const connection = new ConnectionSegment(deps);
    const simulation = new SimulationSegment(deps);
    const fleets = new FleetSegment(deps);
    const incidents = new IncidentSegment(deps);
    const recording = new RecordingSegment(deps);
    const telemetry = new TelemetrySegment(deps);
    const geofences = new GeofenceSegment(deps);
    const scenarios = new ScenarioSegment(deps);

    // Re-expose each segment's bound methods. They are already bound in their
    // segment constructors, so assigning the references keeps them safe to
    // destructure off the singleton.
    this.connectWebSocket = connection.connectWebSocket;
    this.retryConnection = connection.retryConnection;
    this.disconnect = connection.disconnect;
    this.onConnect = connection.onConnect;
    this.offConnect = connection.offConnect;
    this.onDisconnect = connection.onDisconnect;
    this.offDisconnect = connection.offDisconnect;
    this.onConnectionStateChange = connection.onConnectionStateChange;
    this.onVehicle = connection.onVehicle;
    this.offVehicle = connection.offVehicle;
    this.onStatus = connection.onStatus;
    this.offStatus = connection.offStatus;
    this.onOptions = connection.onOptions;
    this.offOptions = connection.offOptions;
    this.onHeatzones = connection.onHeatzones;
    this.offHeatzones = connection.offHeatzones;
    this.onDirection = connection.onDirection;
    this.offDirection = connection.offDirection;
    this.onReset = connection.onReset;
    this.offReset = connection.offReset;

    this.start = simulation.start;
    this.stop = simulation.stop;
    this.reset = simulation.reset;
    this.direction = simulation.direction;
    this.batchDirection = simulation.batchDirection;
    this.getStatus = simulation.getStatus;
    this.getVehicles = simulation.getVehicles;
    this.getNetwork = simulation.getNetwork;
    this.getRoads = simulation.getRoads;
    this.getPois = simulation.getPois;
    this.findRoad = simulation.findRoad;
    this.findNode = simulation.findNode;
    this.getOptions = simulation.getOptions;
    this.updateOptions = simulation.updateOptions;
    this.getDirections = simulation.getDirections;
    this.getHeatzones = simulation.getHeatzones;
    this.makeHeatzones = simulation.makeHeatzones;
    this.search = simulation.search;

    this.getFleets = fleets.getFleets;
    this.createFleet = fleets.createFleet;
    this.deleteFleet = fleets.deleteFleet;
    this.assignVehicles = fleets.assignVehicles;
    this.unassignVehicles = fleets.unassignVehicles;
    this.onFleetCreated = fleets.onFleetCreated;
    this.offFleetCreated = fleets.offFleetCreated;
    this.onFleetDeleted = fleets.onFleetDeleted;
    this.offFleetDeleted = fleets.offFleetDeleted;
    this.onFleetAssigned = fleets.onFleetAssigned;
    this.offFleetAssigned = fleets.offFleetAssigned;
    this.onWaypointReached = fleets.onWaypointReached;
    this.offWaypointReached = fleets.offWaypointReached;
    this.onRouteCompleted = fleets.onRouteCompleted;
    this.offRouteCompleted = fleets.offRouteCompleted;

    this.getIncidents = incidents.getIncidents;
    this.createRandomIncident = incidents.createRandomIncident;
    this.removeIncident = incidents.removeIncident;
    this.createIncidentAtPosition = incidents.createIncidentAtPosition;
    this.onIncidentCreated = incidents.onIncidentCreated;
    this.offIncidentCreated = incidents.offIncidentCreated;
    this.onIncidentCleared = incidents.onIncidentCleared;
    this.offIncidentCleared = incidents.offIncidentCleared;
    this.onVehicleRerouted = incidents.onVehicleRerouted;
    this.offVehicleRerouted = incidents.offVehicleRerouted;

    this.startRecording = recording.startRecording;
    this.stopRecording = recording.stopRecording;
    this.getRecordings = recording.getRecordings;
    this.startReplay = recording.startReplay;
    this.pauseReplay = recording.pauseReplay;
    this.resumeReplay = recording.resumeReplay;
    this.stopReplay = recording.stopReplay;
    this.seekReplay = recording.seekReplay;
    this.setReplaySpeed = recording.setReplaySpeed;
    this.getReplayStatus = recording.getReplayStatus;
    this.onReplayStatus = recording.onReplayStatus;
    this.offReplayStatus = recording.offReplayStatus;
    this.generateRecording = recording.generateRecording;
    this.getGenerateStatus = recording.getGenerateStatus;
    this.onGenerateProgress = recording.onGenerateProgress;
    this.offGenerateProgress = recording.offGenerateProgress;
    this.onGenerateComplete = recording.onGenerateComplete;
    this.offGenerateComplete = recording.offGenerateComplete;
    this.onGenerateError = recording.onGenerateError;
    this.offGenerateError = recording.offGenerateError;

    this.getClock = telemetry.getClock;
    this.setClock = telemetry.setClock;
    this.onClock = telemetry.onClock;
    this.offClock = telemetry.offClock;
    this.getTraffic = telemetry.getTraffic;
    this.onTraffic = telemetry.onTraffic;
    this.offTraffic = telemetry.offTraffic;
    this.onAnalytics = telemetry.onAnalytics;
    this.offAnalytics = telemetry.offAnalytics;
    this.getAnalyticsSummary = telemetry.getAnalyticsSummary;
    this.getFleetAnalytics = telemetry.getFleetAnalytics;
    this.resetAnalytics = telemetry.resetAnalytics;

    this.getGeofences = geofences.getGeofences;
    this.createGeofence = geofences.createGeofence;
    this.updateGeofence = geofences.updateGeofence;
    this.deleteGeofence = geofences.deleteGeofence;
    this.toggleGeofence = geofences.toggleGeofence;
    this.onGeofenceEvent = geofences.onGeofenceEvent;
    this.offGeofenceEvent = geofences.offGeofenceEvent;
    this.subscribe = geofences.subscribe;

    this.getScenarios = scenarios.getScenarios;
    this.loadScenarioByName = scenarios.loadScenarioByName;
    this.startScenario = scenarios.startScenario;
    this.pauseScenario = scenarios.pauseScenario;
    this.stopScenario = scenarios.stopScenario;
    this.getScenarioStatus = scenarios.getScenarioStatus;
    this.onScenarioEvent = scenarios.onScenarioEvent;
    this.offScenarioEvent = scenarios.offScenarioEvent;
  }
}

export default new SimulationService(
  new HttpClient(appConfig.apiUrl),
  new WebSocketClient(appConfig.wsUrl, {
    autoReconnect: !import.meta.env.VITEST,
    logReconnects: !import.meta.env.VITEST,
  })
);
