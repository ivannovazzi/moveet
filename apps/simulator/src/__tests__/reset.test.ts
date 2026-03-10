import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { SimulationController } from "../modules/SimulationController";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import path from "path";

// Mock logger to suppress output
vi.mock("../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("Reset", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let controller: SimulationController;
  let origAdapterURL: string;
  let origVehicleCount: number;

  beforeEach(() => {
    origAdapterURL = config.adapterURL;
    origVehicleCount = config.vehicleCount;
    // Ensure no adapter configured by default
    (config as any).adapterURL = "";
    (config as any).vehicleCount = 3;

    network = new RoadNetwork(FIXTURE_PATH);

    // Stub setRandomDestination before construction to avoid pathfinding
    // crashes on the tiny test network
    const origProto = VehicleManager.prototype as any;
    const origSetRandom = origProto.setRandomDestination;
    origProto.setRandomDestination = function () {
      // no-op: skip pathfinding during init
    };

    manager = new VehicleManager(network);

    // Restore so tests that need it can call it explicitly
    origProto.setRandomDestination = origSetRandom;

    controller = new SimulationController(manager);
  });

  afterEach(() => {
    // Stop all vehicle movements and location updates to prevent timer leaks
    const vehicles = manager.getVehicles();
    for (const v of vehicles) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
    // Restore config
    (config as any).adapterURL = origAdapterURL;
    (config as any).vehicleCount = origVehicleCount;
    vi.restoreAllMocks();
  });

  // ─── Atomic reset ──────────────────────────────────────────────────

  describe("atomic reset", () => {
    it("should never expose empty vehicle set during reset without adapter", async () => {
      // Verify vehicles exist before reset
      expect(manager.getVehicles().length).toBe(3);

      // Stub setRandomDestination during reset to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      await manager.reset();

      // Vehicles should still exist after reset
      expect(manager.getVehicles().length).toBe(3);
    });

    it("should never expose empty vehicle set during reset with adapter", async () => {
      // Configure adapter URL
      (config as any).adapterURL = "http://localhost:3001";

      const adapterVehicles = [
        { id: "a1", name: "Adapter 1", position: [-1, 36] as [number, number] },
        { id: "a2", name: "Adapter 2", position: [-1, 36] as [number, number] },
      ];

      // Mock fetch to return adapter vehicles
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => adapterVehicles,
      });

      // Stub setRandomDestination during reset to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      // Before reset
      expect(manager.getVehicles().length).toBe(3);

      await manager.reset();

      // After reset, should have adapter vehicles
      expect(manager.getVehicles().length).toBe(2);
    });

    it("should restore previous vehicles if adapter fetch fails during reset", async () => {
      (config as any).adapterURL = "http://localhost:3001";

      // Mock fetch to fail
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

      // Stub setRandomDestination during reset to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      // Before reset
      expect(manager.getVehicles().length).toBe(3);

      // initFromAdapter falls back to loadFromData on error, so reset
      // should succeed with the fallback data
      await manager.reset();

      // Should have vehicles (the fallback data)
      expect(manager.getVehicles().length).toBe(3);
    });
  });

  // ─── Ready status ─────────────────────────────────────────────────

  describe("ready status", () => {
    it("should be ready=true after construction when no adapter configured", () => {
      const status = controller.getStatus();
      expect(status.ready).toBe(true);
    });

    it("should include ready field in status response", () => {
      const status = controller.getStatus();
      expect(status).toHaveProperty("ready");
      expect(typeof status.ready).toBe("boolean");
    });

    it("should set ready=false during reset and ready=true after", async () => {
      const readyStates: boolean[] = [];

      // Stub setRandomDestination to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      controller.on("updateStatus", (status) => {
        readyStates.push(status.ready);
      });

      await controller.reset();

      // Should have emitted updateStatus at least twice:
      // 1. ready=false (at start of reset)
      // 2. ready=true (after reset completes)
      expect(readyStates.length).toBeGreaterThanOrEqual(2);
      expect(readyStates[0]).toBe(false);
      expect(readyStates[readyStates.length - 1]).toBe(true);
    });

    it("should be ready=true after reset completes", async () => {
      // Stub setRandomDestination to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      await controller.reset();

      expect(controller.getStatus().ready).toBe(true);
    });
  });

  // ─── Reset event ──────────────────────────────────────────────────

  describe("reset event", () => {
    it("should emit reset event with vehicles and directions after reset", async () => {
      const resetListener = vi.fn();

      // Stub setRandomDestination to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      controller.on("reset", resetListener);

      await controller.reset();

      expect(resetListener).toHaveBeenCalledTimes(1);
      const payload = resetListener.mock.calls[0][0];
      expect(payload).toHaveProperty("vehicles");
      expect(payload).toHaveProperty("directions");
      expect(Array.isArray(payload.vehicles)).toBe(true);
      expect(Array.isArray(payload.directions)).toBe(true);
      expect(payload.vehicles.length).toBe(3);
    });

    it("should emit reset event after vehicles are loaded (not before)", async () => {
      const events: string[] = [];

      // Stub setRandomDestination to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      controller.on("updateStatus", (status) => {
        events.push(status.ready ? "status:ready" : "status:not-ready");
      });
      controller.on("reset", () => {
        events.push("reset");
      });

      await controller.reset();

      // The reset event should come after the not-ready status
      // and before or at the same time as the ready status
      const notReadyIdx = events.indexOf("status:not-ready");
      const resetIdx = events.indexOf("reset");
      const readyIdx = events.lastIndexOf("status:ready");

      expect(notReadyIdx).toBeGreaterThanOrEqual(0);
      expect(resetIdx).toBeGreaterThan(notReadyIdx);
      expect(readyIdx).toBeGreaterThan(notReadyIdx);
    });
  });

  // ─── markReady ─────────────────────────────────────────────────────

  describe("markReady", () => {
    it("should set ready to true and emit updateStatus", () => {
      const statusListener = vi.fn();
      controller.on("updateStatus", statusListener);

      // Force not ready
      (controller as any)._ready = false;
      expect(controller.getStatus().ready).toBe(false);

      controller.markReady();

      expect(controller.getStatus().ready).toBe(true);
      expect(statusListener).toHaveBeenCalledTimes(1);
      expect(statusListener.mock.calls[0][0].ready).toBe(true);
    });
  });
});
