import { EventEmitter } from "events";
import type { MapActivateResponse, MapMeta, MapStatusPayload } from "@moveet/shared-types";
import { RoadNetwork } from "../RoadNetwork";
import type { MapLibrary } from "./MapLibrary";
import type { SimulationController } from "../SimulationController";
import type { VehicleManager } from "../VehicleManager";
import type { GeoFenceManager } from "../GeoFenceManager";
import type { ScenarioManager } from "../scenario";
import type { WeatherManager } from "../weather/WeatherManager";
import type { SpeedProfileManager } from "../speedprofiles/SpeedProfileManager";
import type { StateStore } from "../StateStore";
import type { PersistenceManager } from "../PersistenceManager";
import logger from "../../utils/logger";

/** No map with the requested id. */
export class MapNotFoundError extends Error {
  constructor(id: string) {
    super(`Map not found: ${id}`);
    this.name = "MapNotFoundError";
  }
}

/** Another switch is in progress, or the request targets the active map. */
export class MapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapConflictError";
  }
}

/** The map could not be loaded; the previous one is still active. */
export class MapActivationError extends Error {
  constructor(id: string, cause: unknown) {
    super(
      `Could not activate map ${id}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = "MapActivationError";
  }
}

export const ADAPTER_WARNING =
  "An external adapter is configured: its vehicles were re-placed on the nearest roads of the new map, " +
  "so downstream consumers will see every position jump.";

export interface MapSwitcherDeps {
  library: MapLibrary;
  /** The live network. Kept as the same object; its graph is swapped in place. */
  network: RoadNetwork;
  simulationController: SimulationController;
  vehicleManager: VehicleManager;
  geoFenceManager: GeoFenceManager;
  scenarioManager: ScenarioManager;
  weatherManager: WeatherManager;
  speedProfiles?: SpeedProfileManager;
  stateStore?: StateStore;
  persistenceManager?: PersistenceManager;
  /** `ADAPTER_URL` is set: switching is allowed but answered with a warning. */
  adapterConfigured: boolean;
  /** `WEATHER_LAT`/`WEATHER_LON`: when set they pin weather, whatever the map. */
  weatherLat?: number;
  weatherLon?: number;
  /** Builds a graph from a GeoJSON file. Injectable for tests. */
  buildNetwork?: (geojsonPath: string) => RoadNetwork;
}

/** Hand control back to the event loop so queued I/O (the `switching` frame) goes out first. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Hot-swaps the active road network.
 *
 * Everything built from the network keeps its identity: {@link RoadNetwork}
 * swaps its graph internals in place ({@link RoadNetwork.swapGraphWith}), so
 * routes, event wiring and managers holding a reference need no rewiring. What
 * is tied to the old map's coordinates or edge ids is cleared instead:
 * vehicles (respawned on the new network), routes and the route cache,
 * traffic, incidents, jobs, geofences, heat zones, a running scenario, and
 * the learned speed profiles in memory (rows for the new map are reloaded).
 *
 * Emits `map` ({@link MapStatusPayload}) on every state change.
 */
export class MapSwitcher extends EventEmitter<{ map: [MapStatusPayload] }> {
  private activeId: string;
  private switching = false;

  constructor(
    private readonly deps: MapSwitcherDeps,
    initialActiveId: string
  ) {
    super();
    this.activeId = initialActiveId;
  }

  get isSwitching(): boolean {
    return this.switching;
  }

  getActiveId(): string {
    return this.activeId;
  }

  getActive(): MapMeta {
    const meta = this.deps.library.get(this.activeId);
    if (!meta) throw new Error(`Active map ${this.activeId} is missing from the library`);
    return meta;
  }

  /** Building tiles of the active map, or null when it has none. */
  activeBuildingsDir(): string | null {
    return this.deps.library.buildingsDir(this.activeId);
  }

  /** The `map` frame describing the current state, for clients that just connected. */
  statusPayload(): MapStatusPayload {
    return { status: this.switching ? "switching" : "active", map: this.getActive() };
  }

  /** Records graph stats the library could not know before the map was first built. */
  recordGraphStats(id: string, network: RoadNetwork): void {
    const meta = this.deps.library.get(id);
    if (meta && meta.nodeCount !== network.nodeCount) {
      this.deps.library.updateMeta(id, { nodeCount: network.nodeCount });
    }
  }

  /**
   * Deletes a map. The active map, and the target of a switch in flight,
   * cannot be deleted.
   */
  remove(id: string): void {
    if (!this.deps.library.has(id)) throw new MapNotFoundError(id);
    if (id === this.activeId) throw new MapConflictError(`Map ${id} is active`);
    if (this.switching) throw new MapConflictError("A map switch is in progress");
    this.deps.library.remove(id);
  }

  /**
   * Makes `id` the active map. Resolves once the new network is live (or
   * immediately when it already is).
   *
   * @throws MapNotFoundError, MapConflictError (switch in progress) or
   *   MapActivationError (load failed; the previous map is still active).
   */
  async activate(id: string): Promise<MapActivateResponse> {
    const { library, adapterConfigured } = this.deps;
    if (this.switching) throw new MapConflictError("A map switch is already in progress");
    const target = library.get(id);
    if (!target) throw new MapNotFoundError(id);

    const previousId = this.activeId;
    const warning = adapterConfigured ? { warning: ADAPTER_WARNING } : {};
    if (id === previousId) {
      return { map: target, previousId, changed: false, durationMs: 0, ...warning };
    }

    this.switching = true;
    const startedAt = Date.now();
    try {
      this.emit("map", { status: "switching", map: target });
      await yieldToEventLoop();

      // Build first, touching nothing live: a corrupt or empty map fails here
      // and the running simulation never notices.
      let incoming: RoadNetwork;
      try {
        incoming = (this.deps.buildNetwork ?? ((p: string) => new RoadNetwork(p)))(
          library.networkPath(id)
        );
        if (incoming.edgeCount === 0) throw new Error("the map has no routable roads");
      } catch (err) {
        throw new MapActivationError(id, err);
      }

      await this.commit(id, incoming);

      const map = library.get(id) ?? target;
      const durationMs = Date.now() - startedAt;
      logger.info(`Active map switched from ${previousId} to ${id} in ${durationMs}ms`);
      this.switching = false;
      this.emit("map", { status: "active", map });
      return { map, previousId, changed: true, durationMs, ...warning };
    } catch (err) {
      this.switching = false;
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`Map switch to ${id} failed, ${this.activeId} stays active: ${error}`);
      this.emit("map", { status: "error", map: this.getActive(), error });
      throw err instanceof MapActivationError ? err : new MapActivationError(id, err);
    }
  }

  /**
   * Swaps `incoming` in and resets everything tied to the old map. On failure
   * the old graph is swapped back and the simulation reset onto it.
   */
  private async commit(id: string, incoming: RoadNetwork): Promise<void> {
    const {
      library,
      network,
      simulationController,
      vehicleManager,
      geoFenceManager,
      scenarioManager,
      speedProfiles,
      stateStore,
    } = this.deps;

    const wasRunning = vehicleManager.isRunning();
    if (simulationController.mode === "replay") simulationController.stopReplay();
    simulationController.stop();
    if (scenarioManager.getStatus().state !== "idle") scenarioManager.stop();
    // Learned speeds are per edge: persist what the outgoing map learned
    // before the store is rebuilt for the incoming one.
    if (speedProfiles && stateStore) speedProfiles.saveTo(stateStore);

    network.swapGraphWith(incoming);
    // `incoming` now holds the previous graph (and its worker pool).
    const previous = incoming;
    try {
      geoFenceManager.clear();
      speedProfiles?.rebindNetwork();
      if (speedProfiles && stateStore) speedProfiles.loadFrom(stateStore);
      this.relocateWeather();
      // Clears incidents and their edge costs, respawns the fleet on the new
      // graph and broadcasts `reset` (which also drops jobs).
      await simulationController.reset();
      library.setActiveId(id);
    } catch (err) {
      network.swapGraphWith(previous);
      speedProfiles?.rebindNetwork();
      if (speedProfiles && stateStore) speedProfiles.loadFrom(stateStore);
      this.relocateWeather();
      await simulationController.reset().catch((resetErr) => {
        logger.error(`Reset after a failed map switch also failed: ${resetErr}`);
      });
      if (wasRunning) await simulationController.start({});
      throw err;
    }

    this.activeId = id;
    this.recordGraphStats(id, network);
    if (wasRunning) await simulationController.start({});
    this.deps.persistenceManager?.saveNow();

    // In-flight async route requests on the old pool resolve against the new
    // edge map and come back empty; drain briefly, then stop its workers.
    void previous
      .drainPathfinding(2000)
      .then(() => previous.shutdownWorkers())
      .catch((err) => logger.warn(`Failed to stop the previous map's workers: ${err}`));
  }

  private relocateWeather(): void {
    const { network, weatherManager, weatherLat, weatherLon } = this.deps;
    const bbox = network.getBoundingBox();
    weatherManager.setLocation(
      weatherLat ?? (bbox.minLat + bbox.maxLat) / 2,
      weatherLon ?? (bbox.minLon + bbox.maxLon) / 2
    );
  }
}
