/**
 * Map library hot swap, end to end over the real modules: the REST routes,
 * the switcher, and the in-place graph swap underneath them. Only the async
 * random-destination picker is stubbed so no pathfinding workers start.
 */
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidMessage, type MapStatusPayload } from "@moveet/shared-types";
import { MapLibrary } from "../../modules/maps/MapLibrary";
import { ADAPTER_WARNING, MapSwitcher, type MapSwitcherDeps } from "../../modules/maps/MapSwitcher";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { VehicleManager } from "../../modules/VehicleManager";
import { FleetManager } from "../../modules/FleetManager";
import { IncidentManager } from "../../modules/IncidentManager";
import { SimulationController } from "../../modules/SimulationController";
import { GeoFenceManager } from "../../modules/GeoFenceManager";
import { JobManager } from "../../modules/JobManager";
import { ScenarioManager } from "../../modules/scenario";
import { WeatherManager } from "../../modules/weather/WeatherManager";
import { createMapRoutes } from "../../routes/maps";
import { createNetworkRoutes } from "../../routes/network";
import { createBuildingRoutes } from "../../routes/buildings";
import type { RouteContext } from "../../routes/types";
import { config } from "../../utils/config";

const FIXTURES = path.join(__dirname, "..", "fixtures");
const SMALL = path.join(FIXTURES, "test-network.geojson");
const GRID = path.join(FIXTURES, "integration-network.geojson");

const proto = VehicleManager.prototype as unknown as Record<string, unknown>;
const origSetRandom = proto.setRandomDestination;
let origVehicleCount: number;
let origAdapterURL: string;

beforeAll(() => {
  proto.setRandomDestination = function () {};
  origVehicleCount = config.vehicleCount;
  origAdapterURL = config.adapterURL;
  (config as Record<string, unknown>).vehicleCount = 4;
  (config as Record<string, unknown>).adapterURL = "";
});

afterAll(() => {
  proto.setRandomDestination = origSetRandom;
  (config as Record<string, unknown>).vehicleCount = origVehicleCount;
  (config as Record<string, unknown>).adapterURL = origAdapterURL;
});

interface Harness {
  root: string;
  library: MapLibrary;
  network: RoadNetwork;
  vehicleManager: VehicleManager;
  simulationController: SimulationController;
  incidentManager: IncidentManager;
  geoFenceManager: GeoFenceManager;
  deps: MapSwitcherDeps;
  switcher: MapSwitcher;
  events: MapStatusPayload[];
  app: express.Express;
}

let h: Harness;

function names(features: Array<{ properties?: { name?: string } }>): string[] {
  return features.map((f) => f.properties?.name ?? "").sort();
}

function build(overrides: Partial<MapSwitcherDeps> = {}): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-switch-"));
  const library = new MapLibrary(root);
  library.importMap({
    id: "small",
    label: "Small",
    networkPath: SMALL,
    source: { type: "bundled" },
  });
  library.importMap({ id: "grid", label: "Grid", networkPath: GRID, source: { type: "bundled" } });
  library.setActiveId("small");
  // Only the grid has buildings.
  const buildings = path.join(root, "grid", "buildings");
  fs.mkdirSync(buildings);
  fs.writeFileSync(path.join(buildings, "index.json"), '{"tiles":["1/2"]}');

  const network = new RoadNetwork(library.networkPath("small"));
  const fleetManager = new FleetManager();
  const incidentManager = new IncidentManager();
  const vehicleManager = new VehicleManager(network, fleetManager);
  const simulationController = new SimulationController(vehicleManager, incidentManager);
  const geoFenceManager = new GeoFenceManager();
  const jobManager = new JobManager(vehicleManager);
  const weatherManager = new WeatherManager({
    enabled: false,
    pollIntervalMs: 60_000,
    fetchTimeoutMs: 1000,
    lat: 0,
    lon: 0,
  });
  const scenarioManager = new ScenarioManager(
    vehicleManager,
    incidentManager,
    simulationController,
    jobManager,
    weatherManager
  );
  const deps: MapSwitcherDeps = {
    library,
    network,
    simulationController,
    vehicleManager,
    geoFenceManager,
    scenarioManager,
    weatherManager,
    adapterConfigured: false,
    ...overrides,
  };
  const switcher = new MapSwitcher(deps, "small");
  const events: MapStatusPayload[] = [];
  switcher.on("map", (p) => events.push(p));

  const app = express();
  app.use(createNetworkRoutes({ network } as unknown as RouteContext));
  app.use(createBuildingRoutes({ dir: () => switcher.activeBuildingsDir() }));
  app.use(createMapRoutes({ library, switcher }));

  return {
    root,
    library,
    network,
    vehicleManager,
    simulationController,
    incidentManager,
    geoFenceManager,
    deps,
    switcher,
    events,
    app,
  };
}

