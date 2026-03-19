import type { RoadNetwork } from "../modules/RoadNetwork";
import type { VehicleManager } from "../modules/VehicleManager";
import type { FleetManager } from "../modules/FleetManager";
import type { IncidentManager } from "../modules/IncidentManager";
import type { RecordingManager } from "../modules/RecordingManager";
import type { SimulationController } from "../modules/SimulationController";
import type { ScenarioManager } from "../modules/scenario";

/**
 * Shared context passed to each route module.
 * Contains references to all domain managers needed by routes.
 */
export interface RouteContext {
  network: RoadNetwork;
  vehicleManager: VehicleManager;
  fleetManager: FleetManager;
  incidentManager: IncidentManager;
  recordingManager: RecordingManager;
  simulationController: SimulationController;
  scenarioManager: ScenarioManager;
}