beforeEach(() => {
  h = build();
});

afterEach(async () => {
  h.simulationController.stop();
  await h.network.shutdownWorkers();
  fs.rmSync(h.root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("GET /maps", () => {
  it("lists the library with the active id", async () => {
    const res = await request(h.app).get("/maps");
    expect(res.status).toBe(200);
    expect(res.body.activeId).toBe("small");
    expect(res.body.switching).toBe(false);
    expect(res.body.maps.map((m: { id: string }) => m.id).sort()).toEqual(["grid", "small"]);
  });

  it("GET /maps/active returns the active meta", async () => {
    const res = await request(h.app).get("/maps/active");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("small");
  });
});

describe("POST /maps/:id/activate", () => {
  it("swaps the network, respawns the fleet and clears map-bound state", async () => {
    const before = await request(h.app).get("/network");
    const smallNames = names(before.body.features);
    expect((await request(h.app).get("/buildings")).status).toBe(404);

    h.network.seedHeatZones(2);
    h.geoFenceManager.addZone({
      id: "f1",
      name: "Fence",
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      active: true,
    } as never);
    const vehicleCount = h.vehicleManager.getVehicles().length;
    expect(vehicleCount).toBe(4);

    const res = await request(h.app).post("/maps/grid/activate");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previousId: "small", changed: true, map: { id: "grid" } });
    expect(res.body.warning).toBeUndefined();

    // /network serves the new graph.
    const after = await request(h.app).get("/network");
    expect(names(after.body.features)).not.toEqual(smallNames);
    expect(names(after.body.features)).toContain("Horizontal Road 1");

    // Fleet respawned onto edges of the new graph.
    const vehicles = h.vehicleManager.getVehicles();
    expect(vehicles).toHaveLength(vehicleCount);
    for (const v of h.vehicleManager.registry.getAll().values()) {
      expect(h.network.getEdge(v.currentEdge.id)).toBe(v.currentEdge);
    }

    // Map-bound state is gone; buildings follow the active map.
    expect(h.network.exportHeatZones()).toEqual([]);
    expect(h.geoFenceManager.getAllZones()).toEqual([]);
    expect((await request(h.app).get("/buildings")).status).toBe(200);

    // Persisted and reported.
    expect(new MapLibrary(h.root).getActiveId()).toBe("grid");
    expect(h.library.get("grid")?.nodeCount).toBe(h.network.nodeCount);
    expect((await request(h.app).get("/maps/active")).body.id).toBe("grid");
    expect(h.events.map((e) => e.status)).toEqual(["switching", "active"]);
    expect(h.events[1].map.id).toBe("grid");
  });

  it("resumes a running simulation on the new map", async () => {
    await h.simulationController.start({});
    expect(h.vehicleManager.isRunning()).toBe(true);
    await request(h.app).post("/maps/grid/activate").expect(200);
    expect(h.vehicleManager.isRunning()).toBe(true);
  });

  it("is a no-op for the already active map", async () => {
    const res = await request(h.app).post("/maps/small/activate");
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(h.events).toEqual([]);
  });

  it("answers 404 for an unknown map and 400 for an invalid id", async () => {
    expect((await request(h.app).post("/maps/nope/activate")).status).toBe(404);
    expect((await request(h.app).post("/maps/Bad..Id/activate")).status).toBe(400);
  });

  it("answers 409 while another switch is in progress", async () => {
    // Hold the switch mid-commit until the second request has been answered.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realReset = h.simulationController.reset.bind(h.simulationController);
    vi.spyOn(h.simulationController, "reset").mockImplementationOnce(async () => {
      await gate;
      await realReset();
    });

    const first = h.switcher.activate("grid");
    await expect(h.switcher.activate("small")).rejects.toThrow(/in progress/);
    const res = await request(h.app).post("/maps/grid/activate");
    expect(res.status).toBe(409);
    expect((await request(h.app).get("/maps")).body.switching).toBe(true);
    expect((await request(h.app).delete("/maps/grid")).status).toBe(409);
    release();
    await first;
    expect(h.switcher.isSwitching).toBe(false);
  });

  it("keeps the previous map when the new one cannot be loaded", async () => {
    fs.mkdirSync(path.join(h.root, "broken"));
    fs.writeFileSync(path.join(h.root, "broken", "network.geojson"), "{ not json");
    fs.copyFileSync(
      path.join(h.root, "grid", "meta.json"),
      path.join(h.root, "broken", "meta.json")
    );
    await h.simulationController.start({});
    const before = (await request(h.app).get("/network")).body;

    const res = await request(h.app).post("/maps/broken/activate");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/broken/);

    expect((await request(h.app).get("/network")).body).toEqual(before);
    expect(h.switcher.getActiveId()).toBe("small");
    expect(new MapLibrary(h.root).getActiveId()).toBe("small");
    expect(h.vehicleManager.isRunning()).toBe(true);
    expect(h.events.map((e) => e.status)).toEqual(["switching", "error"]);
    expect(h.events[1].map.id).toBe("small");
    expect(h.events[1].error).toBeTruthy();
  });

  it("keeps the previous map when the build worker dies", async () => {
    const workerPath = path.join(h.root, "crash.cjs");
    fs.writeFileSync(workerPath, "process.exit(7);\n");
    h.switcher = new MapSwitcher(
      {
        ...h.deps,
        buildNetwork: (p) => RoadNetwork.loadOffThread(p, undefined, { workerPath }),
      },
      "small"
    );
    h.switcher.on("map", (p) => h.events.push(p));
    await h.simulationController.start({});
    const before = (await request(h.app).get("/network")).body;

    await expect(h.switcher.activate("grid")).rejects.toThrow(/exited with code 7/);

    expect((await request(h.app).get("/network")).body).toEqual(before);
    expect(h.switcher.getActiveId()).toBe("small");
    expect(h.switcher.isSwitching).toBe(false);
    expect(new MapLibrary(h.root).getActiveId()).toBe("small");
    expect(h.vehicleManager.isRunning()).toBe(true);
    expect(h.events.map((e) => e.status)).toEqual(["switching", "error"]);
  });

  it("stays busy, and the event loop free, while the graph builds", async () => {
    const first = h.switcher.activate("grid");
    let settled = false;
    void first.finally(() => {
      settled = true;
    });
    // `switching` goes out before any building starts.
    expect(h.events.map((e) => e.status)).toEqual(["switching"]);
    // Requests are served mid-build, and every other switch is refused.
    expect((await request(h.app).get("/maps")).body.switching).toBe(true);
    expect((await request(h.app).post("/maps/small/activate")).status).toBe(409);
    expect(settled).toBe(false);
    await first;
    expect(h.switcher.isSwitching).toBe(false);
    expect(h.switcher.getActiveId()).toBe("grid");
  });

  it("rolls the graph back when committing the switch fails", async () => {
    const before = (await request(h.app).get("/network")).body;
    vi.spyOn(h.library, "setActiveId").mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const res = await request(h.app).post("/maps/grid/activate");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/disk full/);
    expect((await request(h.app).get("/network")).body).toEqual(before);
    expect(h.switcher.getActiveId()).toBe("small");
    for (const v of h.vehicleManager.registry.getAll().values()) {
      expect(h.network.getEdge(v.currentEdge.id)).toBe(v.currentEdge);
    }
    expect(h.events.map((e) => e.status)).toEqual(["switching", "error"]);
  });

  it("warns, but still switches, when an external adapter is configured", async () => {
    h.switcher = new MapSwitcher({ ...h.deps, adapterConfigured: true }, "small");
    const res = await h.switcher.activate("grid");
    expect(res.changed).toBe(true);
    expect(res.warning).toBe(ADAPTER_WARNING);
  });
});

describe("DELETE /maps/:id", () => {
  it("refuses to delete the active map", async () => {
    const res = await request(h.app).delete("/maps/small");
    expect(res.status).toBe(409);
    expect(h.library.has("small")).toBe(true);
  });

  it("deletes an inactive map", async () => {
    expect((await request(h.app).delete("/maps/grid")).status).toBe(204);
    expect(h.library.has("grid")).toBe(false);
    expect((await request(h.app).delete("/maps/grid")).status).toBe(404);
  });
});

describe("map WS message", () => {
  it("is part of the shared contract", () => {
    const payload: MapStatusPayload = h.switcher.statusPayload();
    expect(payload.status).toBe("active");
    expect(payload.map.id).toBe("small");
    expect(isValidMessage({ type: "map", data: payload })).toBe(true);
    expect(isValidMessage({ type: "map" })).toBe(false);
  });
});
